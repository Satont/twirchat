use crate::auth::{AuthError, AuthResult};
use std::process::Command;

pub trait BrowserOpener {
    fn open(&self, url: &str) -> AuthResult<()>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemBrowser;

impl BrowserOpener for SystemBrowser {
    fn open(&self, url: &str) -> AuthResult<()> {
        let command = browser_open_command(url);
        let status = Command::new(command.program)
            .args(command.args)
            .status()
            .map_err(|source| AuthError::BrowserOpenFailed {
                url: url.to_string(),
                message: source.to_string(),
            })?;

        if status.success() {
            Ok(())
        } else {
            Err(AuthError::BrowserOpenFailed {
                url: url.to_string(),
                message: status.to_string(),
            })
        }
    }
}

struct BrowserOpenCommand {
    program: &'static str,
    args: Vec<String>,
}

fn browser_open_command(url: &str) -> BrowserOpenCommand {
    browser_open_command_for_target(url, std::env::consts::OS)
}

fn browser_open_command_for_target(url: &str, target_os: &str) -> BrowserOpenCommand {
    match target_os {
        "macos" => BrowserOpenCommand {
            program: "open",
            args: vec![url.to_string()],
        },
        "windows" => BrowserOpenCommand {
            program: "rundll32",
            args: vec!["url.dll,FileProtocolHandler".to_string(), url.to_string()],
        },
        _ => BrowserOpenCommand {
            program: "xdg-open",
            args: vec![url.to_string()],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_browser_open_command_avoids_cmd_shell_parsing() {
        let url =
            "https://id.kick.com/oauth/authorize?client_id=abc&scope=user%3Aread+channel%3Aread";

        let command = browser_open_command_for_target(url, "windows");

        assert_eq!(command.program, "rundll32");
        assert_eq!(command.args, ["url.dll,FileProtocolHandler", url]);
        assert!(!command.args.iter().any(|arg| arg == "/C" || arg == "start"));
    }
}
