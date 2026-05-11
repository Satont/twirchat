pub struct Metrics {
    pub radius_sm: f32,
    pub radius_md: f32,
    pub radius_lg: f32,
    pub spacing_1: f32,
    pub spacing_2: f32,
    pub spacing_3: f32,
    pub spacing_4: f32,
}

impl Metrics {
    pub fn new() -> Self {
        Self {
            radius_sm: 4.0,
            radius_md: 8.0,
            radius_lg: 12.0,
            spacing_1: 4.0,
            spacing_2: 8.0,
            spacing_3: 12.0,
            spacing_4: 16.0,
        }
    }
}
impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}

pub struct TextSizes {
    pub xs: f32, // 10px or 11px
    pub sm: f32, // 12px or 13px
    pub base: f32,
    pub lg: f32,
}

impl TextSizes {
    pub fn new() -> Self {
        Self {
            xs: 11.0,
            sm: 13.0,
            base: 14.0, // default GPUI text size
            lg: 16.0,
        }
    }
}

impl Default for TextSizes {
    fn default() -> Self {
        Self::new()
    }
}

pub struct Animations {
    pub popover_fade_in: std::time::Duration,
}

impl Animations {
    pub fn new() -> Self {
        Self {
            popover_fade_in: std::time::Duration::from_millis(120),
        }
    }
}

impl Default for Animations {
    fn default() -> Self {
        Self::new()
    }
}
