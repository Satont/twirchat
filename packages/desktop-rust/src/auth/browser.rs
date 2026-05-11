use crate::auth::{AuthError, AuthResult};
use std::process::Command;

pub trait BrowserOpener {
    fn open(&self, url: &str) -> AuthResult<()>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemBrowser;

impl BrowserOpener for SystemBrowser {
    fn open(&self, url: &str) -> AuthResult<()> {
        let command = if cfg!(target_os = "macos") {
            "open"
        } else if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "xdg-open"
        };

        let status = if cfg!(target_os = "windows") {
            Command::new(command)
                .args(["/C", "start", "", url])
                .status()
        } else {
            Command::new(command).arg(url).status()
        }
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
