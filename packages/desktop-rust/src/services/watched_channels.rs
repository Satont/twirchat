use crate::chat::{
    SevenTvCatalog, SevenTvEmote as CatalogSevenTvEmote, enrich_message_with_seven_tv,
};
use crate::platforms::kick::{KickAdapter, KickChatClient};
use crate::platforms::twitch::{TwitchAdapter, TwitchChatClient};
use crate::platforms::youtube::{YouTubeAdapter, YouTubeStreamingTransport};
use crate::platforms::{
    PlatformAdapter, PlatformError, PlatformEvent, PlatformEventSink, PlatformResult,
};
use crate::protocol::messages::{
    DesktopToBackendMessage, SevenTvEmote as BackendSevenTvEmote, SevenTvSubscription,
};
use crate::protocol::types::{NormalizedChatMessage, Platform, PlatformStatusInfo, WatchedChannel};
use crate::services::bus::{BusReceiver, BusRecvError, BusSender};
use crate::services::commands::{LifecycleCommand, ServiceCommand, WatchedChannelsCommand};
use crate::services::events::{DesktopToBackendMessageKind, ServiceEvent, WatchedChannelsEvent};
use crate::services::supervisor::{CancellationToken, ServiceExitReason, ServiceStopReport};
use crate::storage::watched_channels::normalize_watched_channel_slug;
use crate::storage::{Storage, StorageError};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::error::Error;
use std::fmt;
use std::path::PathBuf;
use std::time::Duration;

pub const DEFAULT_WATCHED_CHANNEL_BUFFER_SIZE: usize = 200;

pub trait WatchedChannelAdapter {
    fn platform(&self) -> Platform;
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

    fn poll(&mut self, _sink: &mut dyn PlatformEventSink) -> PlatformResult<()> {
        Ok(())
    }

    fn seven_tv_channel_id(&self, fallback_slug: &str) -> String {
        fallback_slug.to_string()
    }
}

impl<C: TwitchChatClient> WatchedChannelAdapter for TwitchAdapter<'_, C> {
    fn platform(&self) -> Platform {
        PlatformAdapter::platform(self)
    }

    fn connect(
        &mut self,
        channel_slug: &str,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()> {
        PlatformAdapter::connect(self, channel_slug, sink)
    }

    fn disconnect(&mut self) -> PlatformResult<()> {
        PlatformAdapter::disconnect(self)
    }

    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<()> {
        PlatformAdapter::send_message(self, channel_id, text, reply_to_message_id)
    }

    fn poll(&mut self, sink: &mut dyn PlatformEventSink) -> PlatformResult<()> {
        TwitchAdapter::poll(self, sink)
    }
}

impl<C: KickChatClient> WatchedChannelAdapter for KickAdapter<'_, C> {
    fn platform(&self) -> Platform {
        PlatformAdapter::platform(self)
    }

    fn connect(
        &mut self,
        channel_slug: &str,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()> {
        PlatformAdapter::connect(self, channel_slug, sink)
    }

    fn disconnect(&mut self) -> PlatformResult<()> {
        PlatformAdapter::disconnect(self)
    }

    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<()> {
        PlatformAdapter::send_message(self, channel_id, text, reply_to_message_id)
    }

    fn poll(&mut self, sink: &mut dyn PlatformEventSink) -> PlatformResult<()> {
        KickAdapter::poll(self, sink)
    }

    fn seven_tv_channel_id(&self, fallback_slug: &str) -> String {
        self.chatroom()
            .map(|chatroom| chatroom.broadcaster_user_id.to_string())
            .unwrap_or_else(|| fallback_slug.to_string())
    }
}

impl<T: YouTubeStreamingTransport> WatchedChannelAdapter for YouTubeAdapter<'_, T> {
    fn platform(&self) -> Platform {
        PlatformAdapter::platform(self)
    }

    fn connect(
        &mut self,
        channel_slug: &str,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()> {
        PlatformAdapter::connect(self, channel_slug, sink)
    }

    fn disconnect(&mut self) -> PlatformResult<()> {
        PlatformAdapter::disconnect(self)
    }

    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<()> {
        PlatformAdapter::send_message(self, channel_id, text, reply_to_message_id)
    }

    fn poll(&mut self, sink: &mut dyn PlatformEventSink) -> PlatformResult<()> {
        YouTubeAdapter::process_server_signals(self, sink)
    }
}

#[derive(Debug)]
pub enum WatchedChannelsRuntimeError {
    Storage(StorageError),
    AdapterFactory {
        platform: Platform,
        channel_slug: String,
        message: String,
    },
    Adapter {
        platform: Platform,
        channel_id: String,
        message: String,
    },
    ChannelNotFound {
        channel_id: String,
    },
}

impl WatchedChannelsRuntimeError {
    pub fn adapter_factory(
        platform: Platform,
        channel_slug: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self::AdapterFactory {
            platform,
            channel_slug: channel_slug.into(),
            message: message.into(),
        }
    }

    fn adapter(channel_id: &str, error: PlatformError) -> Self {
        Self::Adapter {
            platform: error.platform,
            channel_id: channel_id.to_string(),
            message: error.message,
        }
    }
}

impl fmt::Display for WatchedChannelsRuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(source) => write!(f, "watched-channel storage error: {source}"),
            Self::AdapterFactory {
                platform,
                channel_slug,
                message,
            } => write!(
                f,
                "failed to create {:?} watched-channel adapter for {channel_slug}: {message}",
                platform
            ),
            Self::Adapter {
                platform,
                channel_id,
                message,
            } => write!(
                f,
                "{:?} watched-channel adapter for {channel_id} failed: {message}",
                platform
            ),
            Self::ChannelNotFound { channel_id } => {
                write!(f, "watched channel {channel_id} was not found")
            }
        }
    }
}

impl Error for WatchedChannelsRuntimeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Storage(source) => Some(source),
            Self::AdapterFactory { .. } | Self::Adapter { .. } | Self::ChannelNotFound { .. } => {
                None
            }
        }
    }
}

impl From<StorageError> for WatchedChannelsRuntimeError {
    fn from(value: StorageError) -> Self {
        Self::Storage(value)
    }
}

pub type WatchedChannelsRuntimeResult<T> = Result<T, WatchedChannelsRuntimeError>;

pub fn run_watched_channels_service(
    storage_path: PathBuf,
    cancellation: CancellationToken,
    poll_interval: Duration,
    commands: BusReceiver<ServiceCommand>,
    events: BusSender<ServiceEvent>,
) -> ServiceStopReport {
    eprintln!(
        "[watched/live] starting watched-channels service: Kick uses real client, Twitch/YouTube still use mock clients"
    );
    let storage = match Storage::open_or_recover(&storage_path) {
        Ok(storage) => storage,
        Err(error) => {
            publish_watched_event(
                &events,
                WatchedChannelsEvent::AdapterError {
                    channel_id: String::new(),
                    platform: Platform::Twitch,
                    message: format!("watched-channel storage open failed: {error}"),
                },
            );
            return ServiceStopReport::new(
                crate::services::ServiceKind::WatchedChannels,
                ServiceExitReason::CommandBusClosed,
            );
        }
    };

    let mut runtime = WatchedChannelsRuntime::new(&storage, |channel| match channel.platform {
        Platform::Twitch => Ok(Box::new(TwitchAdapter::new(
            &storage,
            crate::platforms::twitch::MockTwitchClient::new(),
        )) as Box<dyn WatchedChannelAdapter>),
        Platform::Kick => Ok(Box::new(KickAdapter::new(
            &storage,
            crate::platforms::kick::RealKickClient::new(&storage).map_err(|error| {
                WatchedChannelsRuntimeError::adapter_factory(
                    Platform::Kick,
                    channel.channel_slug.clone(),
                    error.message,
                )
            })?,
        )) as Box<dyn WatchedChannelAdapter>),
        Platform::Youtube => Ok(Box::new(YouTubeAdapter::new(
            &storage,
            crate::platforms::youtube::MockYouTubeTransport::new(),
        )) as Box<dyn WatchedChannelAdapter>),
    });

    if let Err(error) = runtime.auto_connect() {
        publish_runtime_error(&events, String::new(), Platform::Twitch, error.to_string());
    }
    publish_runtime_events(&events, &mut runtime);

    loop {
        if cancellation.is_cancelled() {
            return ServiceStopReport::new(
                crate::services::ServiceKind::WatchedChannels,
                ServiceExitReason::Cancelled,
            );
        }

        if let Err(error) = runtime.poll_all() {
            eprintln!("[watched/live] poll_all failed: {error}");
            publish_runtime_error(&events, String::new(), Platform::Kick, error.to_string());
        }
        publish_runtime_events(&events, &mut runtime);

        match commands.recv_timeout(poll_interval) {
            Ok(ServiceCommand::Lifecycle(LifecycleCommand::Shutdown)) => {
                return ServiceStopReport::new(
                    crate::services::ServiceKind::WatchedChannels,
                    ServiceExitReason::ShutdownCommand,
                );
            }
            Ok(ServiceCommand::WatchedChannels(command)) => {
                handle_watched_command(&mut runtime, &events, command);
                publish_runtime_events(&events, &mut runtime);
            }
            Ok(_) => {}
            Err(BusRecvError::Timeout) => {}
            Err(BusRecvError::Closed) => {
                return ServiceStopReport::new(
                    crate::services::ServiceKind::WatchedChannels,
                    ServiceExitReason::CommandBusClosed,
                );
            }
        }
    }
}

fn handle_watched_command(
    runtime: &mut WatchedChannelsRuntime<'_>,
    events: &BusSender<ServiceEvent>,
    command: WatchedChannelsCommand,
) {
    let result = match command {
        WatchedChannelsCommand::Load => runtime.auto_connect().map(|_| ()),
        WatchedChannelsCommand::Add {
            platform,
            channel_slug,
            display_name,
        } => runtime
            .add_channel(platform, &channel_slug, display_name.as_deref())
            .map(|_| ()),
        WatchedChannelsCommand::Remove { channel_id } => runtime.remove_channel(&channel_id),
        WatchedChannelsCommand::ReconnectByPlatform { platform } => {
            runtime.reconnect_by_platform(platform).map(|_| ())
        }
        WatchedChannelsCommand::SendMessage {
            channel_id,
            text,
            reply_to_message_id,
        } => runtime.send_message(&channel_id, &text, reply_to_message_id.as_deref()),
        WatchedChannelsCommand::ResubscribeSevenTv => {
            runtime.resubscribe_seven_tv();
            Ok(())
        }
        WatchedChannelsCommand::Poll => runtime.poll_all(),
    };

    if let Err(error) = result {
        eprintln!("[watched/live] command failed: {error}");
        publish_runtime_error(events, String::new(), Platform::Kick, error.to_string());
    }
}

fn publish_runtime_events(
    events: &BusSender<ServiceEvent>,
    runtime: &mut WatchedChannelsRuntime<'_>,
) {
    for event in runtime.drain_events() {
        match event {
            WatchedChannelsRuntimeEvent::MessageBuffered {
                channel_id,
                message,
            } => {
                eprintln!(
                    "[watched/live] buffered {:?} message for channel={} id={} text={}",
                    message.platform, channel_id, message.id, message.text
                );
                publish_watched_event(
                    events,
                    WatchedChannelsEvent::MessageBuffered {
                        channel_id,
                        message,
                    },
                );
            }
            WatchedChannelsRuntimeEvent::StatusChanged { channel_id, status } => {
                eprintln!(
                    "[watched/live] status update channel={} platform={:?} status={:?} mode={:?}",
                    channel_id, status.platform, status.status, status.mode
                );
                publish_watched_event(
                    events,
                    WatchedChannelsEvent::StatusChanged { channel_id, status },
                );
            }
            WatchedChannelsRuntimeEvent::BackendMessagePlanned { message } => {
                eprintln!("[watched/live] planned backend message: {:?}", message);
                publish_watched_event(
                    events,
                    WatchedChannelsEvent::BackendMessagePlanned {
                        kind: DesktopToBackendMessageKind::from(&message),
                        message,
                    },
                );
            }
            WatchedChannelsRuntimeEvent::AdapterError {
                channel_id,
                platform,
                message,
            } => {
                eprintln!(
                    "[watched/live] adapter error channel={} platform={:?}: {}",
                    channel_id, platform, message
                );
                publish_runtime_error(events, channel_id, platform, message)
            }
            WatchedChannelsRuntimeEvent::ChannelStarted { .. }
            | WatchedChannelsRuntimeEvent::ChannelRemoved { .. } => {}
        }
    }
}

fn publish_runtime_error(
    events: &BusSender<ServiceEvent>,
    channel_id: String,
    platform: Platform,
    message: String,
) {
    publish_watched_event(
        events,
        WatchedChannelsEvent::AdapterError {
            channel_id,
            platform,
            message,
        },
    );
}

fn publish_watched_event(events: &BusSender<ServiceEvent>, event: WatchedChannelsEvent) {
    if events
        .try_publish(ServiceEvent::WatchedChannels(event))
        .is_err()
    {}
}

#[derive(Debug, Clone, PartialEq)]
pub enum WatchedChannelsRuntimeEvent {
    ChannelStarted {
        channel_id: String,
        platform: Platform,
        channel_slug: String,
    },
    ChannelRemoved {
        channel_id: String,
    },
    MessageBuffered {
        channel_id: String,
        message: Box<NormalizedChatMessage>,
    },
    StatusChanged {
        channel_id: String,
        status: PlatformStatusInfo,
    },
    AdapterError {
        channel_id: String,
        platform: Platform,
        message: String,
    },
    BackendMessagePlanned {
        message: DesktopToBackendMessage,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchedChannelReconnectError {
    pub channel_id: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchedChannelReconnectReport {
    pub platform: Platform,
    pub reconnected_channel_ids: Vec<String>,
    pub errors: Vec<WatchedChannelReconnectError>,
}

type AdapterFactory<'a> = dyn FnMut(&WatchedChannel) -> WatchedChannelsRuntimeResult<Box<dyn WatchedChannelAdapter + 'a>>
    + 'a;

pub struct WatchedChannelsRuntime<'a> {
    storage: &'a Storage,
    adapter_factory: Box<AdapterFactory<'a>>,
    entries: BTreeMap<String, WatchedEntry<'a>>,
    buffer_size: usize,
    seven_tv: SevenTvSubscriptionPlanner,
    seven_tv_catalog: SevenTvCatalog,
    backend_messages: Vec<DesktopToBackendMessage>,
    events: Vec<WatchedChannelsRuntimeEvent>,
}

impl<'a> WatchedChannelsRuntime<'a> {
    pub fn new(
        storage: &'a Storage,
        adapter_factory: impl FnMut(
            &WatchedChannel,
        )
            -> WatchedChannelsRuntimeResult<Box<dyn WatchedChannelAdapter + 'a>>
        + 'a,
    ) -> Self {
        Self {
            storage,
            adapter_factory: Box::new(adapter_factory),
            entries: BTreeMap::new(),
            buffer_size: DEFAULT_WATCHED_CHANNEL_BUFFER_SIZE,
            seven_tv: SevenTvSubscriptionPlanner::new(),
            seven_tv_catalog: SevenTvCatalog::new(),
            backend_messages: Vec::new(),
            events: Vec::new(),
        }
    }

    pub fn with_buffer_size(mut self, buffer_size: usize) -> Self {
        self.buffer_size = buffer_size.max(1);
        self
    }

    pub fn auto_connect(&mut self) -> WatchedChannelsRuntimeResult<Vec<WatchedChannel>> {
        self.ensure_kick_accounts_are_watched()?;
        let channels = self.storage.watched_channels().find_all()?;
        eprintln!(
            "[watched/live] auto_connect found {} watched channel(s)",
            channels.len()
        );
        for channel in channels.iter().cloned() {
            eprintln!(
                "[watched/live] auto_connect starting platform={:?} slug={} id={}",
                channel.platform, channel.channel_slug, channel.id
            );
            self.start_channel(channel)?;
        }
        Ok(channels)
    }

    fn ensure_kick_accounts_are_watched(&self) -> WatchedChannelsRuntimeResult<()> {
        let accounts = self.storage.accounts().find_all()?;
        for account in accounts
            .iter()
            .filter(|account| account.platform == Platform::Kick)
        {
            let channel = self.storage.watched_channels().upsert(
                Platform::Kick,
                &account.username,
                &account.display_name,
            )?;
            eprintln!(
                "[kick/live] ensured saved Kick account is watched slug={} id={}",
                channel.channel_slug, channel.id
            );
        }
        Ok(())
    }

    pub fn add_channel(
        &mut self,
        platform: Platform,
        channel_slug: &str,
        display_name: Option<&str>,
    ) -> WatchedChannelsRuntimeResult<WatchedChannel> {
        let normalized_slug = normalize_watched_channel_slug(platform, channel_slug);
        let display_name = display_name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(&normalized_slug);
        let channel =
            self.storage
                .watched_channels()
                .upsert(platform, &normalized_slug, display_name)?;

        if self.entries.contains_key(&channel.id) {
            if let Some(entry) = self.entries.get_mut(&channel.id) {
                entry.watched_channel = channel.clone();
            }
        } else {
            self.start_channel(channel.clone())?;
        }

        Ok(channel)
    }

    pub fn remove_channel(&mut self, channel_id: &str) -> WatchedChannelsRuntimeResult<()> {
        let stored_channel = self.storage.watched_channels().find_by_id(channel_id)?;
        if let Some(mut entry) = self.entries.remove(channel_id) {
            if let Err(error) = entry.adapter.disconnect() {
                self.record_adapter_error(channel_id, error);
            }
            self.plan_unsubscribe(entry.watched_channel.platform, &entry.seven_tv_channel_id);
        } else if let Some(channel) = stored_channel.as_ref() {
            self.plan_unsubscribe(channel.platform, &channel.channel_slug);
        }

        self.storage.watched_channels().remove(channel_id)?;
        self.storage.watched_layout().remove(channel_id)?;
        self.cleanup_stale_persistence(channel_id)?;
        self.events
            .push(WatchedChannelsRuntimeEvent::ChannelRemoved {
                channel_id: channel_id.to_string(),
            });
        Ok(())
    }

    pub fn reconnect_by_platform(
        &mut self,
        platform: Platform,
    ) -> WatchedChannelsRuntimeResult<WatchedChannelReconnectReport> {
        let matching_ids = self
            .entries
            .iter()
            .filter(|(_, entry)| entry.watched_channel.platform == platform)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();

        let mut reconnected_channel_ids = Vec::new();
        let mut errors = Vec::new();
        for channel_id in matching_ids {
            match self.reconnect_entry(&channel_id) {
                Ok(()) => reconnected_channel_ids.push(channel_id),
                Err(error) => errors.push(WatchedChannelReconnectError {
                    channel_id,
                    message: error.to_string(),
                }),
            }
        }

        if !reconnected_channel_ids.is_empty() {
            self.plan_resubscribe();
        }

        Ok(WatchedChannelReconnectReport {
            platform,
            reconnected_channel_ids,
            errors,
        })
    }

    pub fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> WatchedChannelsRuntimeResult<()> {
        let entry = self.entries.get_mut(channel_id).ok_or_else(|| {
            WatchedChannelsRuntimeError::ChannelNotFound {
                channel_id: channel_id.to_string(),
            }
        })?;
        entry
            .adapter
            .send_message(
                &entry.watched_channel.channel_slug,
                text,
                reply_to_message_id,
            )
            .map_err(|error| WatchedChannelsRuntimeError::adapter(channel_id, error))
    }

    pub fn poll_channel(&mut self, channel_id: &str) -> WatchedChannelsRuntimeResult<()> {
        let mut sink = CapturingPlatformSink::default();
        let result = {
            let entry = self.entries.get_mut(channel_id).ok_or_else(|| {
                WatchedChannelsRuntimeError::ChannelNotFound {
                    channel_id: channel_id.to_string(),
                }
            })?;
            entry.adapter.poll(&mut sink)
        };
        self.apply_adapter_events(channel_id, sink.into_events());
        result.map_err(|error| WatchedChannelsRuntimeError::adapter(channel_id, error))
    }

    pub fn poll_all(&mut self) -> WatchedChannelsRuntimeResult<()> {
        let channel_ids = self.entries.keys().cloned().collect::<Vec<_>>();
        for channel_id in channel_ids {
            self.poll_channel(&channel_id)?;
        }
        Ok(())
    }

    pub fn get_all(&self) -> WatchedChannelsRuntimeResult<Vec<WatchedChannel>> {
        self.storage
            .watched_channels()
            .find_all()
            .map_err(WatchedChannelsRuntimeError::from)
    }

    pub fn get_messages(&self, channel_id: &str) -> Vec<NormalizedChatMessage> {
        self.entries
            .get(channel_id)
            .map(|entry| entry.messages.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn get_status(&self, channel_id: &str) -> Option<PlatformStatusInfo> {
        self.entries
            .get(channel_id)
            .and_then(|entry| entry.status.clone())
    }

    pub fn get_all_statuses(&self) -> Vec<(String, PlatformStatusInfo)> {
        self.entries
            .iter()
            .filter_map(|(channel_id, entry)| {
                entry
                    .status
                    .clone()
                    .map(|status| (channel_id.clone(), status))
            })
            .collect()
    }

    pub fn channel_count(&self) -> usize {
        self.entries.len()
    }

    pub fn contains_channel(&self, channel_id: &str) -> bool {
        self.entries.contains_key(channel_id)
    }

    pub fn register_seven_tv_emote_set(
        &mut self,
        platform: Platform,
        channel_id: &str,
        emotes: Vec<BackendSevenTvEmote>,
    ) {
        self.seven_tv.remember_preserving_user_id(
            platform,
            channel_id.to_string(),
            [channel_id.to_string()],
        );
        for emote in emotes {
            self.seven_tv_catalog.insert(
                platform,
                channel_id,
                CatalogSevenTvEmote {
                    id: emote.id,
                    name: emote.alias,
                    image_url: emote.image_url,
                    animated: emote.animated,
                    zero_width: emote.zero_width,
                    aspect_ratio: emote.aspect_ratio,
                },
            );
        }
    }

    pub fn seven_tv_subscriptions(&self) -> Vec<SevenTvSubscription> {
        self.seven_tv.subscriptions()
    }

    pub fn resubscribe_seven_tv(&mut self) {
        self.plan_resubscribe();
    }

    pub fn drain_backend_messages(&mut self) -> Vec<DesktopToBackendMessage> {
        self.backend_messages.drain(..).collect()
    }

    pub fn drain_events(&mut self) -> Vec<WatchedChannelsRuntimeEvent> {
        self.events.drain(..).collect()
    }

    fn start_channel(&mut self, channel: WatchedChannel) -> WatchedChannelsRuntimeResult<()> {
        if self.entries.contains_key(&channel.id) {
            eprintln!(
                "[watched/live] skipping already-started channel id={} slug={}",
                channel.id, channel.channel_slug
            );
            return Ok(());
        }

        eprintln!(
            "[watched/live] start_channel platform={:?} slug={} id={}",
            channel.platform, channel.channel_slug, channel.id
        );

        let adapter = (self.adapter_factory)(&channel)?;
        let adapter_platform = adapter.platform();
        if adapter_platform != channel.platform {
            return Err(WatchedChannelsRuntimeError::adapter_factory(
                channel.platform,
                channel.channel_slug,
                format!("factory returned a {:?} adapter", adapter_platform),
            ));
        }

        let channel_id = channel.id.clone();
        let channel_slug = channel.channel_slug.clone();
        let platform = channel.platform;
        let entry = WatchedEntry {
            watched_channel: channel,
            adapter,
            messages: VecDeque::new(),
            status: None,
            seven_tv_channel_id: channel_slug.clone(),
            seven_tv_platform_user_id: None,
        };
        self.entries.insert(channel_id.clone(), entry);

        let mut sink = CapturingPlatformSink::default();
        let connect_result = {
            let Some(entry) = self.entries.get_mut(&channel_id) else {
                return Err(WatchedChannelsRuntimeError::ChannelNotFound {
                    channel_id: channel_id.clone(),
                });
            };
            entry.adapter.connect(&channel_slug, &mut sink)
        };
        eprintln!(
            "[watched/live] connect attempted for platform={:?} slug={} id={} result={}",
            platform,
            channel_slug,
            channel_id,
            if connect_result.is_ok() {
                "ok"
            } else {
                "error"
            }
        );
        self.apply_adapter_events(&channel_id, sink.into_events());
        if let Err(error) = connect_result {
            self.record_adapter_error(&channel_id, error);
        }

        self.sync_entry_seven_tv_state(&channel_id)?;
        self.plan_subscribe_for_entry(&channel_id)?;
        self.events
            .push(WatchedChannelsRuntimeEvent::ChannelStarted {
                channel_id,
                platform,
                channel_slug,
            });
        Ok(())
    }

    fn reconnect_entry(&mut self, channel_id: &str) -> WatchedChannelsRuntimeResult<()> {
        let channel_slug = self
            .entries
            .get(channel_id)
            .map(|entry| entry.watched_channel.channel_slug.clone())
            .ok_or_else(|| WatchedChannelsRuntimeError::ChannelNotFound {
                channel_id: channel_id.to_string(),
            })?;

        let mut sink = CapturingPlatformSink::default();
        let reconnect_result = {
            let Some(entry) = self.entries.get_mut(channel_id) else {
                return Err(WatchedChannelsRuntimeError::ChannelNotFound {
                    channel_id: channel_id.to_string(),
                });
            };
            match entry.adapter.disconnect() {
                Ok(()) => entry.adapter.connect(&channel_slug, &mut sink),
                Err(error) => Err(error),
            }
        };
        self.apply_adapter_events(channel_id, sink.into_events());
        reconnect_result
            .map_err(|error| WatchedChannelsRuntimeError::adapter(channel_id, error))?;
        self.sync_entry_seven_tv_state(channel_id)
    }

    fn apply_adapter_events(&mut self, channel_id: &str, events: Vec<PlatformEvent>) {
        for event in events {
            match event {
                PlatformEvent::Message(message) => self.buffer_message(channel_id, message),
                PlatformEvent::Status(status) => {
                    if let Some(entry) = self.entries.get_mut(channel_id) {
                        entry.status = Some(status.clone());
                    }
                    self.events
                        .push(WatchedChannelsRuntimeEvent::StatusChanged {
                            channel_id: channel_id.to_string(),
                            status,
                        });
                }
                PlatformEvent::Event(_) => {}
            }
        }
    }

    fn buffer_message(&mut self, channel_id: &str, message: NormalizedChatMessage) {
        let Some(seven_tv_channel_id) = self
            .entries
            .get(channel_id)
            .map(|entry| entry.seven_tv_channel_id.clone())
        else {
            return;
        };
        let enriched =
            enrich_message_with_seven_tv(message, &seven_tv_channel_id, &self.seven_tv_catalog);
        if let Some(entry) = self.entries.get_mut(channel_id) {
            entry.messages.push_front(enriched.clone());
            while entry.messages.len() > self.buffer_size {
                entry.messages.pop_back();
            }
        }
        self.events
            .push(WatchedChannelsRuntimeEvent::MessageBuffered {
                channel_id: channel_id.to_string(),
                message: Box::new(enriched),
            });
    }

    fn sync_entry_seven_tv_state(&mut self, channel_id: &str) -> WatchedChannelsRuntimeResult<()> {
        let Some(entry) = self.entries.get_mut(channel_id) else {
            return Err(WatchedChannelsRuntimeError::ChannelNotFound {
                channel_id: channel_id.to_string(),
            });
        };
        let platform = entry.watched_channel.platform;
        let channel_slug = entry.watched_channel.channel_slug.clone();
        let previous_channel_id = entry.seven_tv_channel_id.clone();
        let next_channel_id = entry.adapter.seven_tv_channel_id(&channel_slug);
        let platform_user_id = seven_tv_platform_user_id(self.storage, platform, &channel_slug)?;

        if previous_channel_id != next_channel_id {
            self.seven_tv.forget(platform, &previous_channel_id);
        }

        entry.seven_tv_channel_id = next_channel_id.clone();
        entry.seven_tv_platform_user_id = platform_user_id.clone();
        self.seven_tv
            .remember_exact(platform, next_channel_id, [channel_slug], platform_user_id);
        Ok(())
    }

    fn plan_subscribe_for_entry(&mut self, channel_id: &str) -> WatchedChannelsRuntimeResult<()> {
        let Some(entry) = self.entries.get(channel_id) else {
            return Err(WatchedChannelsRuntimeError::ChannelNotFound {
                channel_id: channel_id.to_string(),
            });
        };
        self.plan_backend_message(DesktopToBackendMessage::SeventvSubscribe {
            platform: entry.watched_channel.platform,
            channel_id: entry.seven_tv_channel_id.clone(),
            platform_user_id: entry.seven_tv_platform_user_id.clone(),
        });
        Ok(())
    }

    fn plan_unsubscribe(&mut self, platform: Platform, channel_id: &str) {
        let backend_channel_id = self
            .seven_tv
            .forget(platform, channel_id)
            .unwrap_or_else(|| channel_id.to_string());
        self.plan_backend_message(DesktopToBackendMessage::SeventvUnsubscribe {
            platform,
            channel_id: backend_channel_id,
        });
    }

    fn plan_resubscribe(&mut self) {
        let subscriptions = self.seven_tv.subscriptions();
        if subscriptions.is_empty() {
            return;
        }
        self.plan_backend_message(DesktopToBackendMessage::SeventvResubscribe { subscriptions });
    }

    fn plan_backend_message(&mut self, message: DesktopToBackendMessage) {
        self.backend_messages.push(message.clone());
        self.events
            .push(WatchedChannelsRuntimeEvent::BackendMessagePlanned { message });
    }

    fn record_adapter_error(&mut self, channel_id: &str, error: PlatformError) {
        eprintln!(
            "[watched/live] recording adapter error channel={} platform={:?}: {}",
            channel_id, error.platform, error.message
        );
        self.events.push(WatchedChannelsRuntimeEvent::AdapterError {
            channel_id: channel_id.to_string(),
            platform: error.platform,
            message: error.message,
        });
    }

    fn cleanup_stale_persistence(
        &self,
        removed_channel_id: &str,
    ) -> WatchedChannelsRuntimeResult<()> {
        let removed = vec![removed_channel_id.to_string()];
        for channel in self.storage.watched_channels().find_all()? {
            self.storage
                .watched_layout()
                .cleanup_stale_assignments(&channel.id, &removed)?;
        }

        if let Some(ids) = self.storage.settings().get_tab_channel_ids()? {
            let filtered = ids
                .into_iter()
                .filter(|id| id != removed_channel_id)
                .collect::<Vec<_>>();
            self.storage.settings().set_tab_channel_ids(&filtered)?;
        }
        Ok(())
    }
}

struct WatchedEntry<'a> {
    watched_channel: WatchedChannel,
    adapter: Box<dyn WatchedChannelAdapter + 'a>,
    messages: VecDeque<NormalizedChatMessage>,
    status: Option<PlatformStatusInfo>,
    seven_tv_channel_id: String,
    seven_tv_platform_user_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct SevenTvKey {
    platform: Platform,
    channel_id: String,
}

impl SevenTvKey {
    fn new(platform: Platform, channel_id: impl Into<String>) -> Self {
        Self {
            platform,
            channel_id: channel_id.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SevenTvSubscriptionState {
    platform: Platform,
    channel_id: String,
    platform_user_id: Option<String>,
    lookup_ids: BTreeSet<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct SevenTvSubscriptionPlanner {
    subscriptions: BTreeMap<SevenTvKey, SevenTvSubscriptionState>,
    lookup_to_channel_key: BTreeMap<SevenTvKey, SevenTvKey>,
}

impl SevenTvSubscriptionPlanner {
    fn new() -> Self {
        Self::default()
    }

    fn remember_exact(
        &mut self,
        platform: Platform,
        channel_id: String,
        lookup_ids: impl IntoIterator<Item = String>,
        platform_user_id: Option<String>,
    ) {
        self.remember(platform, channel_id, lookup_ids, Some(platform_user_id));
    }

    fn remember_preserving_user_id(
        &mut self,
        platform: Platform,
        channel_id: String,
        lookup_ids: impl IntoIterator<Item = String>,
    ) {
        self.remember(platform, channel_id, lookup_ids, None);
    }

    fn remember(
        &mut self,
        platform: Platform,
        channel_id: String,
        lookup_ids: impl IntoIterator<Item = String>,
        platform_user_id: Option<Option<String>>,
    ) {
        let channel_key = SevenTvKey::new(platform, channel_id.clone());
        let subscription = self
            .subscriptions
            .entry(channel_key.clone())
            .or_insert_with(|| SevenTvSubscriptionState {
                platform,
                channel_id: channel_id.clone(),
                platform_user_id: None,
                lookup_ids: BTreeSet::new(),
            });
        if let Some(platform_user_id) = platform_user_id {
            subscription.platform_user_id = platform_user_id;
        }
        subscription.lookup_ids.insert(channel_id);

        for lookup_id in lookup_ids {
            let lookup_key = SevenTvKey::new(platform, lookup_id.clone());
            self.lookup_to_channel_key
                .insert(lookup_key, channel_key.clone());
            subscription.lookup_ids.insert(lookup_id);
        }
    }

    fn forget(&mut self, platform: Platform, channel_id: &str) -> Option<String> {
        let direct_key = SevenTvKey::new(platform, channel_id.to_string());
        let channel_key = self
            .lookup_to_channel_key
            .get(&direct_key)
            .cloned()
            .unwrap_or(direct_key);
        let subscription = self.subscriptions.remove(&channel_key)?;
        for lookup_id in &subscription.lookup_ids {
            self.lookup_to_channel_key
                .remove(&SevenTvKey::new(platform, lookup_id.clone()));
        }
        Some(subscription.channel_id)
    }

    fn subscriptions(&self) -> Vec<SevenTvSubscription> {
        self.subscriptions
            .values()
            .map(|subscription| SevenTvSubscription {
                platform: subscription.platform,
                channel_id: subscription.channel_id.clone(),
                platform_user_id: subscription.platform_user_id.clone(),
            })
            .collect()
    }
}

#[derive(Default)]
struct CapturingPlatformSink {
    events: Vec<PlatformEvent>,
}

impl CapturingPlatformSink {
    fn into_events(self) -> Vec<PlatformEvent> {
        self.events
    }
}

impl PlatformEventSink for CapturingPlatformSink {
    fn emit(&mut self, event: PlatformEvent) -> PlatformResult<()> {
        self.events.push(event);
        Ok(())
    }
}

fn seven_tv_platform_user_id(
    storage: &Storage,
    platform: Platform,
    channel_slug: &str,
) -> Result<Option<String>, StorageError> {
    if platform != Platform::Twitch {
        return Ok(None);
    }

    let matching_account = storage.accounts().find_all()?.into_iter().find(|account| {
        account.platform == Platform::Twitch && account.username.eq_ignore_ascii_case(channel_slug)
    });
    Ok(matching_account.map(|account| account.platform_user_id))
}
