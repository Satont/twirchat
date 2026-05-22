use crate::protocol::messages::{ChannelStatusRequest, ChannelsStatusResponse};
use crate::protocol::rpc::GetChannelsStatusParams;
use crate::runtime::RuntimeConfig;
use std::error::Error;
use std::fmt;
use std::time::Duration;

const CHANNELS_STATUS_PATH: &str = "/api/channels-status";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub enum StreamStatusServiceError {
    Http(reqwest::Error),
    HttpStatus {
        status: reqwest::StatusCode,
        body: String,
    },
}

impl fmt::Display for StreamStatusServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Http(source) => write!(f, "channel status request failed: {source}"),
            Self::HttpStatus { status, body } => {
                write!(f, "channel status request failed with {status}: {body}")
            }
        }
    }
}

impl Error for StreamStatusServiceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Http(source) => Some(source),
            Self::HttpStatus { .. } => None,
        }
    }
}

impl From<reqwest::Error> for StreamStatusServiceError {
    fn from(value: reqwest::Error) -> Self {
        Self::Http(value)
    }
}

pub type StreamStatusServiceResult<T> = Result<T, StreamStatusServiceError>;

pub fn fetch_channels_status(
    config: &RuntimeConfig,
    channels: Vec<ChannelStatusRequest>,
) -> StreamStatusServiceResult<ChannelsStatusResponse> {
    if channels.is_empty() {
        return Ok(ChannelsStatusResponse {
            channels: Vec::new(),
        });
    }

    let backend_request = config.backend_request(CHANNELS_STATUS_PATH);
    let client = reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()?;
    let body = GetChannelsStatusParams { channels };
    let mut http_request = client.post(backend_request.url).json(&body);
    for (name, value) in backend_request.headers {
        http_request = http_request.header(name, value);
    }

    let response = http_request.send()?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .map(|body| body.chars().take(512).collect())
            .unwrap_or_else(|error| error.to_string());
        return Err(StreamStatusServiceError::HttpStatus { status, body });
    }

    Ok(response.json()?)
}
