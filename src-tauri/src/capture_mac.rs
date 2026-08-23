//! Capture on macOS, through ScreenCaptureKit.
//!
//! The mirror of the Windows Graphics Capture path in `capture.rs`, and it
//! exists because the shape of the two APIs is close enough that everything
//! above them — the shared sessions, the single-slot mailbox, the buffer pool,
//! the resolution ladder, the encode workers — is genuinely portable. What
//! differs is three things, and they are the whole of this file:
//!
//!   * **Content is asked for, not addressed.** Windows hands you a monitor by
//!     index and a window by handle. ScreenCaptureKit makes you fetch the list
//!     of shareable content first and then hold the object, so a source id has
//!     to be resolved against that list each time a session starts.
//!   * **Pixels arrive as BGRA.** Everything downstream — the resize, the JPEG
//!     encoder — reads RGBA, so the channel swap happens here, once, on the way
//!     into the pool rather than anywhere it would be repeated per rendition.
//!   * **Rows are padded.** A locked `CVPixelBuffer` has a stride that is
//!     usually wider than the image, and copying it whole would shear every
//!     frame. The copy is row by row.
//!
//! Screen recording permission is a system prompt on first use, granted in
//! System Settings. There is no way to ask for it early and no way to detect it
//! beyond trying, so a refusal surfaces as the error from `start_capture`.

use anyhow::{anyhow, Result};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::capture::{FramePool, LatestFrame, RawFrame, Session};
use crate::sources::SourceId;

use screencapturekit::cm::CMSampleBuffer;
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::{
    CMSampleBufferExt as _, PixelFormat, SCContentFilter, SCShareableContent,
    SCStream, SCStreamConfiguration, SCStreamOutputTrait, SCStreamOutputType,
};

/// Receives frames and puts them where the rest of the engine expects them.
struct Pump {
    latest: Arc<LatestFrame>,
    pool: Arc<FramePool>,
}

impl SCStreamOutputTrait for Pump {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if of_type != SCStreamOutputType::Screen || self.latest.has_ended() {
            return;
        }
        let Some(buffer) = sample.image_buffer() else { return };
        let Ok(guard) = buffer.lock(CVPixelBufferLockFlags::READ_ONLY) else { return };

        let width = guard.width() as u32;
        let height = guard.height() as u32;
        let stride = guard.bytes_per_row();
        let source = guard.as_slice();
        if width == 0 || height == 0 {
            return;
        }

        let row_bytes = width as usize * 4;
        if stride < row_bytes || source.len() < stride * height as usize {
            return;
        }

        let mut data = self.pool.take(row_bytes * height as usize);
        for y in 0..height as usize {
            let from = &source[y * stride..y * stride + row_bytes];
            let into = &mut data[y * row_bytes..(y + 1) * row_bytes];
            // BGRA in, RGBA out. Done once here rather than in every rendition
            // that reads the frame afterwards.
            for x in 0..width as usize {
                let s = x * 4;
                into[s] = from[s + 2];
                into[s + 1] = from[s + 1];
                into[s + 2] = from[s];
                into[s + 3] = from[s + 3];
            }
        }

        self.latest.publish(Arc::new(RawFrame::new(
            width,
            height,
            data,
            Arc::downgrade(&self.pool),
        )));
    }
}

/// Start capturing a display or a window.
pub fn start_session(root: &SourceId, key: String) -> Result<Arc<Session>> {
    // One round trip for the whole list. ScreenCaptureKit has no "give me
    // display 2" call; you take the catalogue and find it.
    let content = SCShareableContent::get()
        .map_err(|e| anyhow!("could not read what is shareable ({e:?}) — check Screen Recording permission in System Settings"))?;

    let latest = Arc::new(LatestFrame::default());
    let pool = Arc::new(FramePool::default());

    let (filter, native_w, native_h) = match root {
        SourceId::Monitor { index } => {
            let displays = content.displays();
            // Source ids are 1-based, to match the way the Windows side numbers
            // displays and the way people count their own monitors.
            let display = displays
                .get(index.saturating_sub(1) as usize)
                .ok_or_else(|| anyhow!("display {index} is not available"))?;
            let filter = SCContentFilter::create().with_display(display).build();
            (filter, display.width(), display.height())
        }
        SourceId::Window { hwnd } => {
            // On macOS this is a CGWindowID rather than an HWND. Same field,
            // same meaning: an opaque number the platform gave us.
            let id = *hwnd as u32;
            let windows = content.windows();
            let window = windows
                .iter()
                .find(|w| w.window_id() == id)
                .ok_or_else(|| anyhow!("that window has closed"))?;
            let frame = window.frame();
            let filter = SCContentFilter::create().with_window(window).build();
            (
                filter,
                frame.size.width.max(0.0) as u32,
                frame.size.height.max(0.0) as u32,
            )
        }
        SourceId::Region { .. } => {
            return Err(anyhow!("a region rides on its parent's session"));
        }
        SourceId::Feed { .. } => {
            return Err(anyhow!("a feed is published, not captured"));
        }
    };

    let configuration = SCStreamConfiguration::new()
        .with_width(native_w.max(1))
        .with_height(native_h.max(1))
        .with_pixel_format(PixelFormat::BGRA)
        .with_shows_cursor(true)
        // 120 Hz ceiling, matching the Windows path: the per-stream pacing
        // does the real rate limiting, this only stops a ProMotion display
        // from flooding the pump. CMTime here is value-over-timescale: one
        // hundred-and-twentieth of a second.
        .with_minimum_frame_interval(&screencapturekit::cm::CMTime::new(1, 120));

    let mut stream = SCStream::new(&filter, &configuration);
    stream.add_output_handler(
        Pump { latest: latest.clone(), pool: pool.clone() },
        SCStreamOutputType::Screen,
    );
    stream
        .start_capture()
        .map_err(|e| anyhow!("could not start capture ({e:?}) — Screen Recording permission may not be granted"))?;

    // The flag is what the rest of the engine reads; the closure is what
    // actually stops ScreenCaptureKit, since it does not poll anything.
    let halt = Arc::new(AtomicBool::new(false));
    let holder = Mutex::new(Some(stream));
    let stopper: Box<dyn FnOnce() + Send> = Box::new(move || {
        if let Ok(mut slot) = holder.lock() {
            if let Some(stream) = slot.take() {
                let _ = stream.stop_capture();
            }
        }
    });

    Ok(Arc::new(Session::new(
        key,
        latest,
        pool,
        halt,
        Some(stopper),
        (native_w, native_h),
    )))
}

/// Whether a window is still on screen, for the "that source has closed" state.
pub fn window_is_alive(id: isize) -> bool {
    let Ok(content) = SCShareableContent::get() else { return true };
    content.windows().iter().any(|w| w.window_id() == id as u32)
}

