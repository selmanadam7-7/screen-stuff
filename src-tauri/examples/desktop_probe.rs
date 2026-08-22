//! What the app thinks the desktop looks like.
//!
//! Web tiles are parked just past the right edge of the virtual desktop, so
//! every one of those numbers has to be right. If the enumeration misses a
//! monitor, "just past the edge" lands in the middle of a screen the operator
//! is looking at — which is exactly what a stray browser window appearing
//! mid-call looks like.
//!
//!   cargo run --example desktop_probe

fn main() {
    let monitors = screen_stuff_lib::sources::list_monitors();
    println!("{} monitor(s):", monitors.len());
    for m in &monitors {
        println!(
            "  {:<12} {:>5}x{:<5} at {:>6},{:<6} primary={}  [{}]",
            m.id, m.width, m.height, m.x, m.y, m.is_primary, m.title
        );
    }

    let (x, y, w, h) = screen_stuff_lib::sources::virtual_desktop_bounds();
    println!("\nvirtual desktop: x={x} y={y} w={w} h={h}  (right edge {})", x + w);

    let park = (x + w + 64, y);
    println!("park position  : {},{}", park.0, park.1);

    // A parked window is 1440 wide. Does any monitor overlap where it lands?
    let park_right = park.0 + 1440;
    let clash: Vec<_> = monitors
        .iter()
        .filter(|m| park.0 < m.x + m.width as i32 && m.x < park_right)
        .map(|m| m.id.clone())
        .collect();

    if clash.is_empty() {
        println!("VERDICT        : parked clear of every monitor");
    } else {
        println!("VERDICT        : LANDS ON {} - this is the bug", clash.join(", "));
    }
}
