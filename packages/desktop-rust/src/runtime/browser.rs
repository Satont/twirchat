use crate::protocol::rpc::OpenExternalUrlParams;
use std::error::Error;
use std::fmt;
use std::process::Command;
use url::Url;

pub type ExternalOpenResult<T> = Result<T, ExternalOpenError>;

pub trait ExternalOpener {
    fn open_external(&self, params: &OpenExternalUrlParams) -> ExternalOpenResult<()>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalOpenError {
    InvalidUrl { url: String, message: String },
    OpenFailed { url: String, message: String },
}

impl fmt::Display for ExternalOpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUrl { url, message } => {
                write!(f, "invalid external URL `{url}`: {message}")
            }
            Self::OpenFailed { url, message } => {
                write!(f, "failed to open external URL `{url}`: {message}")
            }
        }
    }
}

impl Error for ExternalOpenError {}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemExternalOpener;

impl ExternalOpener for SystemExternalOpener {
    fn open_external(&self, params: &OpenExternalUrlParams) -> ExternalOpenResult<()> {
        validate_external_url(&params.url)?;

        let command = external_open_command(&params.url);
        let status = Command::new(command.program)
            .args(command.args)
            .status()
            .map_err(|source| ExternalOpenError::OpenFailed {
                url: params.url.clone(),
                message: source.to_string(),
            })?;

        if status.success() {
            Ok(())
        } else {
            Err(ExternalOpenError::OpenFailed {
                url: params.url.clone(),
                message: status.to_string(),
            })
        }
    }
}

struct ExternalOpenCommand {
    program: &'static str,
    args: Vec<String>,
}

fn external_open_command(url: &str) -> ExternalOpenCommand {
    external_open_command_for_target(url, std::env::consts::OS)
}

fn external_open_command_for_target(url: &str, target_os: &str) -> ExternalOpenCommand {
    match target_os {
        "macos" => ExternalOpenCommand {
            program: "open",
            args: vec![url.to_string()],
        },
        "windows" => ExternalOpenCommand {
            program: "rundll32",
            args: vec!["url.dll,FileProtocolHandler".to_string(), url.to_string()],
        },
        _ => ExternalOpenCommand {
            program: "xdg-open",
            args: vec![url.to_string()],
        },
    }
}

pub fn open_external_url(
    opener: &impl ExternalOpener,
    params: &OpenExternalUrlParams,
) -> ExternalOpenResult<()> {
    validate_external_url(&params.url)?;
    opener.open_external(params)
}

pub fn validate_external_url(url: &str) -> ExternalOpenResult<()> {
    let parsed = Url::parse(url).map_err(|source| ExternalOpenError::InvalidUrl {
        url: url.to_string(),
        message: source.to_string(),
    })?;

    match parsed.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(ExternalOpenError::InvalidUrl {
            url: url.to_string(),
            message: format!("unsupported scheme `{scheme}`"),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_external_open_command_avoids_cmd_shell_parsing() {
        let url = "https://example.com/callback?code=one&state=two";

        let command = external_open_command_for_target(url, "windows");

        assert_eq!(command.program, "rundll32");
        assert_eq!(command.args, ["url.dll,FileProtocolHandler", url]);
        assert!(!command.args.iter().any(|arg| arg == "/C" || arg == "start"));
    }
}
