#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let _ = dotenvy::from_filename("../.env");
    app_lib::run();
}
