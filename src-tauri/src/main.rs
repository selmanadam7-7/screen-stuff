// Windows opens a console alongside any binary built for the console subsystem,
// and a desktop app that drags a black terminal onto the screen behind itself
// looks broken before it has done anything. Release builds ask for the windows
// subsystem instead; debug builds keep the console, because that is where the
// engine's logs go while you are working on it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    screen_stuff_lib::run()
}
