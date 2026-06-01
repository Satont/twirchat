use serde_json::Value;
use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub enum ProtocolDecodeError {
    InvalidJson(serde_json::Error),
    MissingDiscriminant {
        field: &'static str,
    },
    InvalidDiscriminantType {
        field: &'static str,
    },
    UnknownDiscriminant {
        family: &'static str,
        field: &'static str,
        value: String,
    },
    Decode {
        family: &'static str,
        source: serde_json::Error,
    },
}

impl ProtocolDecodeError {
    pub fn unknown_discriminant(
        family: &'static str,
        field: &'static str,
        value: impl Into<String>,
    ) -> Self {
        Self::UnknownDiscriminant {
            family,
            field,
            value: value.into(),
        }
    }

    pub fn discriminant_value(&self) -> Option<&str> {
        match self {
            Self::UnknownDiscriminant { value, .. } => Some(value.as_str()),
            _ => None,
        }
    }
}

impl fmt::Display for ProtocolDecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidJson(source) => write!(f, "invalid protocol JSON: {source}"),
            Self::MissingDiscriminant { field } => {
                write!(f, "protocol message is missing discriminant field {field}")
            }
            Self::InvalidDiscriminantType { field } => {
                write!(f, "protocol discriminant field {field} must be a string")
            }
            Self::UnknownDiscriminant {
                family,
                field,
                value,
            } => write!(f, "unknown {family} discriminant {field}={value}"),
            Self::Decode { family, source } => {
                write!(f, "failed to decode {family} protocol payload: {source}")
            }
        }
    }
}

impl Error for ProtocolDecodeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidJson(source) => Some(source),
            Self::Decode { source, .. } => Some(source),
            _ => None,
        }
    }
}

pub(crate) fn decode_tagged<T>(
    text: &str,
    family: &'static str,
    tag_field: &'static str,
    known_tags: &[&'static str],
) -> Result<T, ProtocolDecodeError>
where
    T: serde::de::DeserializeOwned,
{
    let value: Value = serde_json::from_str(text).map_err(ProtocolDecodeError::InvalidJson)?;
    let tag = value
        .get(tag_field)
        .ok_or(ProtocolDecodeError::MissingDiscriminant { field: tag_field })?
        .as_str()
        .ok_or(ProtocolDecodeError::InvalidDiscriminantType { field: tag_field })?;

    if !known_tags.contains(&tag) {
        return Err(ProtocolDecodeError::unknown_discriminant(
            family, tag_field, tag,
        ));
    }

    serde_json::from_value(value).map_err(|source| ProtocolDecodeError::Decode { family, source })
}
