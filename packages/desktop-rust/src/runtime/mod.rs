//! Runtime utility layer for the future native desktop runtime.
//!
//! This module intentionally mirrors the TypeScript desktop utility boundary without
//! binding to GPUI, webviews, RPC transports, or the real updater pipeline.

pub mod app;
pub mod browser;
pub mod config;
pub mod packaging;
pub mod update;

pub use app::{AppRuntime, AppRuntimeError};
pub use browser::{ExternalOpenError, ExternalOpenResult, ExternalOpener, SystemExternalOpener};
pub use config::{
    AUTH_CALLBACK_BASE, BackendRequestConfig, DEFAULT_AUTH_SERVER_PORT, DEFAULT_BACKEND_URL,
    DEFAULT_BACKEND_WS_URL, DEFAULT_OVERLAY_SERVER_PORT, KICK_REDIRECT_URI, RuntimeConfig,
    RuntimeConfigInput, TWITCH_REDIRECT_URI, YOUTUBE_REDIRECT_URI,
};
pub use packaging::{
    AssetKind, AssetRequirement, PackagingAppMetadata, PackagingVerificationError,
    PackagingVerificationReport, PackagingVerificationStatus, TwirChatPackagingSpec,
    verify_packaging_artifact,
};
pub use update::{
    UPDATE_CHECK_INTERVAL, UpdateEvent, UpdateRuntime, UpdateState, UpdateStatus,
    UpdateStatusSnapshot,
};
