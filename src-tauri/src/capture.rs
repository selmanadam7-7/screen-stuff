//! The capture engine.
//!
//! Shape of the thing:
//!
//! ```text
//!   WGC session (1 per real source)  ->  LatestFrame  ->  N stream workers  ->  WS clients
//! ```
//!
//! One monitor feeds the board tile, the cockpit thumbnail and the minimap from
//! a *single* capture session — they are three renditions of one stream, each
//! encoding at its own size and rate. That is why the cockpit showing eight live
//! thumbnails costs almost nothing beyond the encode.
//!
//! Frames are recycled through a pool. At 1440p a frame is 14 MB, so allocating
//! one per frame per source would mean gigabytes a second of malloc churn.

use crate::sources::SourceId;
use anyhow::{anyhow, Context as _, Result};
use parking_lot::{Condvar, Mutex};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::error::TrySendError;

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/// A captured frame in RGBA8, with its backing buffer borrowed from a pool.
pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    data: Vec<u8>,
    pool: Weak<FramePool>,
}

impl RawFrame {
    /// Wrap pixels a platform backend has already put in RGBA order.
    pub fn new(width: u32, height: u32, data: Vec<u8>, pool: Weak<FramePool>) -> Self {
        Self { width, height, data, pool }
    }

    pub fn pixels(&self) -> &[u8] {
        &self.data
    }
}

impl Drop for RawFrame {
    fn drop(&mut self) {
        if let Some(pool) = self.pool.upgrade() {
            pool.put(std::mem::take(&mut self.data));
        }
    }
}

/// Recycles frame buffers. Capped so a source that stops being watched gives its
/// memory back instead of holding 60 MB forever.
#[derive(Default)]
pub struct FramePool {
    buffers: Mutex<Vec<Vec<u8>>>,
}

const POOL_MAX: usize = 4;

impl FramePool {
    fn take(&self, len: usize) -> Vec<u8> {
        let mut buffers = self.buffers.lock();
        while let Some(mut buf) = buffers.pop() {
            if buf.capacity() >= len {
                buf.clear();
                buf.resize(len, 0);
                return buf;
            }
        }
        vec![0u8; len]
    }

    fn put(&self, buf: Vec<u8>) {
        if buf.capacity() == 0 {
            return;
        }
        let mut buffers = self.buffers.lock();
        if buffers.len() < POOL_MAX {
            buffers.push(buf);
        }
    }
}

/// A single-slot mailbox holding the newest frame from one source.
///
/// Deliberately lossy: a stream worker that is busy encoding simply misses the
/// frames that arrive meanwhile and picks up the newest one when it comes back.
/// Screen sharing wants the freshest frame, never a backlog.
pub struct LatestFrame {
    slot: Mutex<Option<Arc<RawFrame>>>,
    ready: Condvar,
    seq: AtomicU64,
    ended: AtomicBool,
    dropped: AtomicU64,
}

impl Default for LatestFrame {
    fn default() -> Self {
        Self {
            slot: Mutex::new(None),
            ready: Condvar::new(),
            seq: AtomicU64::new(0),
            ended: AtomicBool::new(false),
            dropped: AtomicU64::new(0),
        }
    }
}

impl LatestFrame {
    fn publish(&self, frame: Arc<RawFrame>) {
        let mut slot = self.slot.lock();
        if slot.is_some() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
        *slot = Some(frame);
        self.seq.fetch_add(1, Ordering::Release);
        drop(slot);
        self.ready.notify_all();
    }

    /// Blocks until a frame newer than `since` shows up, the source ends, or we time out.
    fn wait_newer(&self, since: u64, timeout: Duration) -> WaitResult {
        let mut slot = self.slot.lock();
        let deadline = Instant::now() + timeout;
        loop {
            if self.ended.load(Ordering::Acquire) {
                return WaitResult::Ended;
            }
            let seq = self.seq.load(Ordering::Acquire);
            if seq > since {
                if let Some(frame) = slot.clone() {
                    return WaitResult::Frame(seq, frame);
                }
            }
            if self.ready.wait_until(&mut slot, deadline).timed_out() {
                return WaitResult::Timeout;
            }
        }
    }

    fn end(&self) {
        self.ended.store(true, Ordering::Release);
        self.ready.notify_all();
    }

    pub fn has_ended(&self) -> bool {
        self.ended.load(Ordering::Acquire)
    }

    pub fn dropped(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

enum WaitResult {
    Frame(u64, Arc<RawFrame>),
    Timeout,
    Ended,
}

// ---------------------------------------------------------------------------
// Feeds: frames the host pushes in, rather than the engine capturing them
// ---------------------------------------------------------------------------

/// One already-encoded frame, published by the host.
pub struct FeedFrame {
    pub width: u16,
    pub height: u16,
    pub jpeg: Vec<u8>,
}

/// A named slot holding the newest frame published to it. Same lossy mailbox
/// rule as a capture: the freshest frame wins, a backlog helps nobody.
#[derive(Default)]
pub struct FeedSlot {
    latest: Mutex<Option<Arc<FeedFrame>>>,
    ready: Condvar,
    seq: AtomicU64,
    ended: AtomicBool,
}

impl FeedSlot {
    fn publish(&self, frame: Arc<FeedFrame>) {
        let mut slot = self.latest.lock();
        *slot = Some(frame);
        self.seq.fetch_add(1, Ordering::Release);
        drop(slot);
        self.ready.notify_all();
    }

    fn wait_newer(&self, since: u64, timeout: Duration) -> FeedWait {
        let mut slot = self.latest.lock();
        let deadline = Instant::now() + timeout;
        loop {
            if self.ended.load(Ordering::Acquire) {
                return FeedWait::Ended;
            }
            let seq = self.seq.load(Ordering::Acquire);
            if seq > since {
                if let Some(frame) = slot.clone() {
                    return FeedWait::Frame(seq, frame);
                }
            }
            if self.ready.wait_until(&mut slot, deadline).timed_out() {
                // Idle is not the same as ended. Returning "nothing" for both
                // meant a viewer who arrived before the first frame was told the
                // feed had finished and gave up on it.
                return FeedWait::Idle;
            }
        }
    }

    fn end(&self) {
        self.ended.store(true, Ordering::Release);
        self.ready.notify_all();
    }
}

/// The three things waiting on a feed can conclude.
enum FeedWait {
    Frame(u64, Arc<FeedFrame>),
    /// Nothing new within the timeout. The publisher may simply be between
    /// frames, or may not have sent its first one yet.
    Idle,
    Ended,
}

/// Every feed the host currently publishes.
#[derive(Default)]
pub struct Feeds {
    slots: Mutex<HashMap<String, Arc<FeedSlot>>>,
}

impl Feeds {
    fn slot(&self, name: &str) -> Arc<FeedSlot> {
        self.slots.lock().entry(name.to_string()).or_default().clone()
    }

    pub fn publish(&self, name: &str, width: u16, height: u16, jpeg: Vec<u8>) {
        self.slot(name).publish(Arc::new(FeedFrame { width, height, jpeg }));
    }

    /// The host stopped publishing — watchers should be told, not left frozen.
    pub fn close(&self, name: &str) {
        if let Some(slot) = self.slots.lock().remove(name) {
            slot.end();
        }
    }

    pub fn is_live(&self, name: &str) -> bool {
        self.slots.lock().contains_key(name)
    }

    pub fn count(&self) -> usize {
        self.slots.lock().len()
    }

    fn close_all(&self) {
        for (_, slot) in self.slots.lock().drain() {
            slot.end();
        }
    }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/// One live capture of one real source, shared by everything that wants it.
pub struct Session {
    pub key: String,
    pub latest: Arc<LatestFrame>,
    /// Held so the pool outlives every frame that came from it.
    ///
    /// Nothing reads it: the backend's pump owns the other reference and the
    /// frames hold weak ones. When the session goes, so does the pool, and the
    /// buffers with it.
    #[allow(dead_code)]
    pool: Arc<FramePool>,
    /// Watched by the capture backend where it polls, set by `stop` regardless.
    halt: Arc<AtomicBool>,
    /// Tears the platform capture down, for backends that do not poll a flag.
    ///
    /// Windows Graphics Capture watches the flag above and needs nothing here.
    /// ScreenCaptureKit has to be told, and waiting for the last reference to
    /// drop would mean the capture stops whenever the allocator gets round to
    /// it rather than when the operator took the tile off the board.
    stopper: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    native: Mutex<(u32, u32)>,
    refs: AtomicUsize,
}

impl Session {
    /// Build a session around a capture a platform backend has already started.
    pub fn new(
        key: String,
        latest: Arc<LatestFrame>,
        pool: Arc<FramePool>,
        halt: Arc<AtomicBool>,
        stopper: Option<Box<dyn FnOnce() + Send>>,
        native: (u32, u32),
    ) -> Self {
        Self {
            key,
            latest,
            pool,
            halt,
            stopper: Mutex::new(stopper),
            native: Mutex::new(native),
            refs: AtomicUsize::new(0),
        }
    }

    pub fn native_size(&self) -> (u32, u32) {
        *self.native.lock()
    }

    fn set_native(&self, w: u32, h: u32) {
        *self.native.lock() = (w, h);
    }

    fn stop(&self) {
        self.halt.store(true, Ordering::Release);
        if let Some(stop) = self.stopper.lock().take() {
            stop();
        }
        self.latest.end();
    }
}

/// Owns every running capture and hands out reference-counted handles.
#[derive(Default)]
pub struct CaptureEngine {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    pub stats: Stats,
    pub feeds: Feeds,
}

#[derive(Default)]
pub struct Stats {
    pub frames_encoded: AtomicU64,
    pub bytes_sent: AtomicU64,
    pub dropped_frames: AtomicU64,
    encode_nanos_total: AtomicU64,
    encode_samples: AtomicU64,
}

impl Stats {
    fn record_encode(&self, nanos: u64, bytes: usize) {
        self.frames_encoded.fetch_add(1, Ordering::Relaxed);
        self.bytes_sent.fetch_add(bytes as u64, Ordering::Relaxed);
        self.encode_nanos_total.fetch_add(nanos, Ordering::Relaxed);
        self.encode_samples.fetch_add(1, Ordering::Relaxed);
    }

    pub fn encode_ms_avg(&self) -> f32 {
        let samples = self.encode_samples.load(Ordering::Relaxed);
        if samples == 0 {
            return 0.0;
        }
        let total = self.encode_nanos_total.load(Ordering::Relaxed);
        (total as f64 / samples as f64 / 1_000_000.0) as f32
    }
}

/// Keeps a session alive for as long as a stream holds one.
pub struct SessionHandle {
    session: Arc<Session>,
    engine: Weak<CaptureEngine>,
}

impl SessionHandle {
    pub fn session(&self) -> &Session {
        &self.session
    }
}

impl Drop for SessionHandle {
    fn drop(&mut self) {
        if self.session.refs.fetch_sub(1, Ordering::AcqRel) == 1 {
            // Last watcher left. Tear the capture down so an unwatched monitor
            // costs nothing at all.
            if let Some(engine) = self.engine.upgrade() {
                let mut sessions = engine.sessions.lock();
                if let Some(existing) = sessions.get(&self.session.key) {
                    if existing.refs.load(Ordering::Acquire) == 0 {
                        existing.stop();
                        sessions.remove(&self.session.key);
                    }
                }
            } else {
                self.session.stop();
            }
        }
    }
}

impl CaptureEngine {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn session_count(&self) -> usize {
        self.sessions.lock().len()
    }

    /// Get (or start) the capture behind a source, and take a reference on it.
    pub fn acquire(self: &Arc<Self>, source: &SourceId) -> Result<SessionHandle> {
        let root = source.capture_root();
        let key = root.to_string();

        let mut sessions = self.sessions.lock();
        if let Some(existing) = sessions.get(&key) {
            if !existing.latest.has_ended() {
                existing.refs.fetch_add(1, Ordering::AcqRel);
                return Ok(SessionHandle {
                    session: existing.clone(),
                    engine: Arc::downgrade(self),
                });
            }
            // Dead session (window closed): drop it and start fresh.
            existing.stop();
            sessions.remove(&key);
        }

        let session = start_session(root, key.clone())?;
        session.refs.fetch_add(1, Ordering::AcqRel);
        sessions.insert(key, session.clone());
        Ok(SessionHandle { session, engine: Arc::downgrade(self) })
    }

    /// Stop every capture. Called on shutdown.
    pub fn shutdown(&self) {
        let mut sessions = self.sessions.lock();
        for (_, session) in sessions.drain() {
            session.stop();
        }
        drop(sessions);
        self.feeds.close_all();
    }
}

#[cfg(windows)]
fn start_session(root: &SourceId, key: String) -> Result<Arc<Session>> {
    use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::monitor::Monitor;
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    };
    use windows_capture::window::Window;

    struct Flags {
        latest: Arc<LatestFrame>,
        pool: Arc<FramePool>,
    }

    struct Pump {
        latest: Arc<LatestFrame>,
        pool: Arc<FramePool>,
    }

    impl GraphicsCaptureApiHandler for Pump {
        type Flags = Flags;
        type Error = anyhow::Error;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            Ok(Self { latest: ctx.flags.latest, pool: ctx.flags.pool })
        }

        fn on_frame_arrived(
            &mut self,
            frame: &mut Frame,
            control: InternalCaptureControl,
        ) -> Result<(), Self::Error> {
            if self.latest.has_ended() {
                control.stop();
                return Ok(());
            }

            let mut buffer = frame.buffer().map_err(|e| anyhow!("frame buffer: {e:?}"))?;
            let width = buffer.width();
            let height = buffer.height();
            let pixels =
                buffer.as_nopadding_buffer().map_err(|e| anyhow!("depad frame: {e:?}"))?;

            let mut data = self.pool.take(pixels.len());
            data.copy_from_slice(pixels);

            self.latest.publish(Arc::new(RawFrame {
                width,
                height,
                data,
                pool: Arc::downgrade(&self.pool),
            }));
            Ok(())
        }

        fn on_closed(&mut self) -> Result<(), Self::Error> {
            self.latest.end();
            Ok(())
        }
    }

    let latest = Arc::new(LatestFrame::default());
    let pool = Arc::new(FramePool::default());
    let flags = Flags { latest: latest.clone(), pool: pool.clone() };

    // 120 Hz ceiling: WGC only delivers on change anyway, and per-stream pacing
    // does the real rate limiting. This just stops a 320 Hz display from
    // flooding the pump.
    let min_interval =
        MinimumUpdateIntervalSettings::Custom(Duration::from_micros(8_333));

    let (native_w, native_h);
    let halt = match root {
        SourceId::Monitor { index } => {
            let monitor = Monitor::from_index(*index)
                .map_err(|e| anyhow!("display {index} is not available ({e:?})"))?;
            native_w = monitor.width().unwrap_or(0);
            native_h = monitor.height().unwrap_or(0);
            let settings = Settings::new(
                monitor,
                CursorCaptureSettings::WithCursor,
                DrawBorderSettings::WithoutBorder,
                SecondaryWindowSettings::Default,
                min_interval,
                DirtyRegionSettings::Default,
                ColorFormat::Rgba8,
                flags,
            );
            let control = Pump::start_free_threaded(settings)
                .map_err(|e| anyhow!("could not start display capture: {e:?}"))?;
            control.halt_handle()
        }
        SourceId::Window { hwnd } => {
            let window = Window::from_raw_hwnd(*hwnd as *mut std::ffi::c_void);
            if !window.is_valid() {
                return Err(anyhow!("that window has closed"));
            }
            let rect = window.rect().map_err(|e| anyhow!("window rect: {e:?}"))?;
            native_w = (rect.right - rect.left).max(0) as u32;
            native_h = (rect.bottom - rect.top).max(0) as u32;
            let settings = Settings::new(
                window,
                CursorCaptureSettings::WithCursor,
                DrawBorderSettings::WithoutBorder,
                // A window's own popups and dropdowns belong in its tile.
                SecondaryWindowSettings::Include,
                min_interval,
                DirtyRegionSettings::Default,
                ColorFormat::Rgba8,
                flags,
            );
            let control = Pump::start_free_threaded(settings)
                .map_err(|e| anyhow!("could not start window capture: {e:?}"))?;
            control.halt_handle()
        }
        SourceId::Region { .. } => {
            return Err(anyhow!("a region rides on its parent's session"));
        }
        SourceId::Feed { .. } => {
            return Err(anyhow!("a feed is published, not captured"));
        }
    };

    // Windows Graphics Capture watches the halt flag itself, so there is
    // nothing extra to tear down.
    Ok(Arc::new(Session::new(key, latest, pool, halt, None, (native_w, native_h))))
}

#[cfg(target_os = "macos")]
fn start_session(root: &SourceId, key: String) -> Result<Arc<Session>> {
    crate::capture_mac::start_session(root, key)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn start_session(_root: &SourceId, _key: String) -> Result<Arc<Session>> {
    Err(anyhow!("screen capture needs Windows or macOS"))
}

// ---------------------------------------------------------------------------
// Streams: one rendition of one source, at one size and rate
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamSpec {
    /// Maximum box to fit into. Aspect ratio is always preserved.
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub quality: u8,
}

impl StreamSpec {
    pub fn sanitised(mut self) -> Self {
        self.width = self.width.clamp(16, 3840);
        self.height = self.height.clamp(16, 2160);
        self.fps = self.fps.clamp(1, 120);
        self.quality = self.quality.clamp(30, 100);
        self
    }
}

/// What a stream worker hands back for delivery.
pub struct EncodedFrame {
    pub stream_id: u32,
    pub seq: u32,
    pub width: u16,
    pub height: u16,
    pub geometry_changed: bool,
    pub jpeg: Vec<u8>,
}

/// A running rendition. Dropping it stops the worker and releases the session.
pub struct Stream {
    pub id: u32,
    pub source: SourceId,
    spec: Arc<Mutex<StreamSpec>>,
    stop: Arc<AtomicBool>,
}

impl Stream {
    /// Re-tune without restarting: a tile that grows just asks for more pixels.
    pub fn retune(&self, spec: StreamSpec) {
        *self.spec.lock() = spec.sanitised();
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        tracing::debug!("stream {} closing ({})", self.id, self.source);
        self.stop.store(true, Ordering::Release);
    }
}

pub enum StreamEvent {
    Live { stream_id: u32, native_width: u32, native_height: u32 },
    Frame(EncodedFrame),
    Ended { stream_id: u32 },
    Failed { stream_id: u32, message: String },
}

/// Start a rendition. `sink` receives events until the stream is dropped.
pub fn start_stream(
    engine: &Arc<CaptureEngine>,
    stream_id: u32,
    source: SourceId,
    spec: StreamSpec,
    sink: tokio::sync::mpsc::Sender<StreamEvent>,
) -> Result<Stream> {
    if source.is_feed() {
        return start_feed_stream(engine, stream_id, source, spec, sink);
    }

    let handle = engine
        .acquire(&source)
        .with_context(|| format!("could not open {source}"))?;

    let spec = Arc::new(Mutex::new(spec.sanitised()));
    let stop = Arc::new(AtomicBool::new(false));

    let worker_spec = spec.clone();
    let worker_stop = stop.clone();
    let worker_source = source.clone();
    let engine_for_stats = engine.clone();

    std::thread::Builder::new()
        .name(format!("sd-stream-{stream_id}"))
        .spawn(move || {
            let session = handle.session();
            let (nw, nh) = session.native_size();
            let _ = sink.try_send(StreamEvent::Live {
                stream_id,
                native_width: nw,
                native_height: nh,
            });

            let mut last_seq = 0u64;
            let mut out_seq = 0u32;
            let mut last_dims = (0u16, 0u16);
            let mut resizer = fast_image_resize::Resizer::new();

            while !worker_stop.load(Ordering::Acquire) {
                let current = *worker_spec.lock();
                let frame_budget = Duration::from_secs_f64(1.0 / current.fps as f64);
                let started = Instant::now();

                match session.latest.wait_newer(last_seq, Duration::from_millis(500)) {
                    WaitResult::Frame(seq, frame) => {
                        last_seq = seq;
                        session.set_native(frame.width, frame.height);

                        let encode_start = Instant::now();
                        match render_jpeg(&mut resizer, &frame, &worker_source, current) {
                            Ok((jpeg, w, h)) => {
                                let geometry_changed = last_dims != (w, h);
                                last_dims = (w, h);
                                out_seq = out_seq.wrapping_add(1);
                                engine_for_stats
                                    .stats
                                    .record_encode(encode_start.elapsed().as_nanos() as u64, jpeg.len());
                                // Bounded on purpose: if the client cannot keep
                                // up, the newest frame is worth more than a
                                // queue of stale ones, so we drop rather than
                                // buffer.
                                match sink.try_send(StreamEvent::Frame(EncodedFrame {
                                    stream_id,
                                    seq: out_seq,
                                    width: w,
                                    height: h,
                                    geometry_changed,
                                    jpeg,
                                })) {
                                    Ok(()) => {}
                                    Err(TrySendError::Full(_)) => {
                                        engine_for_stats
                                            .stats
                                            .dropped_frames
                                            .fetch_add(1, Ordering::Relaxed);
                                    }
                                    Err(TrySendError::Closed(_)) => break, // client hung up
                                }
                            }
                            Err(err) => {
                                let _ = sink.try_send(StreamEvent::Failed {
                                    stream_id,
                                    message: err.to_string(),
                                });
                                break;
                            }
                        }
                    }
                    WaitResult::Timeout => {
                        // A perfectly still screen produces no frames. That is
                        // correct behaviour, not a stall — keep waiting.
                        continue;
                    }
                    WaitResult::Ended => {
                        let _ = sink.try_send(StreamEvent::Ended { stream_id });
                        break;
                    }
                }

                let elapsed = started.elapsed();
                if elapsed < frame_budget {
                    std::thread::sleep(frame_budget - elapsed);
                }
            }

            engine_for_stats
                .stats
                .dropped_frames
                .fetch_add(session.latest.dropped(), Ordering::Relaxed);
            drop(handle);
        })
        .context("could not spawn stream worker")?;

    Ok(Stream { id: stream_id, source, spec, stop })
}

/// Relays an already-encoded feed. There is nothing to capture, scale or encode
/// here — the host did that work before it pushed the frame in.
fn start_feed_stream(
    engine: &Arc<CaptureEngine>,
    stream_id: u32,
    source: SourceId,
    spec: StreamSpec,
    sink: tokio::sync::mpsc::Sender<StreamEvent>,
) -> Result<Stream> {
    let SourceId::Feed { ref name } = source else {
        return Err(anyhow!("not a feed"));
    };
    let slot = engine.feeds.slot(name);
    let spec = Arc::new(Mutex::new(spec.sanitised()));
    let stop = Arc::new(AtomicBool::new(false));

    let worker_stop = stop.clone();
    let feed_name = name.clone();
    let engine_for_stats = engine.clone();

    std::thread::Builder::new()
        .name(format!("sd-feed-{stream_id}"))
        .spawn(move || {
            let _ = sink.try_send(StreamEvent::Live {
                stream_id,
                native_width: 0,
                native_height: 0,
            });

            let mut last_seq = 0u64;
            let mut out_seq = 0u32;
            let mut last_dims = (0u16, 0u16);

            while !worker_stop.load(Ordering::Acquire) {
                let (seq, frame) = match slot.wait_newer(last_seq, Duration::from_millis(500)) {
                    FeedWait::Frame(seq, frame) => (seq, frame),
                    // Keep waiting: a camera between frames, or one whose first
                    // frame has not arrived yet, is not a dead feed.
                    FeedWait::Idle => continue,
                    FeedWait::Ended => {
                        let _ = sink.try_send(StreamEvent::Ended { stream_id });
                        break;
                    }
                };
                last_seq = seq;

                let geometry_changed = last_dims != (frame.width, frame.height);
                last_dims = (frame.width, frame.height);
                out_seq = out_seq.wrapping_add(1);
                engine_for_stats.stats.record_encode(0, frame.jpeg.len());

                match sink.try_send(StreamEvent::Frame(EncodedFrame {
                    stream_id,
                    seq: out_seq,
                    width: frame.width,
                    height: frame.height,
                    geometry_changed,
                    jpeg: frame.jpeg.clone(),
                })) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        engine_for_stats.stats.dropped_frames.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(TrySendError::Closed(_)) => break,
                }
            }
            tracing::debug!("feed relay {stream_id} ({feed_name}) finished");
        })
        .context("could not spawn feed relay")?;

    Ok(Stream { id: stream_id, source, spec, stop })
}

/// `U8x4` is a `#[repr(C)]` wrapper over `[u8; 4]`, so a slice of pixels and a
/// byte slice four times its length are the same bytes at the same address. The
/// resizer speaks pixels and the JPEG encoder speaks bytes; this is the only
/// place the two meet, and copying 8 MB per frame to bridge them is not worth it.
fn pixels_as_bytes(pixels: &[fast_image_resize::pixels::U8x4]) -> &[u8] {
    unsafe {
        std::slice::from_raw_parts(pixels.as_ptr().cast::<u8>(), std::mem::size_of_val(pixels))
    }
}

/// Crop (for regions), scale to fit the requested box, encode as JPEG.
///
/// Crop and scale happen in one pass. The obvious version — copy out the crop,
/// wrap it, copy again to satisfy a mutable-slice constructor — moves ~30 MB per
/// 1440p frame before any real work starts, and with four thumbnails running
/// that alone dominated the frame budget.
fn render_jpeg(
    resizer: &mut fast_image_resize::Resizer,
    frame: &RawFrame,
    source: &SourceId,
    spec: StreamSpec,
) -> Result<(Vec<u8>, u16, u16)> {
    use fast_image_resize::images::{TypedImage, TypedImageRef};
    use fast_image_resize::pixels::U8x4;
    use fast_image_resize::{FilterType, ResizeAlg, ResizeOptions};

    let (frame_w, frame_h) = (frame.width, frame.height);
    if frame_w == 0 || frame_h == 0 {
        return Err(anyhow!("source produced an empty frame"));
    }

    // A saved region can outlive the size it was drawn against — a window gets
    // resized, a display changes mode — so clamp rather than trust it.
    let (crop_x, crop_y, crop_w, crop_h) = match source.crop() {
        Some((x, y, w, h)) => {
            let x = x.min(frame_w.saturating_sub(1));
            let y = y.min(frame_h.saturating_sub(1));
            (x, y, w.min(frame_w - x).max(1), h.min(frame_h - y).max(1))
        }
        None => (0, 0, frame_w, frame_h),
    };

    // Fit the box without distorting, and never upscale — sending a blown-up
    // frame spends bandwidth to add exactly nothing.
    let scale = (spec.width as f64 / crop_w as f64)
        .min(spec.height as f64 / crop_h as f64)
        .min(1.0);
    let dst_w = (((crop_w as f64 * scale).round() as u32).max(2)) & !1;
    let dst_h = (((crop_h as f64 * scale).round() as u32).max(2)) & !1;

    let mut destination = TypedImage::<U8x4>::new(dst_w, dst_h);
    let options = ResizeOptions::new()
        .resize_alg(ResizeAlg::Convolution(FilterType::Bilinear))
        .crop(crop_x as f64, crop_y as f64, crop_w as f64, crop_h as f64);

    match TypedImageRef::<U8x4>::from_buffer(frame_w, frame_h, frame.pixels()) {
        Ok(view) => resizer
            .resize_typed(&view, &mut destination, &options)
            .map_err(|e| anyhow!("resize: {e}"))?,
        Err(_) => {
            // The allocator handed back a buffer that is not 4-byte aligned.
            // Vanishingly unlikely on Windows, but copying once beats dropping
            // the frame.
            let owned: Vec<U8x4> = frame
                .pixels()
                .chunks_exact(4)
                .map(|p| U8x4::new([p[0], p[1], p[2], p[3]]))
                .collect();
            let view = TypedImageRef::<U8x4>::new(frame_w, frame_h, &owned)
                .map_err(|e| anyhow!("wrap source image: {e}"))?;
            resizer
                .resize_typed(&view, &mut destination, &options)
                .map_err(|e| anyhow!("resize: {e}"))?;
        }
    }

    let mut jpeg = Vec::with_capacity((dst_w * dst_h / 6) as usize);
    let mut encoder = jpeg_encoder::Encoder::new(&mut jpeg, spec.quality);
    // 4:4:4. Chroma subsampling smears coloured text, and text is most of what a
    // screen share is made of.
    encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::F_1_1);
    encoder
        .encode(
            pixels_as_bytes(destination.pixels()),
            dst_w as u16,
            dst_h as u16,
            jpeg_encoder::ColorType::Rgba,
        )
        .map_err(|e| anyhow!("jpeg encode: {e}"))?;

    Ok((jpeg, dst_w as u16, dst_h as u16))
}

/// Builds a session with nothing behind it, so the reference counting and
/// teardown rules can be tested without a real screen.
#[cfg(test)]
fn fake_session(key: &str) -> Arc<Session> {
    Arc::new(Session::new(
        key.to_string(),
        Arc::new(LatestFrame::default()),
        Arc::new(FramePool::default()),
        Arc::new(AtomicBool::new(false)),
        None,
        (1920, 1080),
    ))
}

#[cfg(test)]
impl CaptureEngine {
    fn acquire_fake(self: &Arc<Self>, key: &str) -> SessionHandle {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .entry(key.to_string())
            .or_insert_with(|| fake_session(key))
            .clone();
        session.refs.fetch_add(1, Ordering::AcqRel);
        SessionHandle { session, engine: Arc::downgrade(self) }
    }

    fn halted(&self, key: &str) -> Option<bool> {
        self.sessions.lock().get(key).map(|s| s.halt.load(Ordering::Acquire))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(w: u32, h: u32) -> RawFrame {
        RawFrame { width: w, height: h, data: vec![128u8; (w * h * 4) as usize], pool: Weak::new() }
    }

    #[test]
    fn spec_clamps_absurd_values() {
        let s = StreamSpec { width: 99_999, height: 0, fps: 5_000, quality: 1 }.sanitised();
        assert_eq!(s.width, 3840);
        assert_eq!(s.height, 16);
        assert_eq!(s.fps, 120);
        assert_eq!(s.quality, 30);
    }

    #[test]
    fn render_fits_the_box_and_keeps_aspect() {
        let mut resizer = fast_image_resize::Resizer::new();
        let f = frame(1600, 900);
        let src = SourceId::parse("monitor:1").unwrap();
        let spec = StreamSpec { width: 800, height: 800, fps: 30, quality: 80 }.sanitised();
        let (jpeg, w, h) = render_jpeg(&mut resizer, &f, &src, spec).unwrap();
        assert_eq!((w, h), (800, 450), "should fit width and preserve 16:9");
        assert!(jpeg.starts_with(&[0xFF, 0xD8]), "valid JPEG SOI marker");
        assert!(jpeg.ends_with(&[0xFF, 0xD9]), "valid JPEG EOI marker");
    }

    #[test]
    fn render_never_upscales() {
        let mut resizer = fast_image_resize::Resizer::new();
        let f = frame(320, 180);
        let src = SourceId::parse("monitor:1").unwrap();
        let spec = StreamSpec { width: 1920, height: 1080, fps: 30, quality: 80 }.sanitised();
        let (_, w, h) = render_jpeg(&mut resizer, &f, &src, spec).unwrap();
        assert_eq!((w, h), (320, 180));
    }

    #[test]
    fn region_crop_changes_the_output_aspect() {
        let mut resizer = fast_image_resize::Resizer::new();
        let f = frame(1920, 1080);
        let src = SourceId::parse("region:monitor:1@0,0,400,400").unwrap();
        let spec = StreamSpec { width: 200, height: 200, fps: 30, quality: 80 }.sanitised();
        let (_, w, h) = render_jpeg(&mut resizer, &f, &src, spec).unwrap();
        assert_eq!((w, h), (200, 200), "a square crop stays square");
    }

    #[test]
    fn region_crop_is_clamped_to_the_live_frame() {
        // Window shrank to 200x200 but the saved region still says 0,0,800,600.
        let mut resizer = fast_image_resize::Resizer::new();
        let f = frame(200, 200);
        let src = SourceId::parse("region:window:42@0,0,800,600").unwrap();
        let spec = StreamSpec { width: 1000, height: 1000, fps: 30, quality: 80 }.sanitised();
        let (_, w, h) = render_jpeg(&mut resizer, &f, &src, spec).unwrap();
        assert_eq!((w, h), (200, 200), "clamped, not panicked");
    }

    #[test]
    fn empty_frames_are_an_error_not_a_crash() {
        let mut resizer = fast_image_resize::Resizer::new();
        let f = frame(0, 0);
        let src = SourceId::parse("monitor:1").unwrap();
        let spec = StreamSpec { width: 100, height: 100, fps: 30, quality: 80 }.sanitised();
        assert!(render_jpeg(&mut resizer, &f, &src, spec).is_err());
    }

    #[test]
    fn latest_frame_is_lossy_and_reports_drops() {
        let latest = LatestFrame::default();
        latest.publish(Arc::new(frame(4, 4)));
        latest.publish(Arc::new(frame(4, 4)));
        latest.publish(Arc::new(frame(4, 4)));
        assert_eq!(latest.dropped(), 2, "two frames overwritten before anyone read");
        match latest.wait_newer(0, Duration::from_millis(50)) {
            WaitResult::Frame(seq, _) => assert_eq!(seq, 3, "reader gets the newest, not the oldest"),
            _ => panic!("expected a frame"),
        }
    }

    #[test]
    fn latest_frame_signals_the_end() {
        let latest = LatestFrame::default();
        latest.end();
        assert!(latest.has_ended());
        assert!(matches!(latest.wait_newer(0, Duration::from_millis(10)), WaitResult::Ended));
    }

    #[test]
    fn wait_times_out_on_a_still_screen() {
        let latest = LatestFrame::default();
        assert!(matches!(latest.wait_newer(0, Duration::from_millis(20)), WaitResult::Timeout));
    }

    #[test]
    fn pool_recycles_buffers_up_to_its_cap() {
        let pool = FramePool::default();
        for _ in 0..10 {
            pool.put(vec![0u8; 1024]);
        }
        assert_eq!(pool.buffers.lock().len(), POOL_MAX, "pool does not grow without bound");
        let buf = pool.take(512);
        assert!(buf.capacity() >= 512);
    }

    #[test]
    fn pool_allocates_when_the_recycled_buffer_is_too_small() {
        let pool = FramePool::default();
        pool.put(vec![0u8; 16]);
        let buf = pool.take(4096);
        assert_eq!(buf.len(), 4096);
    }

    /// Not a pass/fail threshold so much as a tripwire: a 1440p frame scaled to
    /// a thumbnail has to be cheap, because four of them run continuously while
    /// the cockpit is open. Run with `--release -- --nocapture` for a real number.
    #[test]
    fn scaling_a_1440p_frame_is_cheap() {
        let mut resizer = fast_image_resize::Resizer::new();
        let big = frame(2560, 1440);
        let src = SourceId::parse("monitor:1").unwrap();
        let spec = StreamSpec { width: 336, height: 190, fps: 8, quality: 70 }.sanitised();

        // Warm the resizer's internal buffers so the first allocation is not timed.
        render_jpeg(&mut resizer, &big, &src, spec).unwrap();

        let started = Instant::now();
        const ROUNDS: u32 = 8;
        for _ in 0..ROUNDS {
            render_jpeg(&mut resizer, &big, &src, spec).unwrap();
        }
        let per_frame = started.elapsed() / ROUNDS;
        println!("1440p -> 336x190 took {:.1} ms/frame", per_frame.as_secs_f64() * 1000.0);

        // Two budgets, because the number is dominated by the build profile:
        // resize and encode are generic, so their bodies compile at this crate's
        // opt-level rather than the dependency's.
        let budget = if cfg!(debug_assertions) {
            Duration::from_millis(60)
        } else {
            Duration::from_millis(12)
        };
        assert!(
            per_frame < budget,
            "one thumbnail frame took {per_frame:?} (budget {budget:?}); four of these              run continuously while the cockpit is open"
        );
    }

    #[test]
    fn feeds_hold_only_the_newest_frame() {
        let feeds = Feeds::default();
        assert!(!feeds.is_live("cam0"));

        feeds.publish("cam0", 640, 360, vec![1, 2, 3]);
        feeds.publish("cam0", 640, 360, vec![4, 5, 6]);
        assert!(feeds.is_live("cam0"));
        assert_eq!(feeds.count(), 1);

        let slot = feeds.slot("cam0");
        match slot.wait_newer(0, Duration::from_millis(50)) {
            FeedWait::Frame(seq, frame) => {
                assert_eq!(seq, 2, "the reader gets the newest, not a backlog");
                assert_eq!(frame.jpeg, vec![4, 5, 6]);
                assert_eq!((frame.width, frame.height), (640, 360));
            }
            _ => panic!("expected a frame"),
        }
    }

    #[test]
    fn closing_a_feed_ends_its_watchers() {
        let feeds = Feeds::default();
        feeds.publish("cam0", 2, 2, vec![9]);
        let slot = feeds.slot("cam0");
        feeds.close("cam0");

        assert!(!feeds.is_live("cam0"));
        assert!(
            matches!(slot.wait_newer(0, Duration::from_millis(50)), FeedWait::Ended),
            "watchers are told the feed ended"
        );
        assert_eq!(feeds.count(), 0);
    }

    #[test]
    fn an_empty_feed_is_idle_rather_than_ended() {
        // The bug this guards: a viewer who subscribed before the publisher sent
        // its first frame was told the feed had ended and stopped watching.
        let feeds = Feeds::default();
        let slot = feeds.slot("cam0");
        assert!(
            matches!(slot.wait_newer(0, Duration::from_millis(20)), FeedWait::Idle),
            "no frames yet is idle, not ended"
        );

        feeds.publish("cam0", 8, 8, vec![1]);
        assert!(matches!(slot.wait_newer(0, Duration::from_millis(20)), FeedWait::Frame(..)));
    }

    #[test]
    fn a_publisher_between_frames_keeps_its_viewers() {
        let feeds = Feeds::default();
        feeds.publish("cam0", 8, 8, vec![1]);
        let slot = feeds.slot("cam0");
        let FeedWait::Frame(seq, _) = slot.wait_newer(0, Duration::from_millis(20)) else {
            panic!("expected the first frame");
        };
        // Nothing new since; the viewer waits rather than being disconnected.
        assert!(matches!(slot.wait_newer(seq, Duration::from_millis(20)), FeedWait::Idle));
    }

    #[test]
    fn feeds_are_independent_of_each_other() {
        let feeds = Feeds::default();
        feeds.publish("cam0", 2, 2, vec![1]);
        feeds.publish("cam1", 2, 2, vec![2]);
        assert_eq!(feeds.count(), 2);
        feeds.close("cam0");
        assert!(!feeds.is_live("cam0"));
        assert!(feeds.is_live("cam1"));
    }

    #[test]
    fn shutdown_closes_feeds_too() {
        let engine = CaptureEngine::new();
        engine.feeds.publish("cam0", 2, 2, vec![1]);
        engine.shutdown();
        assert_eq!(engine.feeds.count(), 0);
    }

    #[test]
    fn two_watchers_share_one_capture() {
        let engine = CaptureEngine::new();
        let first = engine.acquire_fake("monitor:1");
        let second = engine.acquire_fake("monitor:1");
        assert_eq!(engine.session_count(), 1, "one capture, two watchers");

        drop(first);
        assert_eq!(engine.session_count(), 1, "still watched, still capturing");

        drop(second);
        assert_eq!(engine.session_count(), 0, "last watcher left, capture released");
    }

    #[test]
    fn different_sources_get_their_own_captures() {
        let engine = CaptureEngine::new();
        let a = engine.acquire_fake("monitor:1");
        let b = engine.acquire_fake("window:99");
        assert_eq!(engine.session_count(), 2);
        drop(a);
        assert_eq!(engine.session_count(), 1);
        drop(b);
        assert_eq!(engine.session_count(), 0);
    }

    #[test]
    fn releasing_the_last_watcher_halts_the_capture() {
        // The bug this guards against: a client disconnects, nothing tells the
        // capture to stop, and it keeps reading the screen forever.
        let engine = CaptureEngine::new();
        let handle = engine.acquire_fake("monitor:2");
        let latest = handle.session().latest.clone();
        assert_eq!(engine.halted("monitor:2"), Some(false));

        drop(handle);
        assert!(latest.has_ended(), "the frame mailbox is closed");
        assert_eq!(engine.session_count(), 0);
    }

    #[test]
    fn shutdown_stops_everything_still_running() {
        let engine = CaptureEngine::new();
        let a = engine.acquire_fake("monitor:1");
        let b = engine.acquire_fake("monitor:2");
        let latest = a.session().latest.clone();

        engine.shutdown();
        assert_eq!(engine.session_count(), 0);
        assert!(latest.has_ended());

        // Handles outliving the engine's map must not panic on drop.
        drop(a);
        drop(b);
    }

    #[test]
    fn stats_average_encode_time() {
        let stats = Stats::default();
        assert_eq!(stats.encode_ms_avg(), 0.0, "no samples means zero, not NaN");
        stats.record_encode(2_000_000, 100);
        stats.record_encode(4_000_000, 100);
        assert!((stats.encode_ms_avg() - 3.0).abs() < 0.001);
        assert_eq!(stats.bytes_sent.load(Ordering::Relaxed), 200);
    }
}
