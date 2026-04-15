use crate::error::AppError;
use crate::state::AppState;
use crate::types::{
    LayoutNode, PanelContent, PanelNode, SplitDirection, SplitNode, SplitPanelResponse,
    WatchedChannelsLayout,
};

fn get_setting_json(db: &rusqlite::Connection, key: &str) -> Result<Option<String>, AppError> {
    let mut stmt = db.prepare("SELECT value FROM settings WHERE key = ?")?;
    let mut rows = stmt.query([key])?;
    Ok(rows.next()?.map(|r| r.get(0)).transpose()?)
}

fn set_setting_json(db: &rusqlite::Connection, key: &str, value: &str) -> Result<(), AppError> {
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_tab_channel_ids(
    state: tauri::State<'_, AppState>,
) -> Result<Option<Vec<String>>, AppError> {
    let json = {
        let db = state.db()?;
        get_setting_json(&db, "tab_channel_ids")?
    };
    match json {
        None => Ok(None),
        Some(s) => {
            let ids: Vec<String> = serde_json::from_str(&s).map_err(AppError::Serde)?;
            Ok(Some(ids))
        }
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn set_tab_channel_ids(
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), AppError> {
    let json = serde_json::to_string(&ids).map_err(AppError::Serde)?;
    {
        let db = state.db()?;
        set_setting_json(&db, "tab_channel_ids", &json)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database or serialisation failure.
pub fn get_watched_channels_layout(
    state: tauri::State<'_, AppState>,
    tab_id: String,
) -> Result<Option<WatchedChannelsLayout>, AppError> {
    let key = format!("layout_tab_{tab_id}");
    let json = {
        let db = state.db()?;
        get_setting_json(&db, &key)?
    };
    match json {
        None => Ok(None),
        Some(s) => {
            let layout: WatchedChannelsLayout =
                serde_json::from_str(&s).map_err(AppError::Serde)?;
            Ok(Some(layout))
        }
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database or serialisation failure.
pub fn set_watched_channels_layout(
    state: tauri::State<'_, AppState>,
    tab_id: String,
    layout: WatchedChannelsLayout,
) -> Result<(), AppError> {
    let key = format!("layout_tab_{tab_id}");
    let json = serde_json::to_string(&layout).map_err(AppError::Serde)?;
    {
        let db = state.db()?;
        set_setting_json(&db, &key, &json)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database or serialisation failure.
pub fn remove_panel(
    state: tauri::State<'_, AppState>,
    tab_id: String,
    panel_id: String,
) -> Result<(), AppError> {
    let key = format!("layout_tab_{tab_id}");
    {
        let db = state.db()?;
        let Some(json) = get_setting_json(&db, &key)? else {
            return Ok(());
        };
        let mut layout: WatchedChannelsLayout =
            serde_json::from_str(&json).map_err(AppError::Serde)?;
        layout.root = remove_node(layout.root, &panel_id);
        let updated = serde_json::to_string(&layout).map_err(AppError::Serde)?;
        set_setting_json(&db, &key, &updated)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database or serialisation failure.
pub fn assign_channel_to_panel(
    state: tauri::State<'_, AppState>,
    tab_id: String,
    panel_id: String,
    channel_id: Option<String>,
) -> Result<(), AppError> {
    let key = format!("layout_tab_{tab_id}");
    {
        let db = state.db()?;
        let Some(json) = get_setting_json(&db, &key)? else {
            return Ok(());
        };
        let mut layout: WatchedChannelsLayout =
            serde_json::from_str(&json).map_err(AppError::Serde)?;
        layout.root = assign_channel(layout.root, &panel_id, channel_id.as_deref());
        let updated = serde_json::to_string(&layout).map_err(AppError::Serde)?;
        set_setting_json(&db, &key, &updated)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database or serialisation failure, or if the panel is not found.
pub fn split_panel(
    state: tauri::State<'_, AppState>,
    tab_id: String,
    panel_id: String,
    direction: SplitDirection,
) -> Result<SplitPanelResponse, AppError> {
    let key = format!("layout_tab_{tab_id}");
    {
        let db = state.db()?;
        let Some(json) = get_setting_json(&db, &key)? else {
            return Err(AppError::NotFound(format!("layout for tab {tab_id}")));
        };
        let mut layout: WatchedChannelsLayout =
            serde_json::from_str(&json).map_err(AppError::Serde)?;

        let new_panel_id = uuid::Uuid::new_v4().to_string();
        let split_node_id = uuid::Uuid::new_v4().to_string();

        let new_panel = LayoutNode::Panel(PanelNode {
            node_type: "panel".into(),
            id: new_panel_id,
            content: PanelContent::Empty,
            flex: 1.0,
        });

        let (updated_root, original_node, new_node) = split_node_in_tree(
            layout.root,
            &panel_id,
            &split_node_id,
            new_panel,
            &direction,
        )
        .ok_or_else(|| AppError::NotFound(format!("panel {panel_id}")))?;

        layout.root = updated_root;
        let updated = serde_json::to_string(&layout).map_err(AppError::Serde)?;
        set_setting_json(&db, &key, &updated)?;

        Ok(SplitPanelResponse {
            original: original_node,
            new_panel: new_node,
        })
    }
}

fn remove_node(node: LayoutNode, target_id: &str) -> LayoutNode {
    match node {
        LayoutNode::Panel(ref p) if p.id == target_id => LayoutNode::Panel(PanelNode {
            node_type: "panel".into(),
            id: p.id.clone(),
            content: PanelContent::Empty,
            flex: p.flex,
        }),
        LayoutNode::Split(mut s) => {
            s.children = s
                .children
                .into_iter()
                .map(|c| remove_node(c, target_id))
                .collect();
            LayoutNode::Split(s)
        }
        other @ LayoutNode::Panel(_) => other,
    }
}

fn assign_channel(node: LayoutNode, panel_id: &str, channel_id: Option<&str>) -> LayoutNode {
    match node {
        LayoutNode::Panel(mut p) if p.id == panel_id => {
            p.content = channel_id.map_or(PanelContent::Empty, |cid| PanelContent::Watched {
                channel_id: cid.to_owned(),
            });
            LayoutNode::Panel(p)
        }
        LayoutNode::Split(mut s) => {
            s.children = s
                .children
                .into_iter()
                .map(|c| assign_channel(c, panel_id, channel_id))
                .collect();
            LayoutNode::Split(s)
        }
        other @ LayoutNode::Panel(_) => other,
    }
}

fn split_node_in_tree(
    node: LayoutNode,
    target_id: &str,
    split_id: &str,
    new_panel: LayoutNode,
    direction: &SplitDirection,
) -> Option<(LayoutNode, LayoutNode, LayoutNode)> {
    match node {
        LayoutNode::Panel(ref p) if p.id == target_id => {
            let original = node.clone();
            let new = new_panel.clone();
            let split = LayoutNode::Split(SplitNode {
                node_type: "split".into(),
                id: split_id.to_owned(),
                direction: direction.clone(),
                children: vec![node, new_panel],
                flex: 1.0,
                min_size: None,
            });
            Some((split, original, new))
        }
        LayoutNode::Split(mut s) => {
            for (i, child) in s.children.iter().enumerate() {
                if matches_id(child, target_id) {
                    let original = child.clone();
                    let new = new_panel.clone();
                    let split_child = LayoutNode::Split(SplitNode {
                        node_type: "split".into(),
                        id: split_id.to_owned(),
                        direction: direction.clone(),
                        children: vec![child.clone(), new_panel],
                        flex: 1.0,
                        min_size: None,
                    });
                    s.children[i] = split_child;
                    return Some((LayoutNode::Split(s), original, new));
                }
            }
            None
        }
        LayoutNode::Panel(_) => None,
    }
}

fn matches_id(node: &LayoutNode, id: &str) -> bool {
    match node {
        LayoutNode::Panel(p) => p.id == id,
        LayoutNode::Split(s) => s.id == id,
    }
}
