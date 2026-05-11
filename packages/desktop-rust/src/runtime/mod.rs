//! Runtime utility layer for the future native desktop runtime.
//!
//! This module intentionally mirrors the TypeScript desktop utility boundary without
//! binding to GPUI, webviews, RPC transports, or the real updater pipeline.

pub mod browser;
pub mod config;
pub mod packaging;
pub mod update;

pub use browser::{ExternalOpenError, ExternalOpenResult, ExternalOpener, SystemExternalOpener};
pub use config::{BackendRequestConfig, RuntimeConfig, RuntimeConfigInput};
pub use packaging::{
    AssetKind, AssetRequirement, PackagingAppMetadata, PackagingVerificationError,
    PackagingVerificationReport, PackagingVerificationStatus, TwirChatPackagingSpec,
    verify_packaging_artifact,
};
pub use update::{
    UPDATE_CHECK_INTERVAL, UpdateEvent, UpdateRuntime, UpdateState, UpdateStatus,
    UpdateStatusSnapshot,
};
