//! Native Twitch platform adapter surface.

pub mod adapter;
pub mod mock;

pub use adapter::{
    StreamUpdate, StreamUpdateOutcome, TwitchAdapter, TwitchAuthState, TwitchCategory,
    TwitchChatClient, TwitchChatEvent, TwitchChatMessage, TwitchEmoteSpan,
};
pub use mock::MockTwitchClient;
