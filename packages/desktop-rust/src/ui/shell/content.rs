use crate::app_state::{AppState, MainSection};
use crate::ui::chat::{ChatPanelProps, ChatScrollUi};
use crate::ui::components::input::Input;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::shell::tabs;
use crate::ui::theme;
use crate::ui::{chat, events, platforms, settings};
use gpui::{AnyElement, Context, Entity, ScrollHandle, Window, div, prelude::*, px};

pub(crate) struct SectionScrollUi<'a> {
    pub chat: ChatScrollUi<'a>,
    pub settings: &'a ScrollHandle,
    pub platforms: &'a ScrollHandle,
}

pub(crate) struct ContentPanelProps<'a> {
    pub state_entity: Entity<AppState>,
    pub composer_input: Entity<Input>,
    pub add_channel_input: Entity<Input>,
    pub composer_text: String,
    pub scroll_ui: SectionScrollUi<'a>,
}

pub(crate) fn panel(
    state: &AppState,
    props: ContentPanelProps<'_>,
    window: &mut Window,
    cx: &mut Context<TwirChatApp>,
) -> AnyElement {
    match state.active_section() {
        MainSection::Chat => div()
            .flex_1()
            .min_w(px(0.0))
            .min_h(px(0.0))
            .relative()
            .flex()
            .flex_col()
            .bg(theme::background())
            .child(
                chat::panel(
                    state,
                    ChatPanelProps {
                        state_entity: props.state_entity.clone(),
                        composer_input: props.composer_input,
                        add_channel_input: props.add_channel_input.clone(),
                        composer_text: props.composer_text,
                        scroll_ui: props.scroll_ui.chat,
                    },
                    window,
                    cx,
                )
                .mt(px(40.0)),
            )
            .child(
                div()
                    .absolute()
                    .top(px(0.0))
                    .left(px(0.0))
                    .right(px(0.0))
                    .child(tabs::bar(
                        state,
                        props.state_entity.clone(),
                        props.add_channel_input,
                    )),
            )
            .into_any_element(),
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
            props.scroll_ui.settings,
            window,
            cx,
        ),
    }
}
