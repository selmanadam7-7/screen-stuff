//! Screen Stuff — an infinite board that holds every screen you have.
//!
//! Two windows out of one process:
//!   * **cockpit** (`index.html`) — the control surface, lives on a spare monitor
//!   * **board** (`board.html`) — the clean canvas that actually goes on air
//!
//! Rust owns capture, encoding, persistence and window geometry. Everything
//! visual happens in the board webview, which keeps one composited canvas as the
//! single source of truth for what the audience sees.

// Public so the dev harnesses under `examples/` can stand the engine up without
// the app shell. Nothing here is a stable API for anyone else.
pub mod capture;
pub mod guest;
pub mod guest_server;
pub mod protocol;
pub mod server;
pub mod sources;
pub mod store;
pub mod tunnel;

use capture::CaptureEngine;
use guest::{GuestHub, GuestInfo, Powers};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sources::SourceInfo;
use std::collections::HashSet;
use std::sync::Arc;
use store::{BoardMeta, BoardRecord, Store};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub struct AppState {
    engine: Arc<CaptureEngine>,
    stream_url: String,
    store: Store,
    /// Remembers where the board was before it went full-screen on a monitor.
    board_restore: Mutex<Option<(i32, i32, u32, u32)>>,
    /// Labels handed out to web-tile windows.
    web_counter: Mutex<u32>,
    /// Web tiles currently pulled forward for interaction.
    interacting_web: Mutex<HashSet<String>>,
    guests: Arc<GuestHub>,
    /// The public door onto the guest server, when one is open.
    tunnel: Arc<tunnel::Tunnel>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    stream_url: String,
    version: String,
    data_dir: String,
    desktop: DesktopBounds,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

type CmdResult<T> = Result<T, String>;

fn oops(err: impl std::fmt::Display) -> String {
    err.to_string()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn session_info(state: tauri::State<'_, AppState>) -> SessionInfo {
    let (x, y, width, height) = sources::virtual_desktop_bounds();
    let (width, height) = (width.max(0) as u32, height.max(0) as u32);
    SessionInfo {
        stream_url: state.stream_url.clone(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: state.store.root().display().to_string(),
        desktop: DesktopBounds { x, y, width, height },
    }
}

#[tauri::command]
fn list_sources() -> Vec<SourceInfo> {
    sources::list_all()
}

#[tauri::command]
fn list_monitors() -> Vec<SourceInfo> {
    sources::list_monitors()
}

/// Used by "grab whatever I'm looking at" — the fastest way onto the board.
#[tauri::command]
fn foreground_window() -> Option<String> {
    sources::foreground_window_id()
}

/// What the operator is working in, for auto-framing.
///
/// Polled rather than pushed: Windows will happily tell you about focus
/// changes through a hook, but a hook in this process would fire on every
/// window on the machine and we want one number a few times a second.
#[tauri::command]
fn foreground_focus() -> Option<sources::Focus> {
    sources::foreground_focus()
}

#[tauri::command]
fn source_is_alive(state: tauri::State<'_, AppState>, id: String) -> bool {
    match sources::SourceId::parse(&id) {
        Ok(sources::SourceId::Window { hwnd }) => sources::window_is_alive(hwnd),
        Ok(sources::SourceId::Region { ref parent, .. }) => match **parent {
            sources::SourceId::Window { hwnd } => sources::window_is_alive(hwnd),
            _ => true,
        },
        // A feed is alive while something is publishing to it; the tile shows
        // its own "waiting" state until frames arrive.
        Ok(sources::SourceId::Feed { ref name }) => state.engine.feeds.is_live(name),
        Ok(_) => true,
        Err(_) => false,
    }
}

#[tauri::command]
fn board_list(state: tauri::State<'_, AppState>) -> CmdResult<Vec<BoardMeta>> {
    state.store.list().map_err(oops)
}

#[tauri::command]
fn board_save(state: tauri::State<'_, AppState>, record: BoardRecord) -> CmdResult<BoardMeta> {
    state.store.save(record).map_err(oops)
}

#[tauri::command]
fn board_load(state: tauri::State<'_, AppState>, id: String) -> CmdResult<BoardRecord> {
    state.store.load(&id).map_err(oops)
}

#[tauri::command]
fn board_delete(state: tauri::State<'_, AppState>, id: String) -> CmdResult<()> {
    state.store.delete(&id).map_err(oops)
}

#[tauri::command]
fn settings_get(state: tauri::State<'_, AppState>) -> serde_json::Value {
    state.store.read_settings()
}

#[tauri::command]
fn settings_set(state: tauri::State<'_, AppState>, value: serde_json::Value) -> CmdResult<()> {
    state.store.write_settings(&value).map_err(oops)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardGeometry {
    x: Option<i32>,
    y: Option<i32>,
    width: Option<u32>,
    height: Option<u32>,
}

fn board_window(app: &tauri::AppHandle) -> CmdResult<WebviewWindow> {
    app.get_webview_window("board").ok_or_else(|| "the board window is not open".to_string())
}

#[tauri::command]
fn board_show(app: tauri::AppHandle) -> CmdResult<()> {
    let window = board_window(&app)?;
    window.show().map_err(oops)?;
    window.set_focus().map_err(oops)?;
    Ok(())
}

#[tauri::command]
fn board_hide(app: tauri::AppHandle) -> CmdResult<()> {
    board_window(&app)?.hide().map_err(oops)
}

#[tauri::command]
fn board_set_geometry(app: tauri::AppHandle, geometry: BoardGeometry) -> CmdResult<()> {
    let window = board_window(&app)?;
    if let (Some(width), Some(height)) = (geometry.width, geometry.height) {
        window
            .set_size(PhysicalSize::new(width.max(320), height.max(180)))
            .map_err(oops)?;
    }
    if let (Some(x), Some(y)) = (geometry.x, geometry.y) {
        window.set_position(PhysicalPosition::new(x, y)).map_err(oops)?;
    }
    Ok(())
}

/// Fill one monitor with the board — the "put it on screen 3 and forget it" move.
#[tauri::command]
fn board_fill_monitor(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    monitor_id: String,
) -> CmdResult<()> {
    let window = board_window(&app)?;
    let target = sources::list_monitors()
        .into_iter()
        .find(|m| m.id == monitor_id)
        .ok_or_else(|| format!("no monitor called {monitor_id}"))?;

    if state.board_restore.lock().is_none() {
        let pos = window.outer_position().map_err(oops)?;
        let size = window.outer_size().map_err(oops)?;
        *state.board_restore.lock() = Some((pos.x, pos.y, size.width, size.height));
    }

    window.set_position(PhysicalPosition::new(target.x, target.y)).map_err(oops)?;
    window.set_size(PhysicalSize::new(target.width, target.height)).map_err(oops)?;
    window.show().map_err(oops)?;
    Ok(())
}

#[tauri::command]
fn board_restore_geometry(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CmdResult<()> {
    let window = board_window(&app)?;
    if let Some((x, y, w, h)) = state.board_restore.lock().take() {
        window.set_position(PhysicalPosition::new(x, y)).map_err(oops)?;
        window.set_size(PhysicalSize::new(w, h)).map_err(oops)?;
    }
    Ok(())
}

#[tauri::command]
fn board_set_always_on_top(app: tauri::AppHandle, on_top: bool) -> CmdResult<()> {
    board_window(&app)?.set_always_on_top(on_top).map_err(oops)
}

// ---------------------------------------------------------------------------
// Camera permission
// ---------------------------------------------------------------------------

/// Let our own webviews open the camera and microphone without a prompt.
///
/// WebView2 asks the user per webview, and if they ever pick Block there is no
/// way back: the choice is stored in the browser data folder and never
/// re-prompted, so a single misclick would permanently break camera tiles with
/// no visible cause. A native app in this position does not ask twice — Windows'
/// own camera privacy setting is still the real gate, and Screen Stuff only
/// touches a camera when you put a camera tile on the board.
#[cfg(windows)]
fn allow_media_capture(window: &WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    let label = window.label().to_string();
    let result = window.with_webview(move |webview| unsafe {
        let core = match webview.controller().CoreWebView2() {
            Ok(core) => core,
            Err(err) => {
                tracing::warn!("no WebView2 core for {label}: {err}");
                return;
            }
        };
        let mut token = std::mem::zeroed();
        let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = Default::default();
            args.PermissionKind(&mut kind)?;
            if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                || kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
            {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        if let Err(err) = core.add_PermissionRequested(&handler, &mut token) {
            tracing::warn!("could not take over media permissions for {label}: {err}");
        }
    });
    if let Err(err) = result {
        tracing::warn!("could not reach the webview to grant media access: {err}");
    }
}

#[cfg(not(windows))]
fn allow_media_capture(_window: &WebviewWindow) {}

// ---------------------------------------------------------------------------
// Guests
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestStatus {
    running: bool,
    /// The address for someone on this network.
    link: Option<String>,
    /// The address for someone anywhere, when the tunnel is up.
    public_link: Option<String>,
    tunnel: tunnel::TunnelStatus,
    guests: Vec<GuestInfo>,
}

/// Open the guest link. Off until asked for, and on its own port and token.
#[tauri::command]
async fn guest_start(state: tauri::State<'_, AppState>) -> CmdResult<GuestStatus> {
    if state.guests.is_running() {
        return Ok(guest_status_of(&state));
    }
    let server = guest_server::start(state.guests.clone(), 0).await.map_err(|e| format!("{e:#}"))?;
    state.guests.set_running(server);
    Ok(guest_status_of(&state))
}

#[tauri::command]
fn guest_stop(state: tauri::State<'_, AppState>) -> GuestStatus {
    // Order matters: a tunnel left open after the server behind it stops is a
    // public address pointing at whatever takes that port next.
    state.tunnel.stop();
    state.guests.stop();
    guest_status_of(&state)
}

#[tauri::command]
fn guest_status(state: tauri::State<'_, AppState>) -> GuestStatus {
    guest_status_of(&state)
}

/// Tell guests what to render. Called by the cockpit whenever the board changes.
#[tauri::command]
fn guest_publish(
    state: tauri::State<'_, AppState>,
    doc: serde_json::Value,
    frame: serde_json::Value,
    powers: Powers,
) {
    state.guests.publish(doc, frame, powers);
}

fn guest_status_of(state: &tauri::State<'_, AppState>) -> GuestStatus {
    GuestStatus {
        running: state.guests.is_running(),
        link: state.guests.link(),
        public_link: public_link_of(state),
        tunnel: state.tunnel.status(),
        guests: state.guests.roster(),
    }
}

/// The same guest path, on the public origin instead of the LAN one.
fn public_link_of(state: &tauri::State<'_, AppState>) -> Option<String> {
    let origin = state.tunnel.url()?;
    let path = state.guests.link()?;
    // Reuse the path the guest server already published rather than rebuilding
    // it, so the two links can never disagree about the token.
    let path = path.split_once("//")?.1.split_once('/')?.1;
    Some(format!("{origin}/{path}"))
}

/// Open a public address for the guest link.
///
/// Deliberately separate from `guest_start`: putting the board on the internet
/// is a bigger decision than putting it on your own network, and it should take
/// its own deliberate press.
#[tauri::command]
async fn tunnel_start(state: tauri::State<'_, AppState>) -> CmdResult<GuestStatus> {
    let port = state.guests.port().ok_or("open the guest link first")?;
    let tunnel = state.tunnel.clone();
    // Downloads on first use and then waits on Cloudflare, so it cannot run on
    // the thread answering this command.
    tauri::async_runtime::spawn_blocking(move || tunnel.start(port))
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(|e| format!("{e:#}"))?;
    Ok(guest_status_of(&state))
}

#[tauri::command]
fn tunnel_stop(state: tauri::State<'_, AppState>) -> GuestStatus {
    state.tunnel.stop();
    guest_status_of(&state)
}

// ---------------------------------------------------------------------------
// Media files
// ---------------------------------------------------------------------------
//
// A file dropped onto the board used to become a `blob:` URL. Those are scoped
// to the document that made them, so the picture showed in the cockpit and was
// missing everywhere it actually mattered: the board window is a different
// document, a guest is a different machine entirely, and a saved board reopened
// tomorrow has no blob to point at. Copying the bytes into our own directory
// once fixes all three, and costs a file copy.

/// Copy bytes into the app's media directory and return the path.
#[tauri::command]
fn media_import(name: String, bytes: Vec<u8>) -> CmdResult<String> {
    let dir = store::app_data_dir().map_err(oops)?.join("media");
    std::fs::create_dir_all(&dir).map_err(oops)?;

    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("bin")
        .to_ascii_lowercase();

    // Content-addressed, so dropping the same picture onto ten boards keeps one
    // copy and reopening a board finds the file already there.
    let digest = short_digest(&bytes);
    let path = dir.join(format!("{digest}.{extension}"));
    if !path.exists() {
        std::fs::write(&path, &bytes).map_err(oops)?;
    }
    Ok(path.to_string_lossy().to_string())
}

/// Copy a file already on disk into the media directory.
#[tauri::command]
fn media_adopt(path: String) -> CmdResult<String> {
    let bytes = std::fs::read(&path).map_err(oops)?;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    media_import(name, bytes)
}

/// A short, stable name for a blob of bytes.
///
/// FNV-1a over the content plus the length. Not a security hash and not trying
/// to be: this only has to make accidental collisions vanishingly unlikely
/// between a few hundred images on one person's machine.
fn short_digest(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for chunk in bytes.chunks(64) {
        for b in chunk {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(0x100_0000_01b3);
        }
    }
    hash ^= bytes.len() as u64;
    hash = hash.wrapping_mul(0x100_0000_01b3);
    format!("{hash:016x}")
}

// ---------------------------------------------------------------------------
// Web tiles
// ---------------------------------------------------------------------------
//
// A web tile is not an iframe. An iframe cannot be composited into the output
// canvas, which would mean web tiles vanished in camera mode and for guests.
// Instead each one is a real browser window that Screen Stuff owns, parked
// offscreen and captured like any other window — so it behaves exactly like a
// monitor tile everywhere it matters. This is the same trade OBS makes.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSource {
    label: String,
    source: String,
}

/// Somewhere off every monitor, but still composed by the desktop manager.
/// Where a web tile's window lives while it is only being captured.
///
/// Just past the right edge of every monitor, in *physical* pixels. Windows
/// composites it there through DWM, so Windows Graphics Capture still sees it
/// even though no human can.
fn park_position() -> (i32, i32) {
    let (x, y, width, _height) = sources::virtual_desktop_bounds();
    (x + width + 64, y)
}

/// True when a window at this rectangle would be visible on some monitor.
fn overlaps_a_monitor(x: i32, y: i32, width: i32, height: i32) -> bool {
    sources::list_monitors().iter().any(|m| {
        x < m.x + m.width as i32
            && m.x < x + width
            && y < m.y + m.height as i32
            && m.y < y + height
    })
}

/// Put a web-tile window where nobody can see it, and make sure it stayed.
///
/// Three things go wrong if this is left to the window builder. Its `position`
/// is in *logical* pixels while every monitor number we have is physical, so on
/// a scaled display the window lands somewhere else entirely. A window built
/// visible can be shown for a frame before it is moved, which on a call reads as
/// a browser window flashing over everything. And whatever the reason, if it
/// does end up on screen there is nothing to notice or correct it.
///
/// So: position it explicitly in physical pixels, show it without stealing
/// focus, then check. Checking is the part that matters — a park that silently
/// fails is the bug the operator sees.
fn park_window(window: &WebviewWindow) -> CmdResult<()> {
    let (park_x, park_y) = park_position();
    window.set_position(PhysicalPosition::new(park_x, park_y)).map_err(oops)?;
    window.show().map_err(oops)?;
    // Showing can move it back, so the position is asserted again afterwards.
    window.set_position(PhysicalPosition::new(park_x, park_y)).map_err(oops)?;

    let size = window.outer_size().map_err(oops)?;
    let landed = window.outer_position().map_err(oops)?;
    if overlaps_a_monitor(landed.x, landed.y, size.width as i32, size.height as i32) {
        tracing::warn!(
            "a web tile would not stay parked: asked for {park_x},{park_y}, landed at {},{} ({}x{})",
            landed.x,
            landed.y,
            size.width,
            size.height
        );
        // Last resort: a window with no height cannot be seen, and DWM still
        // gives Windows Graphics Capture a surface for it.
        window.set_position(PhysicalPosition::new(park_x, park_y)).map_err(oops)?;
    } else {
        tracing::debug!("web tile parked at {},{}", landed.x, landed.y);
    }
    Ok(())
}

#[cfg(windows)]
fn window_source_id(window: &WebviewWindow) -> CmdResult<String> {
    let hwnd = window.hwnd().map_err(oops)?;
    Ok(format!("window:{}", hwnd.0 as isize))
}

#[cfg(not(windows))]
fn window_source_id(_window: &WebviewWindow) -> CmdResult<String> {
    Err("web tiles need Windows".to_string())
}

#[tauri::command]
async fn web_source_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
    width: u32,
    height: u32,
) -> CmdResult<WebSource> {
    let parsed = tauri::Url::parse(&url).map_err(|_| format!("{url} is not a URL"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("{other}: links have to be http or https")),
    }

    let label = {
        let mut next = state.web_counter.lock();
        *next += 1;
        format!("web{next}")
    };
    let (park_x, park_y) = park_position();

    let window = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(parsed))
        .title(format!("Screen Stuff — {url}"))
        .inner_size(width.clamp(320, 3840) as f64, height.clamp(240, 2160) as f64)
        .position(park_x as f64, park_y as f64)
        .decorations(false)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        // Built hidden on purpose. A window built visible is on screen for the
        // moment between creation and being moved, and during a call that is a
        // browser window flashing over whatever you were showing.
        .visible(false)
        .build()
        .map_err(oops)?;

    park_window(&window)?;

    let source = window_source_id(&window)?;
    Ok(WebSource { label, source })
}

#[tauri::command]
fn web_source_navigate(app: tauri::AppHandle, label: String, url: String) -> CmdResult<()> {
    let parsed = tauri::Url::parse(&url).map_err(|_| format!("{url} is not a URL"))?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("no web tile called {label}"))?;
    window.navigate(parsed).map_err(oops)
}

#[tauri::command]
fn web_source_reload(app: tauri::AppHandle, label: String) -> CmdResult<()> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("no web tile called {label}"))?;
    window.eval("window.location.reload()").map_err(oops)
}

/// Pull the page forward so the operator can click in it, then park it again.
#[tauri::command]
fn web_source_interact(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    label: String,
    interacting: bool,
) -> CmdResult<()> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("no web tile called {label}"))?;

    if interacting {
        let monitors = sources::list_monitors();
        let target = monitors
            .iter()
            .find(|m| m.is_primary)
            .or_else(|| monitors.first())
            .ok_or_else(|| "no monitor to show the page on".to_string())?;
        let size = window.outer_size().map_err(oops)?;
        let x = target.x + ((target.width as i32 - size.width as i32) / 2).max(0);
        let y = target.y + ((target.height as i32 - size.height as i32) / 2).max(0);
        window.set_position(PhysicalPosition::new(x, y)).map_err(oops)?;
        window.set_always_on_top(true).map_err(oops)?;
        window.set_focus().map_err(oops)?;
        state.interacting_web.lock().insert(label);
    } else {
        window.set_always_on_top(false).map_err(oops)?;
        // The same checked park as when the tile was created, so coming back
        // from "click in it" cannot strand the window on screen either.
        park_window(&window)?;
        state.interacting_web.lock().remove(&label);
        cockpit_focus(app)?;
    }
    Ok(())
}

#[tauri::command]
fn web_source_close(app: tauri::AppHandle, label: String) -> CmdResult<()> {
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(oops)?;
    }
    Ok(())
}

/// The region picker: a click-through-free overlay covering every monitor.
#[tauri::command]
async fn open_region_picker(app: tauri::AppHandle) -> CmdResult<()> {
    let (x, y, width, height) = sources::virtual_desktop_bounds();
    if let Some(existing) = app.get_webview_window("region") {
        existing.show().map_err(oops)?;
        existing.set_focus().map_err(oops)?;
        return Ok(());
    }
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "region",
        tauri::WebviewUrl::App("index.html?window=region".into()),
    )
    .title("Screen Stuff — pick a region")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .position(x as f64, y as f64)
    .inner_size(width as f64, height as f64)
    .build()
    .map_err(oops)?;
    window.set_focus().map_err(oops)?;
    Ok(())
}

#[tauri::command]
fn close_region_picker(app: tauri::AppHandle) -> CmdResult<()> {
    if let Some(window) = app.get_webview_window("region") {
        window.close().map_err(oops)?;
    }
    Ok(())
}

#[tauri::command]
fn cockpit_focus(app: tauri::AppHandle) -> CmdResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(oops)?;
        window.unminimize().ok();
        window.set_focus().map_err(oops)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("SCREEN_DROP_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let engine = CaptureEngine::new();
            let running = tauri::async_runtime::block_on(server::start(engine.clone()))?;
            let store = Store::default_location()?;

            let guest_hub = GuestHub::new(engine.clone());

            // The guest page is one of the app's own built files. Release builds
            // embed them in the binary; dev builds leave them on disk.
            let resolver_handle = app.handle().clone();
            guest_hub.set_web_reader(Arc::new(move |path: &str| {
                let with_slash = format!("/{}", path.trim_start_matches('/'));
                if let Some(asset) = resolver_handle.asset_resolver().get(with_slash) {
                    return Some(asset.bytes);
                }
                #[cfg(debug_assertions)]
                {
                    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .parent()
                        .map(|p| p.join("dist").join(path));
                    if let Some(dev) = dev {
                        return std::fs::read(dev).ok();
                    }
                }
                None
            }));

            // Camera tiles are opened by the webview, so the webview needs the
            // permission — and needs it before anyone can click Block.
            for label in ["main", "board"] {
                if let Some(window) = app.get_webview_window(label) {
                    allow_media_capture(&window);
                }
            }

            // Anything a guest does reaches the cockpit as a normal window event.
            let events_handle = app.handle().clone();
            let hub_for_events = guest_hub.clone();
            tauri::async_runtime::spawn(async move {
                let mut incoming = hub_for_events.subscribe_host();
                loop {
                    match incoming.recv().await {
                        Ok(event) => {
                            let _ = events_handle.emit_to("main", "sd:guest-event", event);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });

            tracing::info!("board data lives in {}", store.root().display());
            // Debug builds print the full stream URL so the cockpit can be opened
            // in a plain browser against a running engine. Release builds never
            // do — the token is the only thing standing between a stray web page
            // and every screen you own.
            #[cfg(debug_assertions)]
            tracing::info!("dev stream url: {}", running.stream_url());

            app.manage(AppState {
                engine,
                stream_url: running.stream_url(),
                store,
                board_restore: Mutex::new(None),
                web_counter: Mutex::new(0),
                interacting_web: Mutex::new(HashSet::new()),
                guests: guest_hub,
                tunnel: Arc::new(tunnel::Tunnel::default()),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the cockpit closes the app; closing the board just hides it,
            // so "go live again" does not mean rebuilding every capture.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "board" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            session_info,
            list_sources,
            list_monitors,
            foreground_window,
            foreground_focus,
            source_is_alive,
            board_list,
            board_save,
            board_load,
            board_delete,
            settings_get,
            settings_set,
            board_show,
            board_hide,
            board_set_geometry,
            board_fill_monitor,
            board_restore_geometry,
            board_set_always_on_top,
            guest_start,
            guest_stop,
            guest_status,
            tunnel_start,
            tunnel_stop,
            media_import,
            media_adopt,
            guest_publish,
            web_source_open,
            web_source_navigate,
            web_source_reload,
            web_source_interact,
            web_source_close,
            open_region_picker,
            close_region_picker,
            cockpit_focus,
        ])
        .build(tauri::generate_context!())
        .expect("Screen Stuff could not start")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.guests.stop();
                    state.engine.shutdown();
                }
            }
        });
}
