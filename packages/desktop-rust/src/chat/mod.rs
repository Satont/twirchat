//! Chat domain logic shared by the Rust desktop shell.

pub mod aggregate;
pub mod alias;
pub mod history;
pub mod normalize;

pub use aggregate::{
    ChatAggregator, ChatReplayItem, IngestOutcome, SevenTvCatalog, SevenTvEmote,
    enrich_message_with_seven_tv, merge_seven_tv_emotes,
};
pub use alias::{AliasBook, apply_alias, apply_aliases};
pub use history::{compare_messages, insert_live_message, merge_older_page, sort_messages};
pub use normalize::{
    NormalizedChatItem, message_timestamp_millis, normalize_event, normalize_message,
};
