//! What Screen Stuff can put on the board: monitors, windows, and crops of either.
//!
//! Source ids are strings so they survive a round-trip through JSON, localStorage
//! and a saved board file:
//!
//! ```text
//!   monitor:<index>
//!   window:<hwnd>
//!   region:<parent-source>@<x>,<y>,<w>,<h>
//! ```
//!
//! A region's parent is a full source id, so `region:monitor:1@100,100,800,600`
//! is a crop of monitor 1 and reuses monitor 1's capture session rather than
//! opening a second one.

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Monitor,
    Window,
    Region,
    /// Pushed in by the host rather than captured by the engine — a webcam.
    Feed,
}

/// A parsed source id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceId {
    Monitor { index: usize },
    Window { hwnd: isize },
    Region { parent: Box<SourceId>, x: u32, y: u32, w: u32, h: u32 },
    Feed { name: String },
}

impl SourceId {
    pub fn parse(raw: &str) -> Result<Self, ParseError> {
        if let Some(rest) = raw.strip_prefix("monitor:") {
            let index = rest.parse::<usize>().map_err(|_| ParseError::BadMonitorIndex)?;
            return Ok(Self::Monitor { index });
        }
        if let Some(rest) = raw.strip_prefix("window:") {
            let hwnd = rest.parse::<isize>().map_err(|_| ParseError::BadWindowHandle)?;
            if hwnd == 0 {
                return Err(ParseError::BadWindowHandle);
            }
            return Ok(Self::Window { hwnd });
        }
        if let Some(rest) = raw.strip_prefix("feed:") {
            let ok = !rest.is_empty()
                && rest.len() <= 64
                && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
            if !ok {
                return Err(ParseError::BadFeedName);
            }
            return Ok(Self::Feed { name: rest.to_string() });
        }
        if let Some(rest) = raw.strip_prefix("region:") {
            let (parent_raw, rect_raw) = rest.rsplit_once('@').ok_or(ParseError::BadRegion)?;
            let parent = Self::parse(parent_raw)?;
            if matches!(parent, Self::Region { .. }) {
                return Err(ParseError::NestedRegion);
            }
            let nums: Vec<u32> = rect_raw
                .split(',')
                .map(|n| n.trim().parse::<u32>().map_err(|_| ParseError::BadRegion))
                .collect::<Result<_, _>>()?;
            let [x, y, w, h] = nums.as_slice() else {
                return Err(ParseError::BadRegion);
            };
            if *w == 0 || *h == 0 {
                return Err(ParseError::EmptyRegion);
            }
            return Ok(Self::Region { parent: Box::new(parent), x: *x, y: *y, w: *w, h: *h });
        }
        Err(ParseError::UnknownScheme)
    }

    /// The source that actually owns a capture session. A region rides on its parent.
    pub fn capture_root(&self) -> &SourceId {
        match self {
            Self::Region { parent, .. } => parent,
            other => other,
        }
    }

    /// The crop to apply to the parent's frames, if any.
    pub fn crop(&self) -> Option<(u32, u32, u32, u32)> {
        match self {
            Self::Region { x, y, w, h, .. } => Some((*x, *y, *w, *h)),
            _ => None,
        }
    }

    pub fn kind(&self) -> SourceKind {
        match self {
            Self::Monitor { .. } => SourceKind::Monitor,
            Self::Window { .. } => SourceKind::Window,
            Self::Region { .. } => SourceKind::Region,
            Self::Feed { .. } => SourceKind::Feed,
        }
    }

    /// True for sources the host pushes rather than the engine captures.
    pub fn is_feed(&self) -> bool {
        matches!(self, Self::Feed { .. })
    }
}

impl fmt::Display for SourceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Monitor { index } => write!(f, "monitor:{index}"),
            Self::Window { hwnd } => write!(f, "window:{hwnd}"),
            Self::Region { parent, x, y, w, h } => write!(f, "region:{parent}@{x},{y},{w},{h}"),
            Self::Feed { name } => write!(f, "feed:{name}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ParseError {
    #[error("source id has an unknown scheme")]
    UnknownScheme,
    #[error("monitor index is not a number")]
    BadMonitorIndex,
    #[error("window handle is not valid")]
    BadWindowHandle,
    #[error("region must look like region:<parent>@x,y,w,h")]
    BadRegion,
    #[error("a region cannot be a crop of another region")]
    NestedRegion,
    #[error("a region needs a non-zero width and height")]
    EmptyRegion,
    #[error("a feed name must be short and alphanumeric")]
    BadFeedName,
}

/// What the operator is working in right now.
///
/// Desktop coordinates, the same space `SourceInfo` reports monitors in, so the
/// two can be compared without a conversion step that could disagree.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Focus {
    /// `window:<hwnd>`, so it can be matched against a source tile directly.
    pub window: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// `monitor:<n>` holding most of the window, when there is one.
    pub monitor: Option<String>,
}

/// Where the pointer is on the desk, in the same space monitors are reported in.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    pub x: i32,
    pub y: i32,
    /// True while the primary button is held.
    pub down: bool,
}

/// One row in the cockpit's source rail.
#[derive(Debug, Clone, Serialize)]
pub struct SourceInfo {
    pub id: String,
    pub kind: SourceKind,
    /// What the operator reads: monitor name or window title.
    pub title: String,
    /// The quieter second line: resolution, or the owning app.
    pub subtitle: String,
    pub width: u32,
    pub height: u32,
    /// Desktop-space position, so the cockpit can lay monitors out the way they sit on the desk.
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

#[cfg(windows)]
mod platform {
    use super::{SourceInfo, SourceKind};
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO, MONITORINFOEXW};

    /// `MONITORINFOF_PRIMARY` — not re-exported by the `windows` crate's Gdi module.
    const MONITOR_FLAG_PRIMARY: u32 = 1;
    use windows_capture::monitor::Monitor;
    use windows_capture::window::Window;

    fn monitor_rect(m: &Monitor) -> Option<(RECT, bool)> {
        let hmonitor = HMONITOR(m.as_raw_hmonitor());
        let mut info = MONITORINFOEXW {
            monitorInfo: MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        let ok = unsafe {
            GetMonitorInfoW(hmonitor, std::ptr::addr_of_mut!(info) as *mut MONITORINFO).as_bool()
        };
        if !ok {
            return None;
        }
        let primary = info.monitorInfo.dwFlags & MONITOR_FLAG_PRIMARY != 0;
        Some((info.monitorInfo.rcMonitor, primary))
    }

    pub fn list_monitors() -> Vec<SourceInfo> {
        let Ok(monitors) = Monitor::enumerate() else {
            return Vec::new();
        };
        monitors
            .into_iter()
            .enumerate()
            .filter_map(|(i, m)| {
                let width = m.width().ok()?;
                let height = m.height().ok()?;
                let (rect, is_primary) = monitor_rect(&m).unwrap_or((RECT::default(), false));
                let name = m
                    .name()
                    .ok()
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or_else(|| format!("Display {}", i + 1));
                let refresh = m.refresh_rate().unwrap_or(0);
                let subtitle = if refresh > 0 {
                    format!("{width} x {height} @ {refresh}Hz")
                } else {
                    format!("{width} x {height}")
                };
                Some(SourceInfo {
                    // `Monitor::from_index` is 1-based in windows-capture, and that is
                    // the index we hand back out, so round-tripping an id is lossless.
                    id: format!("monitor:{}", i + 1),
                    kind: SourceKind::Monitor,
                    title: name,
                    subtitle,
                    width,
                    height,
                    x: rect.left,
                    y: rect.top,
                    is_primary,
                })
            })
            .collect()
    }

    /// Windows worth showing. WGC can capture a window that is fully covered by
    /// other windows, which is the whole point — but it cannot capture one that
    /// is minimised, and a 1x1 tool window is noise in the rail.
    pub fn list_windows() -> Vec<SourceInfo> {
        let Ok(windows) = Window::enumerate() else {
            return Vec::new();
        };
        let own_pid = std::process::id();
        let mut out: Vec<SourceInfo> = windows
            .into_iter()
            .filter_map(|w| {
                let title = w.title().ok()?;
                let title = title.trim().to_string();
                if title.is_empty() {
                    return None;
                }
                if w.process_id().ok()? == own_pid {
                    return None; // never offer to capture ourselves
                }
                let rect = w.rect().ok()?;
                let width = (rect.right - rect.left).max(0) as u32;
                let height = (rect.bottom - rect.top).max(0) as u32;
                if width < 160 || height < 120 {
                    return None;
                }
                let process = w.process_name().unwrap_or_default();
                let hwnd = w.as_raw_hwnd() as isize;
                Some(SourceInfo {
                    id: format!("window:{hwnd}"),
                    kind: SourceKind::Window,
                    title,
                    subtitle: if process.is_empty() {
                        format!("{width} x {height}")
                    } else {
                        format!("{process}  ·  {width} x {height}")
                    },
                    width,
                    height,
                    x: rect.left,
                    y: rect.top,
                    is_primary: false,
                })
            })
            .collect();
        out.sort_by_key(|w| w.title.to_lowercase());
        out
    }

    pub fn window_is_alive(hwnd: isize) -> bool {
        Window::from_raw_hwnd(hwnd as *mut std::ffi::c_void).is_valid()
    }

    pub fn foreground_window_id() -> Option<String> {
        let w = Window::foreground().ok()?;
        if w.process_id().ok()? == std::process::id() {
            return None;
        }
        Some(format!("window:{}", w.as_raw_hwnd() as isize))
    }

    /// The window the operator is working in, and where it sits on the desk.
    ///
    /// Auto-framing needs more than "which window": it needs the rectangle, so
    /// the shot can find that window inside a monitor tile even when the window
    /// itself was never added to the board.
    pub fn foreground_focus() -> Option<super::Focus> {
        let w = Window::foreground().ok()?;
        if w.process_id().ok()? == std::process::id() {
            // Our own cockpit is not "work" — following it would point the shot
            // at the control surface every time the operator touched it.
            return None;
        }
        let hwnd = w.as_raw_hwnd() as isize;
        let rect = window_rect(hwnd)?;
        let monitor = monitor_containing(rect.0, rect.1, rect.2, rect.3);
        Some(super::Focus {
            window: format!("window:{hwnd}"),
            title: w.title().unwrap_or_default(),
            x: rect.0,
            y: rect.1,
            width: rect.2.max(1) as u32,
            height: rect.3.max(1) as u32,
            monitor,
        })
    }

    fn window_rect(hwnd: isize) -> Option<(i32, i32, i32, i32)> {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
        let handle = hwnd_from_isize(hwnd);
        let mut rect = RECT::default();
        // The extended frame bounds, not GetWindowRect: the latter includes the
        // invisible resize border, which on Windows 10 is several pixels of
        // nothing and would put the shot slightly off every window it framed.
        let ok = unsafe {
            DwmGetWindowAttribute(
                handle,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut RECT as *mut std::ffi::c_void,
                std::mem::size_of::<RECT>() as u32,
            )
        };
        if ok.is_err() {
            return None;
        }
        let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
        if w <= 0 || h <= 0 {
            return None;
        }
        Some((rect.left, rect.top, w, h))
    }

    /// The monitor holding most of a rectangle.
    fn monitor_containing(x: i32, y: i32, w: i32, h: i32) -> Option<String> {
        let mut best: Option<(i64, String)> = None;
        for m in list_monitors() {
            let ox = (x + w).min(m.x + m.width as i32) - x.max(m.x);
            let oy = (y + h).min(m.y + m.height as i32) - y.max(m.y);
            if ox <= 0 || oy <= 0 {
                continue;
            }
            let area = ox as i64 * oy as i64;
            if best.as_ref().is_none_or(|(a, _)| area > *a) {
                best = Some((area, m.id.clone()));
            }
        }
        best.map(|(_, id)| id)
    }

    /// Where the pointer is, and whether a button is down.
    ///
    /// Polled with the frames rather than hooked. A global mouse hook would see
    /// every movement on the machine and cost more than it is worth; the shot
    /// only needs to know where the cursor is a few times a second.
    pub fn cursor_state() -> Option<super::Cursor> {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut point = POINT::default();
        unsafe { GetCursorPos(&mut point) }.ok()?;
        // The high bit is "down right now", as opposed to "was pressed since
        // the last call", which would double-count.
        let down = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000 != 0;
        Some(super::Cursor { x: point.x, y: point.y, down })
    }

    /// Desktop-space bounding box of every monitor, used to place region overlays.
    pub fn virtual_desktop_bounds() -> (i32, i32, i32, i32) {
        let monitors = list_monitors();
        if monitors.is_empty() {
            return (0, 0, 1920, 1080);
        }
        let left = monitors.iter().map(|m| m.x).min().unwrap_or(0);
        let top = monitors.iter().map(|m| m.y).min().unwrap_or(0);
        let right = monitors.iter().map(|m| m.x + m.width as i32).max().unwrap_or(1920);
        let bottom = monitors.iter().map(|m| m.y + m.height as i32).max().unwrap_or(1080);
        (left, top, right - left, bottom - top)
    }

    #[allow(dead_code)]
    pub fn hwnd_from_isize(v: isize) -> HWND {
        HWND(v as *mut std::ffi::c_void)
    }
}


#[cfg(target_os = "macos")]
mod platform {
    //! The macOS half of everything the Windows module does.
    //!
    //! Displays and windows come from ScreenCaptureKit, so the list the cockpit
    //! shows and the thing the engine captures are the same objects rather than
    //! two views that can disagree. The pointer and the focused window come from
    //! Core Graphics, which is the only place they live.

    use super::{Cursor, Focus, SourceInfo, SourceKind};
    use screencapturekit::prelude::SCShareableContent;

    fn content() -> Option<SCShareableContent> {
        SCShareableContent::get().ok()
    }

    pub fn list_monitors() -> Vec<SourceInfo> {
        let Some(content) = content() else { return Vec::new() };
        content
            .displays()
            .iter()
            .enumerate()
            .map(|(i, display)| {
                let frame = display.frame();
                SourceInfo {
                    // 1-based, matching the Windows side and the way people
                    // count their own monitors.
                    id: format!("monitor:{}", i + 1),
                    kind: SourceKind::Monitor,
                    title: format!("Display {}", i + 1),
                    subtitle: format!("{} x {}", display.width(), display.height()),
                    width: display.width(),
                    height: display.height(),
                    x: frame.origin.x as i32,
                    y: frame.origin.y as i32,
                    // Core Graphics puts the main display at the origin.
                    is_primary: frame.origin.x == 0.0 && frame.origin.y == 0.0,
                }
            })
            .collect()
    }

    pub fn list_windows() -> Vec<SourceInfo> {
        let Some(content) = content() else { return Vec::new() };
        let mine = std::process::id();
        content
            .windows()
            .iter()
            .filter(|w| {
                // Same rules as the Windows list: on screen, big enough to be
                // worth showing, and never one of our own.
                let frame = w.frame();
                w.is_on_screen()
                    && frame.size.width >= 160.0
                    && frame.size.height >= 120.0
                    && w.owning_application()
                        .map(|a| a.process_id() as u32 != mine)
                        .unwrap_or(true)
            })
            .map(|w| {
                let frame = w.frame();
                // application_name is a String, not an Option: an app with no
                // name reports an empty one.
                let app = w.owning_application().map(|a| a.application_name()).unwrap_or_default();
                SourceInfo {
                    id: format!("window:{}", w.window_id()),
                    kind: SourceKind::Window,
                    title: w.title().unwrap_or_else(|| app.clone()),
                    subtitle: app,
                    width: frame.size.width.max(0.0) as u32,
                    height: frame.size.height.max(0.0) as u32,
                    x: frame.origin.x as i32,
                    y: frame.origin.y as i32,
                    is_primary: false,
                }
            })
            .collect()
    }

    pub fn window_is_alive(id: isize) -> bool {
        crate::capture_mac::window_is_alive(id)
    }

    pub fn foreground_window_id() -> Option<String> {
        foreground_focus().map(|f| f.window)
    }

    /// The frontmost window, and the display holding most of it.
    pub fn foreground_focus() -> Option<Focus> {
        let content = content()?;
        let mine = std::process::id();
        // `is_active` is ScreenCaptureKit's own notion of the frontmost window,
        // which is the same one the user would point at.
        let window = content.windows().into_iter().find(|w| {
            w.is_active()
                && w.is_on_screen()
                && w.owning_application()
                    .map(|a| a.process_id() as u32 != mine)
                    .unwrap_or(true)
        })?;
        let frame = window.frame();
        let monitor = monitor_containing(
            frame.origin.x as i32,
            frame.origin.y as i32,
            frame.size.width as i32,
            frame.size.height as i32,
        );
        Some(Focus {
            window: format!("window:{}", window.window_id()),
            title: window.title().unwrap_or_default(),
            x: frame.origin.x as i32,
            y: frame.origin.y as i32,
            width: frame.size.width.max(1.0) as u32,
            height: frame.size.height.max(1.0) as u32,
            monitor,
        })
    }

    fn monitor_containing(x: i32, y: i32, w: i32, h: i32) -> Option<String> {
        let mut best: Option<(i64, String)> = None;
        for m in list_monitors() {
            let ox = (x + w).min(m.x + m.width as i32) - x.max(m.x);
            let oy = (y + h).min(m.y + m.height as i32) - y.max(m.y);
            if ox <= 0 || oy <= 0 {
                continue;
            }
            let area = ox as i64 * oy as i64;
            if best.as_ref().is_none_or(|(a, _)| area > *a) {
                best = Some((area, m.id.clone()));
            }
        }
        best.map(|(_, id)| id)
    }

    /// Whether a mouse button is down *right now*.
    ///
    /// Declared here because the core-graphics crate does not wrap it, and the
    /// alternative — reading it off a synthesised event — answers a different
    /// question. This is the exact counterpart of the Windows side's
    /// GetAsyncKeyState: the state of the button now, not whether it has been
    /// pressed since anyone last asked.
    ///
    /// The framework is already linked by core-graphics; this only names one
    /// more function in it.
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
    }

    /// kCGEventSourceStateCombinedSessionState — the whole login session,
    /// which is what "is the user pressing the mouse" means.
    const COMBINED_SESSION_STATE: i32 = 1;
    /// kCGMouseButtonLeft.
    const LEFT_BUTTON: u32 = 0;

    pub fn cursor_state() -> Option<Cursor> {
        use core_graphics::event::CGEvent;
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

        // A source and an event with no type: the only thing read off it is
        // the location, which CGEvent fills in from the current cursor.
        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
        let point = CGEvent::new(source).ok()?.location();
        let down = unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT_BUTTON) };
        Some(Cursor { x: point.x as i32, y: point.y as i32, down })
    }

    pub fn virtual_desktop_bounds() -> (i32, i32, i32, i32) {
        let monitors = list_monitors();
        if monitors.is_empty() {
            return (0, 0, 1920, 1080);
        }
        let left = monitors.iter().map(|m| m.x).min().unwrap_or(0);
        let top = monitors.iter().map(|m| m.y).min().unwrap_or(0);
        let right = monitors.iter().map(|m| m.x + m.width as i32).max().unwrap_or(1920);
        let bottom = monitors.iter().map(|m| m.y + m.height as i32).max().unwrap_or(1080);
        (left, top, right - left, bottom - top)
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::SourceInfo;
    pub fn list_monitors() -> Vec<SourceInfo> {
        Vec::new()
    }
    pub fn list_windows() -> Vec<SourceInfo> {
        Vec::new()
    }
    pub fn window_is_alive(_hwnd: isize) -> bool {
        false
    }
    pub fn foreground_window_id() -> Option<String> {
        None
    }
    pub fn foreground_focus() -> Option<super::Focus> {
        None
    }
    pub fn cursor_state() -> Option<super::Cursor> {
        None
    }
    pub fn virtual_desktop_bounds() -> (i32, i32, i32, i32) {
        (0, 0, 1920, 1080)
    }
}

pub use platform::{
    cursor_state, foreground_focus, foreground_window_id, list_monitors, list_windows,
    virtual_desktop_bounds, window_is_alive,
};

/// Everything the cockpit's source rail needs, in one call.
pub fn list_all() -> Vec<SourceInfo> {
    let mut all = list_monitors();
    all.extend(list_windows());
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_monitor_ids() {
        assert_eq!(SourceId::parse("monitor:2").unwrap(), SourceId::Monitor { index: 2 });
        assert!(SourceId::parse("monitor:x").is_err());
    }

    #[test]
    fn parses_window_ids_and_rejects_null_handles() {
        assert_eq!(SourceId::parse("window:12345").unwrap(), SourceId::Window { hwnd: 12345 });
        assert_eq!(SourceId::parse("window:0").unwrap_err(), ParseError::BadWindowHandle);
    }

    #[test]
    fn parses_regions_and_keeps_the_parent() {
        let id = SourceId::parse("region:monitor:1@10,20,800,600").unwrap();
        assert_eq!(id.crop(), Some((10, 20, 800, 600)));
        assert_eq!(*id.capture_root(), SourceId::Monitor { index: 1 });
        assert_eq!(id.kind(), SourceKind::Region);
    }

    #[test]
    fn region_of_a_window_keeps_the_window_as_root() {
        let id = SourceId::parse("region:window:9988@0,0,320,240").unwrap();
        assert_eq!(*id.capture_root(), SourceId::Window { hwnd: 9988 });
    }

    #[test]
    fn rejects_nested_and_empty_regions() {
        assert_eq!(
            SourceId::parse("region:region:monitor:1@0,0,10,10@0,0,5,5").unwrap_err(),
            ParseError::NestedRegion
        );
        assert_eq!(
            SourceId::parse("region:monitor:1@0,0,0,600").unwrap_err(),
            ParseError::EmptyRegion
        );
    }

    #[test]
    fn display_round_trips_through_parse() {
        for raw in ["monitor:3", "window:77", "region:monitor:1@5,6,700,800"] {
            let parsed = SourceId::parse(raw).unwrap();
            assert_eq!(parsed.to_string(), raw);
            assert_eq!(SourceId::parse(&parsed.to_string()).unwrap(), parsed);
        }
    }

    #[test]
    fn parses_feed_ids_and_rejects_awkward_names() {
        let id = SourceId::parse("feed:cam-t_12").unwrap();
        assert_eq!(id, SourceId::Feed { name: "cam-t_12".into() });
        assert_eq!(id.kind(), SourceKind::Feed);
        assert!(id.is_feed());
        assert_eq!(id.to_string(), "feed:cam-t_12");

        for bad in ["feed:", "feed:has space", "feed:../etc", &format!("feed:{}", "x".repeat(65))] {
            assert_eq!(SourceId::parse(bad).unwrap_err(), ParseError::BadFeedName, "{bad}");
        }
    }

    #[test]
    fn a_feed_is_its_own_capture_root() {
        let id = SourceId::parse("feed:cam0").unwrap();
        assert_eq!(*id.capture_root(), id);
        assert_eq!(id.crop(), None);
    }

    #[test]
    fn unknown_scheme_is_an_error() {
        assert_eq!(SourceId::parse("camera:0").unwrap_err(), ParseError::UnknownScheme);
        assert_eq!(SourceId::parse("").unwrap_err(), ParseError::UnknownScheme);
    }
}
