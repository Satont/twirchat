mod app;
mod mock;
mod models;
mod state;
mod theme;

use app::TwirChatApp;
use gpui::{App, AppContext, Bounds, WindowBounds, WindowOptions, px, size};
use gpui_platform::application;
use std::env;
use std::process::ExitCode;

fn main() -> ExitCode {
    let wayland_display = env::var_os("WAYLAND_DISPLAY");
    let x11_display = env::var_os("DISPLAY");
    let headless = env::var_os("ZED_HEADLESS").is_some();

    if !headless && wayland_display.is_none() && x11_display.is_none() {
        eprintln!(
            "desktop-rust requires a graphical Linux session. Set DISPLAY or WAYLAND_DISPLAY, or set ZED_HEADLESS=1 for headless mode."
        );
        return ExitCode::FAILURE;
    }

    application().run(|cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1280.0), px(900.0)), cx);

        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| cx.new(|_| TwirChatApp::new()),
        )
        .expect("failed to open desktop-rust window");

        cx.activate(true);
    });

    ExitCode::SUCCESS
}
