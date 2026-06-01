use gpui::{App, AppContext, Bounds, WindowBounds, WindowOptions, px, size};
use gpui_platform::application;
use std::cell::Cell;
use std::env;
use std::process::ExitCode;
use std::rc::Rc;
use std::time::Duration;
use twirchat::app::TwirChatApp;
use twirchat::ui::components::input;
use twirchat::ui::components::selectable_message;
use twirchat::ui::components::selectable_text;

fn main() -> ExitCode {
    twirchat::runtime::run_velopack_startup();

    let smoke_exit_after_first_frame =
        env::args().any(|arg| arg == "--smoke-exit-after-first-frame");

    if requires_linux_graphical_session() && env::var_os("ZED_HEADLESS").is_none() {
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
            theme::init(theme::LoadThemes::JustBase, cx);
            if let Err(error) = twirchat::ui::theme::load_app_fonts(cx) {
                eprintln!("failed to load bundled app fonts: {error}");
            }
            match reqwest_client::ReqwestClient::proxy_and_user_agent(None, "TwirChat/0.1.0") {
                Ok(http_client) => {
                    cx.set_http_client(std::sync::Arc::new(http_client));
                    println!("gpui http client configured for remote images");
                }
                Err(error) => {
                    eprintln!("failed to configure gpui http client: {error}");
                }
            }
            cx.bind_keys(input::key_bindings());
            cx.bind_keys(selectable_message::key_bindings());
            cx.bind_keys(selectable_text::key_bindings());
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
                        std::thread::spawn(|| {
                            std::thread::sleep(Duration::from_millis(50));
                            std::process::exit(0);
                        });
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

fn requires_linux_graphical_session() -> bool {
    requires_graphical_session_for_target(
        cfg!(target_os = "linux"),
        env::var_os("WAYLAND_DISPLAY").is_some(),
        env::var_os("DISPLAY").is_some(),
    )
}

fn requires_graphical_session_for_target(
    is_linux: bool,
    has_wayland_display: bool,
    has_x11_display: bool,
) -> bool {
    is_linux && !has_wayland_display && !has_x11_display
}

#[cfg(test)]
mod tests {
    #[test]
    fn graphical_session_guard_is_linux_only() {
        assert!(!super::requires_graphical_session_for_target(
            false, false, false
        ));
        assert!(super::requires_graphical_session_for_target(
            true, false, false
        ));
        assert!(!super::requires_graphical_session_for_target(
            true, true, false
        ));
        assert!(!super::requires_graphical_session_for_target(
            true, false, true
        ));
    }
}
