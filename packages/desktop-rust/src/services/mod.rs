//! Runtime service boundary for later backend and desktop integrations.
//!
//! The service layer is intentionally UI-agnostic. Background workers communicate
//! through typed commands and events; GPUI state remains owned by `Entity<AppState>`
//! and can be updated by a future UI-side event drain using `update(..., cx.notify())`.

pub mod backend_ws;
pub mod bus;
pub mod commands;
pub mod events;
pub mod stream_status;
pub mod supervisor;
pub mod update_state;
pub mod user_card;
pub mod watched_channels;

pub use backend_ws::*;
pub use bus::{
    BusConfig, BusConfigError, BusReceiver, BusRecvError, BusSendError, BusSender, BusTryRecvError,
    bounded,
};
pub use commands::*;
pub use events::*;
pub use stream_status::*;
pub use supervisor::*;
pub use update_state::*;
pub use user_card::*;
pub use watched_channels::*;
