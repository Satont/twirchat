use crate::protocol::messages::{UserCardMetadataRequest, UserCardMetadataResponse};
use crate::protocol::rpc::{GetUserChatHistoryParams, UserChatHistoryPage};
use crate::protocol::types::Platform;
use crate::runtime::{RuntimeConfig, RuntimeConfigInput};
use crate::services::{
    BackendWsCommand, BackendWsConfig, BusReceiver, ServiceCommand, ServiceEvent, ServiceKind,
    ServiceResult, ServiceRuntimeConfig, ServiceSupervisor, WatchedChannelsCommand,
};
use crate::services::{UserCardServiceError, fetch_user_card_metadata, get_user_chat_history};
use crate::storage::{Storage, StorageError};
use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub enum AppRuntimeError {
    Storage(StorageError),
    Service(crate::services::ServiceError),
    UserCard(UserCardServiceError),
}

impl fmt::Display for AppRuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(source) => write!(f, "failed to initialize app storage: {source}"),
            Self::Service(source) => write!(f, "failed to initialize app services: {source}"),
            Self::UserCard(source) => write!(f, "failed to load user-card data: {source}"),
        }
    }
}

impl Error for AppRuntimeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Storage(source) => Some(source),
            Self::Service(source) => Some(source),
            Self::UserCard(source) => Some(source),
        }
    }
}

impl From<StorageError> for AppRuntimeError {
    fn from(value: StorageError) -> Self {
        Self::Storage(value)
    }
}

impl From<crate::services::ServiceError> for AppRuntimeError {
    fn from(value: crate::services::ServiceError) -> Self {
        Self::Service(value)
    }
}

impl From<UserCardServiceError> for AppRuntimeError {
    fn from(value: UserCardServiceError) -> Self {
        Self::UserCard(value)
    }
}

pub struct AppRuntime {
    config: RuntimeConfig,
    storage: Storage,
    supervisor: ServiceSupervisor,
    events: BusReceiver<ServiceEvent>,
}

#[derive(Clone)]
pub struct UserCardRuntimeLoader {
    config: RuntimeConfig,
}

impl UserCardRuntimeLoader {
    pub fn load_user_chat_history(
        &self,
        params: GetUserChatHistoryParams,
    ) -> Result<UserChatHistoryPage, AppRuntimeError> {
        let storage = Storage::open_or_recover(self.config.db_path())?;
        Ok(get_user_chat_history(&storage, params)?)
    }

    pub fn fetch_user_card_metadata(
        &self,
        request: UserCardMetadataRequest,
    ) -> Result<UserCardMetadataResponse, AppRuntimeError> {
        let storage = Storage::open_or_recover(self.config.db_path())?;
        Ok(fetch_user_card_metadata(&storage, &self.config, request)?)
    }
}

impl AppRuntime {
    pub fn start(input: RuntimeConfigInput) -> Result<Self, AppRuntimeError> {
        let hydrate_client_secret = input.client_secret.is_none();
        let mut config = RuntimeConfig::new(input);
        let storage = Storage::open_or_recover(config.db_path())?;
        if hydrate_client_secret {
            config.apply(RuntimeConfigInput {
                client_secret: Some(storage.client_identity().get_client_secret()?),
                ..Default::default()
            });
        }
        let service_config = ServiceRuntimeConfig::default()
            .with_backend_ws(BackendWsConfig::new(
                config.backend_ws_url(),
                config.db_path(),
            ))
            .with_storage_path(config.db_path());
        let mut supervisor = ServiceSupervisor::new(service_config)?;
        let events = supervisor.take_event_receiver().ok_or(
            crate::services::ServiceError::ServiceMissing {
                service: ServiceKind::Storage,
            },
        )?;

        supervisor.start()?;
        supervisor.dispatch(
            ServiceKind::BackendWs,
            ServiceCommand::BackendWs(BackendWsCommand::Connect),
        )?;

        Ok(Self {
            config,
            storage,
            supervisor,
            events,
        })
    }

    pub fn storage(&self) -> &Storage {
        &self.storage
    }

    pub fn config(&self) -> &RuntimeConfig {
        &self.config
    }

    pub fn user_card_loader(&self) -> UserCardRuntimeLoader {
        UserCardRuntimeLoader {
            config: self.config.clone(),
        }
    }

    pub fn drain_events(&self) -> Vec<ServiceEvent> {
        let mut events = Vec::new();
        loop {
            match self.events.try_recv() {
                Ok(event) => events.push(event),
                Err(crate::services::BusTryRecvError::Empty) => break,
                Err(crate::services::BusTryRecvError::Closed) => break,
            }
        }
        events
    }

    pub fn dispatch_watched_channel_add(
        &self,
        platform: Platform,
        channel_slug: String,
        display_name: Option<String>,
    ) -> ServiceResult<()> {
        self.supervisor.dispatch(
            ServiceKind::WatchedChannels,
            ServiceCommand::WatchedChannels(WatchedChannelsCommand::Add {
                platform,
                channel_slug,
                display_name,
            }),
        )
    }

    pub fn dispatch_watched_channel_message(
        &self,
        channel_id: String,
        text: String,
        reply_to_message_id: Option<String>,
        client_message_id: Option<String>,
    ) -> ServiceResult<()> {
        self.supervisor.dispatch(
            ServiceKind::WatchedChannels,
            ServiceCommand::WatchedChannels(WatchedChannelsCommand::SendMessage {
                channel_id,
                text,
                reply_to_message_id,
                client_message_id,
            }),
        )
    }

    pub fn dispatch_watched_channel_remove(&self, channel_id: String) -> ServiceResult<()> {
        self.supervisor.dispatch(
            ServiceKind::WatchedChannels,
            ServiceCommand::WatchedChannels(WatchedChannelsCommand::Remove { channel_id }),
        )
    }

    pub fn dispatch_seven_tv_resubscribe(&self) -> ServiceResult<()> {
        self.supervisor.dispatch(
            ServiceKind::WatchedChannels,
            ServiceCommand::WatchedChannels(WatchedChannelsCommand::ResubscribeSevenTv),
        )
    }

    pub fn dispatch_backend_ws_message(
        &self,
        message: crate::protocol::messages::DesktopToBackendMessage,
    ) -> ServiceResult<()> {
        self.supervisor.dispatch(
            ServiceKind::BackendWs,
            ServiceCommand::BackendWs(BackendWsCommand::SendMessage { message }),
        )
    }

    pub fn load_user_chat_history(
        &self,
        params: GetUserChatHistoryParams,
    ) -> Result<UserChatHistoryPage, AppRuntimeError> {
        Ok(get_user_chat_history(&self.storage, params)?)
    }

    pub fn fetch_user_card_metadata(
        &self,
        request: UserCardMetadataRequest,
    ) -> Result<UserCardMetadataResponse, AppRuntimeError> {
        Ok(fetch_user_card_metadata(
            &self.storage,
            &self.config,
            request,
        )?)
    }
}

impl Drop for AppRuntime {
    fn drop(&mut self) {
        if self.supervisor.stop().is_err() {}
    }
}
