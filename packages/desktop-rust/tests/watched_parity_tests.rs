use twirchat_desktop_rust::protocol::types::{
    LayoutNode, PanelContent, SplitDirection, WatchedChannelsLayout, WatchedChannelsLayoutMeta,
};

#[test]
fn watched_tab_layout_parity_contract() {
    let layout = WatchedChannelsLayout {
        version: 2,
        meta: Some(WatchedChannelsLayoutMeta {
            created_at: 0,
            updated_at: 0,
            migrated_from: None,
        }),
        root: LayoutNode::Panel {
            id: "p1".into(),
            content: PanelContent::Watched {
                channel_id: "c1".into(),
            },
            flex: 100.0,
        },
    };
    assert_eq!(layout.version, 2);
}

#[test]
fn watched_drag_drop_contract() {
    let mut layout = WatchedChannelsLayout {
        version: 2,
        meta: Some(WatchedChannelsLayoutMeta {
            created_at: 0,
            updated_at: 0,
            migrated_from: None,
        }),
        root: LayoutNode::Split {
            id: "s1".into(),
            direction: SplitDirection::Horizontal,
            flex: 100.0,
            children: vec![
                LayoutNode::Panel {
                    id: "p1".into(),
                    content: PanelContent::Watched {
                        channel_id: "c1".into(),
                    },
                    flex: 50.0,
                },
                LayoutNode::Panel {
                    id: "p2".into(),
                    content: PanelContent::Watched {
                        channel_id: "c2".into(),
                    },
                    flex: 50.0,
                },
            ],
            min_size: None,
        },
    };
    if let LayoutNode::Split { children, .. } = &mut layout.root {
        children.swap(0, 1);
    }
    assert_eq!(layout.version, 2);
}
