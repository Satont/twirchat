use gpui::*;

pub struct UserCard {
    username: SharedString,
    alias: Option<SharedString>,
    history_expanded: bool,
}

impl UserCard {
    pub fn new(username: impl Into<SharedString>) -> Self {
        Self {
            username: username.into(),
            alias: None,
            history_expanded: false,
        }
    }

    pub fn with_alias(mut self, alias: impl Into<SharedString>) -> Self {
        self.alias = Some(alias.into());
        self
    }

    pub fn toggle_history(&mut self) {
        self.history_expanded = !self.history_expanded;
    }
}

impl Render for UserCard {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let mut container = div().flex().flex_col().child(self.username.clone());
        if let Some(alias) = &self.alias {
            container = container.child(alias.clone());
        }
        if self.history_expanded {
            container = container.child("History Panel (Local)");
        }
        container
    }
}
