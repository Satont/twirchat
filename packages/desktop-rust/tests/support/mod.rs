use std::fs;
use std::path::PathBuf;

use twirchat::app_state::AppState;

pub fn new_state() -> AppState {
    AppState::new()
}

#[allow(dead_code)]
pub fn read_source(relative_path: &str) -> String {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    fs::read_to_string(manifest_dir.join(relative_path))
        .unwrap_or_else(|error| panic!("failed to read {relative_path}: {error}"))
}
