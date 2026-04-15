use crate::{backend, platforms};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

pub struct AppState {
    // rusqlite::Connection is Send but NOT Sync, hence std::sync::Mutex (not tokio::sync::Mutex).
    pub db: Mutex<Connection>,
    pub db_path: PathBuf,

    pub twitch_manager: platforms::adapter::AdapterTaskManager,
    pub kick_manager: platforms::adapter::AdapterTaskManager,
    pub youtube_manager: platforms::adapter::AdapterTaskManager,

    pub backend: backend::connection::BackendConnectionManager,
    pub event_tx: mpsc::Sender<platforms::adapter::AdapterEvent>,
    pub http_client: reqwest::Client,
    pub backend_url: String,
    pub backend_ws_url: String,
    pub client_secret: String,
    pub twitch_adapter: Arc<platforms::twitch::adapter::TwitchAdapter>,
    pub kick_adapter: Arc<platforms::kick::adapter::KickAdapter>,
    pub channel_emotes: Mutex<HashMap<(crate::Platform, String), Vec<crate::SevenTVEmote>>>,
}

impl AppState {
    #[must_use]
    pub fn new(
        conn: Connection,
        db_path: PathBuf,
        backend_mgr: backend::connection::BackendConnectionManager,
        event_tx: mpsc::Sender<platforms::adapter::AdapterEvent>,
        client_secret: String,
        twitch_adapter: Arc<platforms::twitch::adapter::TwitchAdapter>,
        kick_adapter: Arc<platforms::kick::adapter::KickAdapter>,
    ) -> Self {
        let backend_url = std::env::var("CHATRIX_BACKEND_URL")
            .or_else(|_| std::env::var("TWIRCHAT_BACKEND_URL"))
            .unwrap_or_else(|_| "http://127.0.0.1:3000".to_owned());
        let backend_ws_url = std::env::var("CHATRIX_BACKEND_WS_URL")
            .or_else(|_| std::env::var("TWIRCHAT_BACKEND_WS_URL"))
            .unwrap_or_else(|_| "ws://127.0.0.1:3000/ws".to_owned());

        Self {
            db: Mutex::new(conn),
            db_path,
            twitch_manager: platforms::adapter::AdapterTaskManager::new(),
            kick_manager: platforms::adapter::AdapterTaskManager::new(),
            youtube_manager: platforms::adapter::AdapterTaskManager::new(),
            backend: backend_mgr,
            event_tx,
            http_client: reqwest::Client::new(),
            backend_url,
            backend_ws_url,
            client_secret,
            twitch_adapter,
            kick_adapter,
            channel_emotes: Mutex::new(HashMap::new()),
        }
    }

    /// # Errors
    ///
    /// Returns [`crate::AppError::Adapter`] if the mutex is poisoned.
    pub fn db(&self) -> Result<std::sync::MutexGuard<'_, Connection>, crate::AppError> {
        self.db
            .lock()
            .map_err(|_| crate::AppError::Adapter("db mutex poisoned".into()))
    }

    /// # Errors
    ///
    /// Returns [`crate::AppError::Adapter`] if the mutex is poisoned.
    pub fn get_channel_emotes(
        &self,
        platform: crate::Platform,
        channel_id: &str,
    ) -> Result<Vec<crate::SevenTVEmote>, crate::AppError> {
        self.channel_emotes
            .lock()
            .map_err(|_| crate::AppError::Adapter("channel emotes mutex poisoned".into()))
            .map(|cache| {
                cache
                    .get(&(platform, channel_id.to_owned()))
                    .cloned()
                    .unwrap_or_default()
            })
    }

    /// # Errors
    ///
    /// Returns [`crate::AppError::Adapter`] if the mutex is poisoned.
    pub fn set_channel_emotes(
        &self,
        platform: crate::Platform,
        channel_id: &str,
        emotes: Vec<crate::SevenTVEmote>,
    ) -> Result<(), crate::AppError> {
        self.channel_emotes
            .lock()
            .map_err(|_| crate::AppError::Adapter("channel emotes mutex poisoned".into()))?
            .insert((platform, channel_id.to_owned()), emotes);
        Ok(())
    }

    /// # Errors
    ///
    /// Returns [`crate::AppError::Adapter`] if the mutex is poisoned.
    pub fn add_channel_emote(
        &self,
        platform: crate::Platform,
        channel_id: &str,
        emote: crate::SevenTVEmote,
    ) -> Result<(), crate::AppError> {
        self.channel_emotes
            .lock()
            .map_err(|_| crate::AppError::Adapter("channel emotes mutex poisoned".into()))?
            .entry((platform, channel_id.to_owned()))
            .or_default()
            .push(emote);
        Ok(())
    }

    /// # Errors
    ///
    /// Returns [`crate::AppError::Adapter`] if the mutex is poisoned.
    pub fn remove_channel_emote(
        &self,
        platform: crate::Platform,
        channel_id: &str,
        emote_id: &str,
    ) -> Result<(), crate::AppError> {
        if let Some(emotes) = self
            .channel_emotes
            .lock()
            .map_err(|_| crate::AppError::Adapter("channel emotes mutex poisoned".into()))?
            .get_mut(&(platform, channel_id.to_owned()))
        {
            emotes.retain(|emote| emote.id != emote_id);
        }
        Ok(())
    }

    /// # Errors
    ///
    /// Returns [`crate::AppError::Adapter`] if the mutex is poisoned.
    pub fn update_channel_emote_alias(
        &self,
        platform: crate::Platform,
        channel_id: &str,
        emote_id: &str,
        new_alias: &str,
    ) -> Result<(), crate::AppError> {
        if let Some(emote) = self
            .channel_emotes
            .lock()
            .map_err(|_| crate::AppError::Adapter("channel emotes mutex poisoned".into()))?
            .get_mut(&(platform, channel_id.to_owned()))
            .and_then(|emotes| emotes.iter_mut().find(|emote| emote.id == emote_id))
        {
            new_alias.clone_into(&mut emote.alias);
        }
        Ok(())
    }
}
