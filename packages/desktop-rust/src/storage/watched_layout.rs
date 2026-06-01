use crate::protocol::types::{
    LayoutNode, PanelContent, WatchedChannelsLayout, WatchedChannelsLayoutMeta,
};
use crate::storage::db::Connection;
use crate::storage::settings::SettingsStore;
use crate::storage::{StorageError, StorageResult, now_millis};
use std::collections::BTreeSet;

pub const MAX_PANELS: usize = 8;

pub struct WatchedLayoutStore<'a> {
    conn: &'a Connection,
}

impl<'a> WatchedLayoutStore<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get(&self, tab_id: &str) -> StorageResult<WatchedChannelsLayout> {
        let settings = SettingsStore::new(self.conn);
        match settings.get_json(&layout_key(tab_id))? {
            Some(value) => match serde_json::from_value::<WatchedChannelsLayout>(value) {
                Ok(mut layout) => {
                    sanitize_tab_layout(&mut layout, tab_id);
                    Ok(layout)
                }
                Err(_) => {
                    let layout = create_default_tab_layout(tab_id);
                    self.set(tab_id, &layout)?;
                    Ok(layout)
                }
            },
            None => {
                let layout = create_default_tab_layout(tab_id);
                self.set(tab_id, &layout)?;
                Ok(layout)
            }
        }
    }

    pub fn set(&self, tab_id: &str, layout: &WatchedChannelsLayout) -> StorageResult<()> {
        validate_layout(layout)?;
        let now = now_millis();
        let mut layout = layout.clone();
        let created_at = layout.meta.as_ref().map_or(now, |meta| meta.created_at);
        layout.meta = Some(WatchedChannelsLayoutMeta {
            created_at,
            updated_at: now,
            migrated_from: layout.meta.and_then(|meta| meta.migrated_from),
        });
        SettingsStore::new(self.conn).set_json(&layout_key(tab_id), &serde_json::to_value(layout)?)
    }

    pub fn remove(&self, tab_id: &str) -> StorageResult<()> {
        self.conn.execute(
            "DELETE FROM settings WHERE key = ?",
            &[crate::storage::db::Param::Text(&layout_key(tab_id))],
        )?;
        Ok(())
    }

    pub fn can_add_panel(&self, tab_id: &str) -> StorageResult<bool> {
        self.get(tab_id)
            .map(|layout| count_panels(&layout.root) < MAX_PANELS)
    }

    pub fn cleanup_stale_assignments(
        &self,
        tab_id: &str,
        removed_channel_ids: &[String],
    ) -> StorageResult<()> {
        if removed_channel_ids.iter().any(|id| id == tab_id) {
            return self.remove(tab_id);
        }

        let removed = removed_channel_ids.iter().cloned().collect::<BTreeSet<_>>();
        let mut layout = self.get(tab_id)?;
        let changed = clean_stale_node(&mut layout.root, &removed);
        if changed {
            self.set(tab_id, &layout)?;
        }
        Ok(())
    }
}

pub fn create_default_tab_layout(channel_id: &str) -> WatchedChannelsLayout {
    let now = now_millis();
    WatchedChannelsLayout {
        version: 2,
        root: LayoutNode::Panel {
            id: uuid::Uuid::new_v4().to_string(),
            content: PanelContent::Watched {
                channel_id: channel_id.into(),
            },
            flex: 100.0,
        },
        meta: Some(WatchedChannelsLayoutMeta {
            created_at: now,
            updated_at: now,
            migrated_from: None,
        }),
    }
}

pub fn sanitize_tab_layout(layout: &mut WatchedChannelsLayout, tab_id: &str) {
    sanitize_node(&mut layout.root, tab_id);
    if let LayoutNode::Panel { content, .. } = &mut layout.root
        && matches!(content, PanelContent::Empty)
    {
        *content = PanelContent::Watched {
            channel_id: tab_id.into(),
        };
    }
}

pub fn validate_layout(layout: &WatchedChannelsLayout) -> StorageResult<()> {
    let panel_count = count_panels(&layout.root);
    if panel_count > MAX_PANELS {
        Err(StorageError::InvalidLayout(format!(
            "layout exceeds maximum panel limit of {MAX_PANELS}"
        )))
    } else {
        Ok(())
    }
}

fn sanitize_node(node: &mut LayoutNode, tab_id: &str) {
    match node {
        LayoutNode::Panel { content, .. } => {
            if matches!(content, PanelContent::Main) {
                *content = PanelContent::Watched {
                    channel_id: tab_id.into(),
                };
            }
        }
        LayoutNode::Split { children, .. } => {
            for child in children {
                sanitize_node(child, tab_id);
            }
        }
    }
}

fn count_panels(node: &LayoutNode) -> usize {
    match node {
        LayoutNode::Panel { .. } => 1,
        LayoutNode::Split { children, .. } => children.iter().map(count_panels).sum(),
    }
}

fn clean_stale_node(node: &mut LayoutNode, removed_channel_ids: &BTreeSet<String>) -> bool {
    match node {
        LayoutNode::Panel { content, .. } => {
            let PanelContent::Watched { channel_id } = content else {
                return false;
            };
            if removed_channel_ids.contains(channel_id) {
                *content = PanelContent::Empty;
                true
            } else {
                false
            }
        }
        LayoutNode::Split { children, .. } => {
            let mut changed = false;
            for child in children {
                changed |= clean_stale_node(child, removed_channel_ids);
            }
            changed
        }
    }
}

fn layout_key(tab_id: &str) -> String {
    format!("watched_tab_layout_v2_{tab_id}")
}
