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

        let command = if cfg!(target_os = "macos") {
            "open"
        } else if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "xdg-open"
        };

        let status = if cfg!(target_os = "windows") {
            Command::new(command)
                .args(["/C", "start", "", params.url.as_str()])
                .status()
        } else {
            Command::new(command).arg(&params.url).status()
        }
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
