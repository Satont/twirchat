use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::error::Error;
use std::fmt;

const APP_NAME: &str = "TwirChat";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CryptoError {
    InvalidBase64,
    InvalidUtf8,
    EmptyKeyMaterial,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBase64 => write!(f, "token is not valid base64"),
            Self::InvalidUtf8 => write!(f, "token payload is not valid UTF-8"),
            Self::EmptyKeyMaterial => write!(f, "token key material is empty"),
        }
    }
}

impl Error for CryptoError {}

pub fn encrypt(plaintext: &str) -> Result<String, CryptoError> {
    let key = key_material()?;
    let encoded: Vec<u8> = plaintext
        .as_bytes()
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ key[index % key.len()])
        .collect();
    Ok(STANDARD.encode(encoded))
}

pub fn decrypt(encoded: &str) -> Result<String, CryptoError> {
    let key = key_material()?;
    let decoded = STANDARD
        .decode(encoded)
        .map_err(|_| CryptoError::InvalidBase64)?;
    let bytes: Vec<u8> = decoded
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ key[index % key.len()])
        .collect();
    String::from_utf8(bytes).map_err(|_| CryptoError::InvalidUtf8)
}

fn key_material() -> Result<Vec<u8>, CryptoError> {
    let hostname = gethostname::gethostname().to_string_lossy().into_owned();
    let key = format!("{APP_NAME}:{hostname}").into_bytes();
    if key.is_empty() {
        Err(CryptoError::EmptyKeyMaterial)
    } else {
        Ok(key)
    }
}

#[cfg(test)]
mod tests {
    use super::{decrypt, encrypt};

    #[test]
    fn token_round_trip_uses_xor_base64_compatibility() -> Result<(), Box<dyn std::error::Error>> {
        let encrypted = encrypt("access-token")?;
        assert_ne!(encrypted, "access-token");
        assert_eq!(decrypt(&encrypted)?, "access-token");
        Ok(())
    }
}
