use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct ParityMatrix {
    pub version: u32,
    pub source_root: String,
    #[serde(default)]
    pub source_reference_corrections: Vec<SourceReferenceCorrection>,
    pub rows: Vec<ParityRow>,
}

#[derive(Debug, Deserialize)]
pub struct SourceReferenceCorrection {
    pub incorrect: String,
    pub correct: String,
}

#[derive(Debug, Deserialize)]
pub struct ParityRow {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub status: String,
    pub source_path: String,
    pub owner_module: String,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SummaryBucket {
    Components,
    Stores,
    Rpc,
    Overlay,
    Settings,
    Hotkeys,
    PlatformCapabilities,
    ModalPopover,
    FailureStates,
}

impl SummaryBucket {
    pub fn label(self) -> &'static str {
        match self {
            Self::Components => "components",
            Self::Stores => "stores",
            Self::Rpc => "rpc",
            Self::Overlay => "overlay",
            Self::Settings => "settings",
            Self::Hotkeys => "hotkeys",
            Self::PlatformCapabilities => "platform_capabilities",
            Self::ModalPopover => "modals_popovers",
            Self::FailureStates => "failure_states",
        }
    }
}

#[derive(Debug)]
pub struct ValidationSummary {
    pub counts: BTreeMap<SummaryBucket, usize>,
}

#[derive(Debug)]
pub struct ValidationError {
    issues: Vec<String>,
}

impl ValidationError {
    fn new(issues: Vec<String>) -> Self {
        Self { issues }
    }

    pub fn issues(&self) -> &[String] {
        &self.issues
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "parity matrix invalid")?;
        for issue in &self.issues {
            writeln!(f, "- {issue}")?;
        }
        Ok(())
    }
}

impl std::error::Error for ValidationError {}

impl ParityMatrix {
    pub fn from_path(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let text = fs::read_to_string(path)?;
        let matrix = serde_json::from_str(&text)?;
        Ok(matrix)
    }

    pub fn validate(&self) -> Result<ValidationSummary, ValidationError> {
        let mut issues = Vec::new();

        if self.version != 1 {
            issues.push(format!("expected version 1, found {}", self.version));
        }

        if self.source_root != "packages/desktop" {
            issues.push(format!(
                "expected source_root packages/desktop, found {}",
                self.source_root
            ));
        }

        if self.source_reference_corrections.is_empty() {
            issues.push(
                "expected source_reference_corrections to document broken plan references".into(),
            );
        }

        for correction in &self.source_reference_corrections {
            if correction.incorrect.trim().is_empty() || correction.correct.trim().is_empty() {
                issues.push("source_reference_corrections entries must include incorrect and correct values".into());
            }
        }

        let mut seen_ids = BTreeSet::new();
        let mut names_by_kind: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        let mut counts: BTreeMap<SummaryBucket, usize> = BTreeMap::new();
        let mut removed_count = 0usize;

        for row in &self.rows {
            if !seen_ids.insert(row.id.as_str()) {
                issues.push(format!("duplicate row id: {}", row.id));
            }

            match row.status.as_str() {
                "in_scope" | "deferred_packaging_updater" => {}
                "removed_with_reason" => {
                    removed_count += 1;
                    if row.notes.as_deref().unwrap_or("").trim().is_empty() {
                        issues.push(format!(
                            "row {} uses removed_with_reason but has no notes",
                            row.id
                        ));
                    }
                }
                other => issues.push(format!("row {} has invalid status {other}", row.id)),
            }

            if row.source_path.trim().is_empty() {
                issues.push(format!("row {} is missing source_path", row.id));
            }

            if row.owner_module.trim().is_empty() {
                issues.push(format!("row {} is missing owner_module", row.id));
            }

            names_by_kind
                .entry(row.kind.as_str())
                .or_default()
                .insert(row.name.as_str());

            if let Some(bucket) = bucket_for_kind(&row.kind) {
                *counts.entry(bucket).or_default() += 1;
            }
        }

        if removed_count != 0 {
            issues.push(format!(
                "expected removed_with_reason count to be 0, found {removed_count}"
            ));
        }

        require_named_rows(
            &mut issues,
            &names_by_kind,
            &[
                "component",
                "page",
                "dialog",
                "modal",
                "popover",
                "tooltip",
                "context_menu",
            ],
            REQUIRED_COMPONENTS,
            "components/pages",
        );
        require_named_rows(
            &mut issues,
            &names_by_kind,
            &["rpc_request"],
            REQUIRED_RPC_REQUESTS,
            "rpc requests",
        );
        require_named_rows(
            &mut issues,
            &names_by_kind,
            &["rpc_message"],
            REQUIRED_RPC_MESSAGES,
            "rpc messages",
        );
        require_named_rows(
            &mut issues,
            &names_by_kind,
            &["backend_message"],
            REQUIRED_BACKEND_MESSAGES,
            "backend messages",
        );
        require_named_rows(
            &mut issues,
            &names_by_kind,
            &["desktop_message"],
            REQUIRED_DESKTOP_MESSAGES,
            "desktop messages",
        );
        require_named_rows(
            &mut issues,
            &names_by_kind,
            &["overlay_query_param"],
            REQUIRED_OVERLAY_QUERY_PARAMS,
            "overlay query params",
        );
        require_named_rows(
            &mut issues,
            &names_by_kind,
            &["overlay_event"],
            REQUIRED_OVERLAY_EVENTS,
            "overlay events",
        );
        require_named_rows(
            &mut issues,
            &names_by_kind,
            &["hotkey"],
            REQUIRED_HOTKEYS,
            "hotkeys",
        );

        for bucket in [
            SummaryBucket::Components,
            SummaryBucket::Stores,
            SummaryBucket::Rpc,
            SummaryBucket::Overlay,
            SummaryBucket::Settings,
            SummaryBucket::Hotkeys,
            SummaryBucket::PlatformCapabilities,
            SummaryBucket::ModalPopover,
            SummaryBucket::FailureStates,
        ] {
            if counts.get(&bucket).copied().unwrap_or_default() == 0 {
                issues.push(format!("expected nonzero {} count", bucket.label()));
            }
        }

        if issues.is_empty() {
            Ok(ValidationSummary { counts })
        } else {
            Err(ValidationError::new(issues))
        }
    }
}

fn require_named_rows(
    issues: &mut Vec<String>,
    names_by_kind: &BTreeMap<&str, BTreeSet<&str>>,
    kinds: &[&str],
    required: &[&str],
    label: &str,
) {
    let mut available = BTreeSet::new();
    for kind in kinds {
        if let Some(names) = names_by_kind.get(kind) {
            available.extend(names.iter().copied());
        }
    }

    let missing: Vec<_> = required
        .iter()
        .copied()
        .filter(|name| !available.contains(name))
        .collect();

    if !missing.is_empty() {
        issues.push(format!("missing {label}: {}", missing.join(", ")));
    }
}

fn bucket_for_kind(kind: &str) -> Option<SummaryBucket> {
    match kind {
        "component" | "page" => Some(SummaryBucket::Components),
        "store" | "composable" | "helper" => Some(SummaryBucket::Stores),
        "rpc_request" | "rpc_message" | "backend_message" | "desktop_message" => {
            Some(SummaryBucket::Rpc)
        }
        "overlay_query_param" | "overlay_event" => Some(SummaryBucket::Overlay),
        "settings_key" => Some(SummaryBucket::Settings),
        "hotkey" => Some(SummaryBucket::Hotkeys),
        "platform_capability" => Some(SummaryBucket::PlatformCapabilities),
        "modal" | "dialog" | "popover" | "tooltip" | "context_menu" => {
            Some(SummaryBucket::ModalPopover)
        }
        "failure_state" => Some(SummaryBucket::FailureStates),
        _ => None,
    }
}

pub const REQUIRED_COMPONENTS: &[&str] = &[
    "App.vue",
    "ChatList.vue",
    "ChatInput.vue",
    "ChatMessage.vue",
    "UserCardDialog.vue",
    "EventsFeed.vue",
    "PlatformsPanel.vue",
    "SettingsPanel.vue",
    "WatchedChannelsView.vue",
    "SplitNode.vue",
    "PanelNode.vue",
    "ChannelTabBar.vue",
    "AddChannelModal.vue",
    "TabSelectorModal.vue",
    "AutocompletePopup.vue",
    "ChatAppearancePopover.vue",
    "Tooltip.vue",
    "EmotePicker.vue",
    "overlay/App.vue",
];

pub const REQUIRED_RPC_REQUESTS: &[&str] = &[
    "getAccounts",
    "getSettings",
    "saveSettings",
    "getUserAliases",
    "setUserAlias",
    "removeUserAlias",
    "getChannels",
    "authStart",
    "authLogout",
    "joinChannel",
    "leaveChannel",
    "sendMessage",
    "getStreamStatus",
    "updateStream",
    "searchCategories",
    "getChannelsStatus",
    "getRecentMessages",
    "getUserChatHistory",
    "getUserCardMetadata",
    "getStatuses",
    "getUsernameColor",
    "getChannelEmotes",
    "checkForUpdate",
    "downloadUpdate",
    "applyUpdate",
    "skipUpdate",
    "getWatchedChannels",
    "addWatchedChannel",
    "removeWatchedChannel",
    "getWatchedChannelMessages",
    "sendWatchedChannelMessage",
    "getWatchedChannelStatuses",
    "openExternalUrl",
    "getTabChannelIds",
    "setTabChannelIds",
    "getWatchedChannelsLayout",
    "setWatchedChannelsLayout",
    "removePanel",
    "assignChannelToPanel",
    "splitPanel",
];

pub const REQUIRED_RPC_MESSAGES: &[&str] = &[
    "chat_message",
    "chat_event",
    "platform_status",
    "auth_url",
    "auth_success",
    "auth_error",
    "update_status",
    "watched_channel_message",
    "watched_channel_status",
    "channel_emotes_set",
    "channel_emote_added",
    "channel_emote_removed",
    "channel_emote_updated",
];

pub const REQUIRED_BACKEND_MESSAGES: &[&str] = &[
    "auth_url",
    "auth_success",
    "auth_error",
    "error",
    "pong",
    "chat_message",
    "chat_event",
    "platform_status",
    "seventv_emote_set",
    "seventv_emote_added",
    "seventv_emote_removed",
    "seventv_emote_updated",
    "seventv_system_message",
];

pub const REQUIRED_DESKTOP_MESSAGES: &[&str] = &[
    "ping",
    "auth_start",
    "auth_start_twitch",
    "auth_logout",
    "send_message",
    "channel_join",
    "channel_leave",
    "seventv_subscribe",
    "seventv_unsubscribe",
    "seventv_resubscribe",
];

pub const REQUIRED_OVERLAY_QUERY_PARAMS: &[&str] = &[
    "bg",
    "textColor",
    "color",
    "fontSize",
    "fontFamily",
    "maxMessages",
    "timeout",
    "showPlatform",
    "showAvatar",
    "showBadges",
    "animation",
    "position",
    "platforms",
    "port",
];

pub const REQUIRED_OVERLAY_EVENTS: &[&str] = &["chat_message", "chat_event", "clear"];

pub const REQUIRED_HOTKEYS: &[&str] = &[
    "hotkeys.newTab",
    "hotkeys.nextTab",
    "hotkeys.prevTab",
    "hotkeys.tabSelector",
    "ctrl+k.tabSelectorOverride",
];

#[cfg(test)]
mod tests {
    use super::ParityMatrix;
    use std::path::Path;

    #[test]
    fn desktop_parity_matrix_validates() {
        let matrix = ParityMatrix::from_path(Path::new("parity/desktop-parity-matrix.json"))
            .expect("matrix should parse");

        let summary = matrix.validate().expect("matrix should validate");
        assert!(summary.counts.values().all(|count| *count > 0));
    }

    #[test]
    fn missing_chat_input_fixture_fails_validation() {
        let matrix = ParityMatrix::from_path(Path::new("parity/fixtures/missing-chat-input.json"))
            .expect("fixture should parse");

        let error = matrix
            .validate()
            .expect_err("fixture should fail validation");
        let text = error.to_string();
        assert!(text.contains("ChatInput.vue"));
    }
}
