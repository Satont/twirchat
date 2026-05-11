use gpui::{App, AppContext, Bounds, WindowBounds, WindowOptions, px, size};
use gpui_platform::application;
use std::cell::Cell;
use std::env;
use std::process::ExitCode;
use std::rc::Rc;
use twirchat_desktop_rust::app::TwirChatApp;

fn main() -> ExitCode {
    let smoke_exit_after_first_frame =
        env::args().any(|arg| arg == "--smoke-exit-after-first-frame");

    let wayland_display = env::var_os("WAYLAND_DISPLAY");
    let x11_display = env::var_os("DISPLAY");
    let headless = env::var_os("ZED_HEADLESS").is_some();

    if !headless && wayland_display.is_none() && x11_display.is_none() {
        eprintln!(
            "desktop-rust requires a graphical Linux session. Set DISPLAY or WAYLAND_DISPLAY, or set ZED_HEADLESS=1 for headless mode."
        );
        return ExitCode::FAILURE;
    }

    let window_opened = Rc::new(Cell::new(false));
    let startup_failed = Rc::new(Cell::new(false));

    application().run({
        let window_opened = Rc::clone(&window_opened);
        let startup_failed = Rc::clone(&startup_failed);

        move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1280.0), px(900.0)), cx);

        let window = cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| cx.new(TwirChatApp::new),
        );

        match window {
            Ok(_) => {
                window_opened.set(true);
                cx.activate(true);
                if smoke_exit_after_first_frame {
                    println!(
                        "gpui window opened; smoke mode requested immediate shutdown before interactive QA"
                    );
                    cx.quit();
                }
            }
            Err(error) => {
                startup_failed.set(true);
                eprintln!("failed to open desktop-rust window: {error}");
                cx.quit();
            }
        }
        }
    });

    if startup_failed.get() || !window_opened.get() {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
