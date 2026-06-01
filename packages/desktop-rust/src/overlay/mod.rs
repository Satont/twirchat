//! OBS overlay HTTP and WebSocket boundary.
//!
//! This module intentionally stays independent from GPUI. The overlay UI remains
//! the built Vue sublayer from `packages/desktop/dist/overlay`; Rust is only
//! responsible for serving those assets and broadcasting the same JSON messages
//! that the Vue client already understands.

pub mod protocol;
pub mod server;

pub use protocol::{MessagePart, OverlayChatMessage, OverlayMessage, build_message_parts};
pub use server::{
    DEFAULT_OVERLAY_PORT, OverlayBroadcast, OverlayRuntimePaths, OverlayServer,
    OverlayServerConfig, OverlayServerError, resolve_overlay_runtime_paths,
};
