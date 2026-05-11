use crate::protocol::messages::BackendToDesktopMessage;
use crate::protocol::types::Platform;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ServiceKind {
    Auth,
    BackendWs,
    PlatformAdapters,
    WatchedChannels,
    Overlay,
    Storage,
    Chat,
    Settings,
    UpdateState,
}

impl ServiceKind {
    pub const STARTUP_SEQUENCE: [Self; 9] = [
        Self::Storage,
        Self::Settings,
        Self::Auth,
        Self::BackendWs,
        Self::PlatformAdapters,
        Self::WatchedChannels,
        Self::Chat,
        Self::Overlay,
        Self::UpdateState,
    ];

    pub fn startup_sequence() -> &'static [Self] {
        &Self::STARTUP_SEQUENCE
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Auth => "auth",
            Self::BackendWs => "backend-ws",
            Self::PlatformAdapters => "platform-adapters",
            Self::WatchedChannels => "watched-channels",
            Self::Overlay => "overlay",
            Self::Storage => "storage",
            Self::Chat => "chat",
            Self::Settings => "settings",
            Self::UpdateState => "update-state",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ServiceEvent {
    Lifecycle(LifecycleEvent),
    Auth(AuthEvent),
    BackendWs(BackendWsEvent),
    PlatformAdapters(PlatformAdapterEvent),
    WatchedChannels(WatchedChannelsEvent),
    Overlay(OverlayEvent),
    Storage(StorageEvent),
    Chat(ChatEvent),
    Settings(SettingsEvent),
    UpdateState(UpdateStateEvent),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LifecycleEvent {
    RuntimeStarting { sequence: Vec<ServiceKind> },
    ServiceStarted { service: ServiceKind },
    RuntimeStarted,
    RuntimeStopping,
    RuntimeCancelled,
    ServiceStopping { service: ServiceKind },
    ServiceStopped { service: ServiceKind },
    RuntimeStopped { services: Vec<ServiceKind> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthEvent {
    LoginRequested { platform: Platform },
    LogoutRequested { platform: Platform },
    SessionRefreshRequested { platform: Platform },
}

#[derive(Debug, Clone, PartialEq)]
pub enum BackendWsEvent {
    ConnectionRequested,
    DisconnectionRequested,
    Connecting { url: String },
    Connected,
    Disconnected { reason: BackendWsDisconnectReason },
    PingQueued,
    MessageQueued { kind: DesktopToBackendMessageKind },
    MessageSent { kind: DesktopToBackendMessageKind },
    MessageReceived { kind: BackendToDesktopMessageKind },
    MessageDecoded { message: BackendToDesktopMessage },
    MalformedPayload { error: String },
    AuthRejected { status: u16, message: String },
    SendFailed { reason: String },
    ReconnectScheduled { attempt: u32, delay: Duration },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendWsDisconnectReason {
    Commanded,
    RemoteClosed,
    IoError,
    ProtocolError,
    AuthRejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BackendToDesktopMessageKind {
    AuthUrl,
    AuthSuccess,
    AuthError,
    Error,
    Pong,
    ChatMessage,
    ChatEvent,
    PlatformStatus,
    SeventvEmoteSet,
    SeventvEmoteAdded,
    SeventvEmoteRemoved,
    SeventvEmoteUpdated,
    SeventvSystemMessage,
}

impl From<&BackendToDesktopMessage> for BackendToDesktopMessageKind {
    fn from(value: &BackendToDesktopMessage) -> Self {
        match value {
            BackendToDesktopMessage::AuthUrl { .. } => Self::AuthUrl,
            BackendToDesktopMessage::AuthSuccess { .. } => Self::AuthSuccess,
            BackendToDesktopMessage::AuthError { .. } => Self::AuthError,
            BackendToDesktopMessage::Error { .. } => Self::Error,
            BackendToDesktopMessage::Pong => Self::Pong,
            BackendToDesktopMessage::ChatMessage { .. } => Self::ChatMessage,
            BackendToDesktopMessage::ChatEvent { .. } => Self::ChatEvent,
            BackendToDesktopMessage::PlatformStatus { .. } => Self::PlatformStatus,
            BackendToDesktopMessage::SeventvEmoteSet { .. } => Self::SeventvEmoteSet,
            BackendToDesktopMessage::SeventvEmoteAdded { .. } => Self::SeventvEmoteAdded,
            BackendToDesktopMessage::SeventvEmoteRemoved { .. } => Self::SeventvEmoteRemoved,
            BackendToDesktopMessage::SeventvEmoteUpdated { .. } => Self::SeventvEmoteUpdated,
            BackendToDesktopMessage::SeventvSystemMessage { .. } => Self::SeventvSystemMessage,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DesktopToBackendMessageKind {
    Ping,
    AuthStart,
    AuthStartTwitch,
    AuthLogout,
    SendMessage,
    ChannelJoin,
    ChannelLeave,
    SeventvSubscribe,
    SeventvUnsubscribe,
    SeventvResubscribe,
}

impl From<&crate::protocol::messages::DesktopToBackendMessage> for DesktopToBackendMessageKind {
    fn from(value: &crate::protocol::messages::DesktopToBackendMessage) -> Self {
        match value {
            crate::protocol::messages::DesktopToBackendMessage::Ping => Self::Ping,
            crate::protocol::messages::DesktopToBackendMessage::AuthStart { .. } => Self::AuthStart,
            crate::protocol::messages::DesktopToBackendMessage::AuthStartTwitch { .. } => {
                Self::AuthStartTwitch
            }
            crate::protocol::messages::DesktopToBackendMessage::AuthLogout { .. } => {
                Self::AuthLogout
            }
            crate::protocol::messages::DesktopToBackendMessage::SendMessage { .. } => {
                Self::SendMessage
            }
            crate::protocol::messages::DesktopToBackendMessage::ChannelJoin { .. } => {
                Self::ChannelJoin
            }
            crate::protocol::messages::DesktopToBackendMessage::ChannelLeave { .. } => {
                Self::ChannelLeave
            }
            crate::protocol::messages::DesktopToBackendMessage::SeventvSubscribe { .. } => {
                Self::SeventvSubscribe
            }
            crate::protocol::messages::DesktopToBackendMessage::SeventvUnsubscribe { .. } => {
                Self::SeventvUnsubscribe
            }
            crate::protocol::messages::DesktopToBackendMessage::SeventvResubscribe { .. } => {
                Self::SeventvResubscribe
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlatformAdapterEvent {
    ChannelConnectRequested {
        platform: Platform,
        channel_slug: String,
    },
    ChannelDisconnectRequested {
        platform: Platform,
        channel_slug: String,
    },
    MessageSendRequested {
        platform: Platform,
        channel_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchedChannelsEvent {
    LoadRequested,
    AddRequested {
        platform: Platform,
        channel_slug: String,
    },
    RemoveRequested {
        channel_id: String,
    },
    ReconnectRequested {
        platform: Platform,
    },
    SendRequested {
        channel_id: String,
    },
    PollRequested,
    MessageBuffered {
        channel_id: String,
        message_id: String,
    },
    StatusChanged {
        channel_id: String,
    },
    BackendMessagePlanned {
        kind: DesktopToBackendMessageKind,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OverlayEvent {
    StartRequested,
    StopRequested,
    MessageQueued { message_id: String },
    EventQueued { event_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageEvent {
    InitialStateRequested,
    PersistRequested { key: String },
    FlushRequested,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatEvent {
    MessageQueued { message_id: String },
    ChannelClearRequested { channel_id: String },
    RecentCacheRebuildRequested,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsEvent {
    LoadRequested,
    SaveRequested { key: String },
    ResetRequested { key: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateStateEvent {
    CheckRequested,
    DownloadRequested,
    ApplyRequested,
    SkipRequested { hash: String },
}
