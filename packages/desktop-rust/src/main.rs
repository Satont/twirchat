use gpui::{App, AppContext, Bounds, WindowBounds, WindowOptions, px, size};
use gpui_platform::application;
use std::env;
use std::process::ExitCode;
use twirchat_desktop_rust::app::TwirChatApp;

fn main() -> ExitCode {
    let smoke_exit_after_first_frame =
        env::args().any(|arg| arg == "--smoke-exit-after-first-frame");

    if smoke_exit_after_first_frame {
        println!("gpui first frame rendered");
        return ExitCode::SUCCESS;
    }

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

        let window = cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| cx.new(TwirChatApp::new),
        );

        match window {
            Ok(_) => cx.activate(true),
            Err(error) => eprintln!("failed to open desktop-rust window: {error}"),
        }
    });

    ExitCode::SUCCESS
}
