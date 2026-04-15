use crate::platforms::adapter::{AdapterEvent, PlatformAdapter};
use crate::{AppError, Platform};

pub struct YouTubeAdapter;

#[async_trait::async_trait]
impl PlatformAdapter for YouTubeAdapter {
    async fn connect(
        &self,
        _channel: &str,
        _event_tx: tokio::sync::mpsc::Sender<AdapterEvent>,
    ) -> Result<(), AppError> {
        Err(AppError::Adapter(
            "YouTube adapter not yet implemented".to_owned(),
        ))
    }

    async fn disconnect(&self, _channel: &str) -> Result<(), AppError> {
        Ok(())
    }

    async fn send_message(
        &self,
        _channel_id: &str,
        _text: &str,
        _reply_to: Option<&str>,
    ) -> Result<(), AppError> {
        Err(AppError::Adapter(
            "youtube message sending is not supported".to_owned(),
        ))
    }

    fn platform(&self) -> Platform {
        Platform::YouTube
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn connect_returns_not_implemented_error() {
        let adapter = YouTubeAdapter;
        let (tx, _rx) = tokio::sync::mpsc::channel(1);
        let err = adapter.connect("somechannel", tx).await.unwrap_err();
        assert!(
            err.to_string().contains("not yet implemented"),
            "expected 'not yet implemented' in error, got: {err}"
        );
    }

    #[tokio::test]
    async fn disconnect_returns_ok() {
        let adapter = YouTubeAdapter;
        assert!(adapter.disconnect("somechannel").await.is_ok());
    }

    #[test]
    fn platform_is_youtube() {
        assert_eq!(YouTubeAdapter.platform(), Platform::YouTube);
    }
}
