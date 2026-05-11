pub enum FontFamily {
    Inter,
    Manrope,
    System,
}

impl FontFamily {
    pub fn as_str(&self) -> &'static str {
        match self {
            FontFamily::Inter => "Inter",
            FontFamily::Manrope => "Manrope",
            FontFamily::System => "System",
        }
    }
}
