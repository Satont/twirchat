//! Provider-neutral platform adapter boundary for later Twitch, YouTube, and Kick integrations.

pub mod kick;
pub mod twitch;
pub mod youtube;

use crate::auth::AuthProvider;
use crate::protocol::types::{
    NormalizedChatMessage, NormalizedEvent, Platform, PlatformStatusInfo,
};
use std::error::Error;
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum PlatformEvent {
    Message(NormalizedChatMessage),
    Event(NormalizedEvent),
    Status(PlatformStatusInfo),
}

pub trait PlatformEventSink {
    fn emit(&mut self, event: PlatformEvent) -> PlatformResult<()>;
}

pub trait PlatformAdapter {
    type Auth: AuthProvider;

    fn platform(&self) -> Platform;
    fn auth_provider(&self) -> &Self::Auth;
    fn connect(
        &mut self,
        channel_slug: &str,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()>;
    fn disconnect(&mut self) -> PlatformResult<()>;
    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<()>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlatformLifecycleState {
    Disconnected,
    Connecting { channel_slug: String },
    Connected { channel_slug: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterIdentity {
    pub platform: Platform,
    pub lifecycle: PlatformLifecycleState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformError {
    pub platform: Platform,
    pub message: String,
}

impl PlatformError {
    pub fn new(platform: Platform, message: impl Into<String>) -> Self {
        Self {
            platform,
            message: message.into(),
        }
    }
}

impl fmt::Display for PlatformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:?} platform adapter error: {}",
            self.platform, self.message
        )
    }
}

impl Error for PlatformError {}

pub type PlatformResult<T> = Result<T, PlatformError>;
