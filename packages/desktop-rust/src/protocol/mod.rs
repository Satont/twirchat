//! Shared protocol contracts ported from the TypeScript desktop packages.

pub mod error;
pub mod messages;
pub mod rpc;
pub mod types;

pub use error::ProtocolDecodeError;
pub use messages::*;
pub use rpc::*;
pub use types::*;
