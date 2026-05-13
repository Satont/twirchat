use crate::protocol::messages::DesktopToBackendMessage;
use crate::protocol::types::Platform;

#[derive(Debug, Clone, PartialEq)]
pub enum ServiceCommand {
    Lifecycle(LifecycleCommand),
    Auth(AuthCommand),
    BackendWs(BackendWsCommand),
    PlatformAdapters(PlatformAdapterCommand),
    WatchedChannels(WatchedChannelsCommand),
    Overlay(OverlayCommand),
    Storage(StorageCommand),
    Chat(ChatCommand),
    Settings(SettingsCommand),
    UpdateState(UpdateStateCommand),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleCommand {
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthCommand {
    StartLogin { platform: Platform },
    Logout { platform: Platform },
    RefreshSession { platform: Platform },
}

#[derive(Debug, Clone, PartialEq)]
pub enum BackendWsCommand {
    Connect,
    Disconnect,
    SendPing,
    SendMessage { message: DesktopToBackendMessage },
    ScheduleReconnect { attempt: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlatformAdapterCommand {
    ConnectChannel {
        platform: Platform,
        channel_slug: String,
    },
    DisconnectChannel {
        platform: Platform,
        channel_slug: String,
    },
    SendMessage {
        platform: Platform,
        channel_id: String,
        text: String,
        reply_to_message_id: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchedChannelsCommand {
    Load,
    Add {
        platform: Platform,
        channel_slug: String,
        display_name: Option<String>,
    },
    Remove {
        channel_id: String,
    },
    ReconnectByPlatform {
        platform: Platform,
    },
    SendMessage {
        channel_id: String,
        text: String,
        reply_to_message_id: Option<String>,
    },
    ResubscribeSevenTv,
    Poll,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OverlayCommand {
    Start,
    Stop,
    PushMessage { message_id: String },
    PushEvent { event_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageCommand {
    LoadInitialState,
    PersistEnvelope { key: String },
    Flush,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatCommand {
    IngestMessage { message_id: String },
    ClearChannel { channel_id: String },
    RebuildRecentCache,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsCommand {
    Load,
    SaveKey { key: String },
    ResetKey { key: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateStateCommand {
    CheckForUpdates,
    DownloadUpdate,
    ApplyUpdate,
    SkipUpdate { hash: String },
}
