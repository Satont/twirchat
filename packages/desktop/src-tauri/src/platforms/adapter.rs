use crate::{AppError, NormalizedChatMessage, NormalizedEvent, Platform};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdapterState {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[async_trait::async_trait]
pub trait PlatformAdapter: Send + Sync {
    async fn connect(
        &self,
        channel: &str,
        event_tx: tokio::sync::mpsc::Sender<AdapterEvent>,
    ) -> Result<(), AppError>;
    async fn disconnect(&self, channel: &str) -> Result<(), AppError>;
    async fn send_message(
        &self,
        channel_id: &str,
        text: &str,
        reply_to: Option<&str>,
    ) -> Result<(), AppError>;
    fn platform(&self) -> Platform;
}

#[derive(Debug, Clone)]
pub enum AdapterEvent {
    Message(Box<NormalizedChatMessage>),
    Event(Box<NormalizedEvent>),
    Status {
        platform: Platform,
        channel: String,
        state: AdapterState,
    },
}

struct ChannelHandle {
    state: AdapterState,
    task: Option<JoinHandle<()>>,
}

pub struct AdapterTaskManager {
    channels: Arc<Mutex<HashMap<String, ChannelHandle>>>,
}

impl AdapterTaskManager {
    #[must_use]
    pub fn new() -> Self {
        Self {
            channels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Connects to `channel` using `adapter`, spawning a background task.
    ///
    /// No-op if the channel is already `Connected` or `Connecting`.
    ///
    /// # Errors
    ///
    /// Returns [`AppError`] if the channel map lock is poisoned.
    pub async fn connect<A: PlatformAdapter + 'static>(
        &self,
        adapter: Arc<A>,
        channel: &str,
        event_tx: tokio::sync::mpsc::Sender<AdapterEvent>,
    ) -> Result<(), AppError> {
        let mut guard = self.channels.lock().await;
        let key = channel.to_owned();

        if guard
            .get(&key)
            .is_some_and(|h| matches!(h.state, AdapterState::Connected | AdapterState::Connecting))
        {
            return Ok(());
        }

        guard.insert(
            key.clone(),
            ChannelHandle {
                state: AdapterState::Connecting,
                task: None,
            },
        );
        drop(guard);

        let channels = Arc::clone(&self.channels);
        let channel_owned = key.clone();
        let platform = adapter.platform();

        let task = tokio::spawn(async move {
            let status_tx = event_tx.clone();

            let result = adapter.connect(&channel_owned, event_tx).await;

            let mut guard = channels.lock().await;
            if let Some(handle) = guard.get_mut(&channel_owned) {
                handle.state = match result {
                    Ok(()) => AdapterState::Connected,
                    Err(ref e) => AdapterState::Error(e.to_string()),
                };
            }

            let state = guard
                .get(&channel_owned)
                .map_or(AdapterState::Disconnected, |h| h.state.clone());
            drop(guard);

            let _ = status_tx
                .send(AdapterEvent::Status {
                    platform,
                    channel: channel_owned,
                    state,
                })
                .await;
        });

        let mut guard = self.channels.lock().await;
        if let Some(handle) = guard.get_mut(&key) {
            handle.task = Some(task);
        }
        drop(guard);
        Ok(())
    }

    /// Aborts the background task for `channel` and transitions it to `Disconnected`.
    ///
    /// # Errors
    ///
    /// Always returns `Ok(())` (error reserved for future implementations).
    pub async fn disconnect(&self, channel: &str) -> Result<(), AppError> {
        let mut guard = self.channels.lock().await;
        if let Some(handle) = guard.get_mut(channel) {
            handle.state = AdapterState::Disconnecting;
            if let Some(task) = handle.task.take() {
                task.abort();
            }
            handle.state = AdapterState::Disconnected;
        }
        drop(guard);
        Ok(())
    }

    pub async fn get_state(&self, channel: &str) -> AdapterState {
        self.channels
            .lock()
            .await
            .get(channel)
            .map_or(AdapterState::Disconnected, |h| h.state.clone())
    }
}

impl Default for AdapterTaskManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    struct MockAdapter {
        platform: Platform,
        should_fail: bool,
        connected: Arc<AtomicBool>,
    }

    impl MockAdapter {
        fn new(platform: Platform) -> Self {
            Self {
                platform,
                should_fail: false,
                connected: Arc::new(AtomicBool::new(false)),
            }
        }

        fn failing(platform: Platform) -> Self {
            Self {
                platform,
                should_fail: true,
                connected: Arc::new(AtomicBool::new(false)),
            }
        }
    }

    #[async_trait::async_trait]
    impl PlatformAdapter for MockAdapter {
        async fn connect(
            &self,
            _channel: &str,
            _event_tx: tokio::sync::mpsc::Sender<AdapterEvent>,
        ) -> Result<(), AppError> {
            if self.should_fail {
                return Err(AppError::Adapter("mock failure".to_owned()));
            }
            self.connected.store(true, Ordering::SeqCst);
            Ok(())
        }

        async fn disconnect(&self, _channel: &str) -> Result<(), AppError> {
            self.connected.store(false, Ordering::SeqCst);
            Ok(())
        }

        async fn send_message(
            &self,
            _channel_id: &str,
            _text: &str,
            _reply_to: Option<&str>,
        ) -> Result<(), AppError> {
            Ok(())
        }

        fn platform(&self) -> Platform {
            self.platform
        }
    }

    #[tokio::test]
    async fn connect_transitions_to_connected() {
        let manager = AdapterTaskManager::new();
        let adapter = Arc::new(MockAdapter::new(Platform::Twitch));
        let (tx, _rx) = tokio::sync::mpsc::channel(16);

        manager.connect(adapter, "testchannel", tx).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let state = manager.get_state("testchannel").await;
        assert_eq!(state, AdapterState::Connected);
    }

    #[tokio::test]
    async fn connect_error_transitions_to_error_state() {
        let manager = AdapterTaskManager::new();
        let adapter = Arc::new(MockAdapter::failing(Platform::Twitch));
        let (tx, _rx) = tokio::sync::mpsc::channel(16);

        manager.connect(adapter, "failchan", tx).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let state = manager.get_state("failchan").await;
        assert!(matches!(state, AdapterState::Error(_)));
    }

    #[tokio::test]
    async fn disconnect_transitions_to_disconnected() {
        let manager = AdapterTaskManager::new();
        let adapter = Arc::new(MockAdapter::new(Platform::Kick));
        let (tx, _rx) = tokio::sync::mpsc::channel(16);

        manager.connect(adapter, "chan", tx).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        manager.disconnect("chan").await.unwrap();
        let state = manager.get_state("chan").await;
        assert_eq!(state, AdapterState::Disconnected);
    }

    #[tokio::test]
    async fn get_state_unknown_channel_is_disconnected() {
        let manager = AdapterTaskManager::new();
        assert_eq!(
            manager.get_state("unknown").await,
            AdapterState::Disconnected
        );
    }

    #[tokio::test]
    async fn duplicate_connect_is_noop() {
        let manager = AdapterTaskManager::new();
        let adapter = Arc::new(MockAdapter::new(Platform::Twitch));
        let (tx, _rx) = tokio::sync::mpsc::channel(16);

        manager
            .connect(Arc::clone(&adapter), "chan", tx.clone())
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        manager
            .connect(Arc::clone(&adapter), "chan", tx)
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let state = manager.get_state("chan").await;
        assert_eq!(state, AdapterState::Connected);
    }
}
