use crate::protocol::{NormalizedChatMessage, Platform, UserAlias};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AliasBook {
    aliases: BTreeMap<(Platform, String), String>,
}

impl AliasBook {
    pub fn from_aliases(aliases: impl IntoIterator<Item = UserAlias>) -> Self {
        let mut book = Self::default();
        for alias in aliases {
            book.set(alias.platform, alias.platform_user_id, alias.alias);
        }
        book
    }

    pub fn set(&mut self, platform: Platform, platform_user_id: String, alias: String) {
        if alias.is_empty() {
            self.aliases.remove(&(platform, platform_user_id));
        } else {
            self.aliases.insert((platform, platform_user_id), alias);
        }
    }

    pub fn remove(&mut self, platform: Platform, platform_user_id: &str) {
        self.aliases
            .remove(&(platform, platform_user_id.to_owned()));
    }

    pub fn get(&self, platform: Platform, platform_user_id: &str) -> Option<&str> {
        self.aliases
            .get(&(platform, platform_user_id.to_owned()))
            .map(String::as_str)
    }

    pub fn apply(&self, message: &NormalizedChatMessage) -> AliasedChatMessage {
        apply_alias(message, self.get(message.platform, &message.author.id))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AliasedChatMessage {
    pub message: NormalizedChatMessage,
    pub original_display_name: String,
    pub alias: Option<String>,
}

pub fn apply_alias(message: &NormalizedChatMessage, alias: Option<&str>) -> AliasedChatMessage {
    let mut message = message.clone();
    let original_display_name = message.author.display_name.clone();
    let alias = alias.filter(|value| !value.is_empty()).map(str::to_owned);

    if let Some(alias) = &alias {
        message.author.display_name = alias.clone();
    }

    AliasedChatMessage {
        message,
        original_display_name,
        alias,
    }
}

pub fn apply_aliases<'a>(
    messages: impl IntoIterator<Item = &'a NormalizedChatMessage>,
    aliases: &AliasBook,
) -> Vec<AliasedChatMessage> {
    messages
        .into_iter()
        .map(|message| aliases.apply(message))
        .collect()
}
