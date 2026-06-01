pub mod colors;
pub mod fonts;
pub mod metrics;

pub use colors::*;
pub use fonts::*;
pub use metrics::*;

pub struct Theme {
    pub colors: ThemeColors,
    pub platform: PlatformColors,
}

impl Theme {
    pub fn dark() -> Self {
        Self {
            colors: ThemeColors::dark(),
            platform: PlatformColors::new(),
        }
    }

    pub fn light() -> Self {
        Self {
            colors: ThemeColors::light(),
            platform: PlatformColors::new(),
        }
    }
}
