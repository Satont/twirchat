use aes_gcm::{
    Aes256Gcm, Key, Nonce,
    aead::{Aead, KeyInit},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use hostname::get as get_hostname;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

use crate::AppError;

const APP_NAME: &str = "TwirChat";
const PBKDF2_ITERATIONS: u32 = 100_000;

fn key_material() -> String {
    let host = get_hostname()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_default();
    format!("{APP_NAME}:{host}")
}

/// Encrypts `plaintext` using AES-256-GCM with a PBKDF2-derived key.
///
/// Output format: `base64( salt[16] || iv[12] || ciphertext )`.
///
/// # Errors
///
/// Returns [`AppError::Auth`] if encryption fails.
pub fn aes_encrypt(plaintext: &str) -> Result<String, AppError> {
    let material = key_material();
    let mut salt = [0u8; 16];
    let mut iv_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut iv_bytes);

    let mut key_bytes = [0u8; 32];
    pbkdf2_hmac::<Sha256>(
        material.as_bytes(),
        &salt,
        PBKDF2_ITERATIONS,
        &mut key_bytes,
    );

    let key: &Key<Aes256Gcm> = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&iv_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|error| AppError::Auth(format!("aes-gcm encrypt: {error}")))?;

    let mut result = Vec::with_capacity(16 + 12 + ciphertext.len());
    result.extend_from_slice(&salt);
    result.extend_from_slice(&iv_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(B64.encode(result))
}

/// Decrypts an AES-256-GCM ciphertext produced by [`aes_encrypt`] or `crypto.ts`.
///
/// # Errors
///
/// Returns [`AppError::Auth`] if decryption fails.
pub fn aes_decrypt(encoded: &str) -> Result<String, AppError> {
    let bytes = B64
        .decode(encoded)
        .map_err(|error| AppError::Auth(format!("base64 decode: {error}")))?;
    if bytes.len() < 28 {
        return Err(AppError::Auth("ciphertext too short".to_owned()));
    }
    let salt = &bytes[..16];
    let iv_bytes = &bytes[16..28];
    let ciphertext = &bytes[28..];

    let material = key_material();
    let mut key_bytes = [0u8; 32];
    pbkdf2_hmac::<Sha256>(material.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key_bytes);

    let key: &Key<Aes256Gcm> = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(iv_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|error| AppError::Auth(format!("aes-gcm decrypt: {error}")))?;

    String::from_utf8(plaintext).map_err(|error| AppError::Auth(format!("utf8: {error}")))
}

/// Returns `true` if `encoded` looks like an AES-GCM blob.
///
/// AES blobs must be at least 60 base64 chars (salt[16]+iv[12]+ciphertext[≥16] = 44 bytes).
#[must_use]
pub fn is_aes_encrypted(encoded: &str) -> bool {
    if encoded.len() < 60 {
        return false;
    }

    B64.decode(encoded)
        .map(|bytes| bytes.len() >= 44)
        .unwrap_or(false)
}
