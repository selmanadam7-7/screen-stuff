//! Stands up the capture engine and a guest link with a real board on it, then
//! waits. Used to exercise the guest page end to end without the app shell:
//!
//! ```text
//!   cargo run --example guest_harness -- 4
//! ```
//!
//! Prints the guest URL on stdout and holds until interrupted.

use screen_drop_lib::capture::CaptureEngine;
use screen_drop_lib::guest::{GuestHub, Powers};
use screen_drop_lib::{guest_server, sources};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter("info").init();

    let tiles: usize = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(4);

    let engine = CaptureEngine::new();
    let hub = GuestHub::new(engine);

    // Serve the built frontend straight off disk — this harness never runs
    // inside the packaged app.
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("project root")
        .join("dist");
    println!("serving the guest page from {}", root.display());
    hub.set_web_reader(Arc::new(move |path: &str| std::fs::read(root.join(path)).ok()));

    let monitors = sources::list_monitors();
    let count = tiles.min(monitors.len()).max(1);
    println!("putting {count} of {} displays on the board", monitors.len());

    hub.publish(board_with(&monitors[..count.min(monitors.len())]), frame(), Powers::default());

    let server = guest_server::start(hub.clone(), 0).await?;
    println!("GUEST_URL {}", server.url);
    println!("GUEST_PORT {}", server.addr.port());
    hub.set_running(server);

    // No signal handling: this harness is started and killed by a script.
    std::future::pending::<()>().await;
    Ok(())
}

fn frame() -> serde_json::Value {
    serde_json::json!({ "x": 0, "y": 0, "w": 1920, "h": 1080 })
}

/// A two-column grid of live displays plus a note, matching what the cockpit
/// would produce from "put all displays on the board".
fn board_with(monitors: &[sources::SourceInfo]) -> serde_json::Value {
    let gap = 24.0;
    let cols = 2.0;
    let cell_w = (1920.0 - gap * 3.0) / cols;
    let cell_h = cell_w / (16.0 / 9.0);

    let mut tiles: Vec<serde_json::Value> = monitors
        .iter()
        .enumerate()
        .map(|(i, monitor)| {
            let column = (i % 2) as f64;
            let row = (i / 2) as f64;
            serde_json::json!({
                "id": format!("m{i}"),
                "kind": "source",
                "source": monitor.id,
                "label": monitor.title,
                "x": gap + column * (cell_w + gap),
                "y": gap + row * (cell_h + gap),
                "w": cell_w,
                "h": cell_h,
                "z": i + 1,
                "rotation": 0, "opacity": 1, "radius": 8,
                "locked": false, "hidden": false, "fit": "contain", "shadow": true
            })
        })
        .collect();

    tiles.push(serde_json::json!({
        "id": "note", "kind": "note",
        "x": 1450, "y": 780, "w": 430, "h": 240, "z": 50,
        "rotation": 0, "opacity": 1, "radius": 6,
        "locked": false, "hidden": false, "fit": "contain", "label": "", "shadow": false,
        "text": "Guests see the board, not the desktop.",
        "color": "#F5D06B", "textColor": "#171307", "fontSize": 34, "align": "left"
    }));

    serde_json::json!({
        "version": 1, "name": "Guest harness",
        "frame": frame(), "aspect": 16.0 / 9.0,
        "tiles": tiles,
        "strokes": [{ "id": "s1", "tool": "arrow", "color": "#FF5A41", "width": 8,
                      "points": [980, 620, 1400, 800], "createdAt": 0 }],
        "scenes": [], "background": "#08090D", "showGrid": true,
        "quality": 85, "fps": 30
    })
}
