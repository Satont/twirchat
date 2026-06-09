use crate::app_state::{AppState, MainSection};
use crate::ui::chat::{AutocompleteUi, ChatPanelProps, ChatScrollUi};
use crate::ui::components::input::Input;
use crate::ui::components::watched_layout;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::shell::tabs::{self, TabItem};
use crate::ui::theme;
use crate::ui::{chat, events, platforms, settings};
use gpui::{AnyElement, Context, Entity, FocusHandle, ScrollHandle, Window, div, prelude::*, px};
use std::collections::BTreeMap;

pub(crate) struct SectionScrollUi<'a> {
    pub chat: ChatScrollUi<'a>,
    pub settings: &'a ScrollHandle,
    pub platforms: &'a ScrollHandle,
}

pub(crate) struct ContentPanelProps<'a> {
    pub state_entity: Entity<AppState>,
    pub composer_input: Entity<Input>,
    pub font_size_input: Entity<Input>,
    pub system_font_input: Entity<Input>,
    pub add_channel_input: Entity<Input>,
    pub tab_rename_input: Entity<Input>,
    pub watched_composer_inputs: BTreeMap<String, Entity<Input>>,
    pub hotkey_capture_focus: FocusHandle,
    pub composer_text: String,
    pub home_autocomplete: Option<AutocompleteUi>,
    pub watched_autocomplete: BTreeMap<String, AutocompleteUi>,
    pub scroll_ui: SectionScrollUi<'a>,
}

pub(crate) fn tab_items(state: &AppState) -> Vec<TabItem> {
    tabs::items(state)
}

pub(crate) fn panel(
    state: &AppState,
    props: ContentPanelProps<'_>,
    window: &mut Window,
    cx: &mut Context<TwirChatApp>,
) -> AnyElement {
    match state.active_section() {
        MainSection::Chat => {
            let is_home_tab = state.active_channel_tab_id() == "home";

            div()
                .flex_1()
                .min_w(px(0.0))
                .min_h(px(0.0))
                .relative()
                .flex()
                .flex_col()
                .bg(theme::background())
                .child(if is_home_tab {
                    chat::panel(
                        state,
                        ChatPanelProps {
                            state_entity: props.state_entity.clone(),
                            composer_input: props.composer_input,
                            font_size_input: props.font_size_input.clone(),
                            composer_text: props.composer_text,
                            autocomplete: props.home_autocomplete,
                            scroll_ui: props.scroll_ui.chat,
                        },
                        window,
                        cx,
                    )
                    .mt(px(40.0))
                    .into_any_element()
                } else {
                    watched_layout::tab_panel(
                        state,
                        props.state_entity.clone(),
                        props.font_size_input.clone(),
                        &props.watched_composer_inputs,
                        &props.watched_autocomplete,
                        window,
                        cx,
                    )
                    .mt(px(40.0))
                    .into_any_element()
                })
                .child(
                    div()
                        .absolute()
                        .top(px(0.0))
                        .left(px(0.0))
                        .right(px(0.0))
                        .child(tabs::bar(
                            state,
                            props.state_entity.clone(),
                            props.add_channel_input.clone(),
                            props.tab_rename_input.clone(),
                        )),
                )
                .when(state.tab_add_menu_open, |el| {
                    el.child(chat::add_channel_modal(
                        state,
                        props.state_entity.clone(),
                        props.add_channel_input,
                    ))
                })
                .into_any_element()
        }
        MainSection::Events => events::panel(state).into_any_element(),
        MainSection::Platforms => platforms::panel(
            &state.platforms_panel,
            props.state_entity.clone(),
            props.scroll_ui.platforms,
            window,
            cx,
        ),
        MainSection::Settings => settings::panel(
            state,
            props.state_entity.clone(),
            props.system_font_input,
            &props.hotkey_capture_focus,
            props.scroll_ui.settings,
            window,
            cx,
        ),
    }
}
