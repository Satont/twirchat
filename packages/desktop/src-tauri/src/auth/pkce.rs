use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Generates a PKCE code verifier from 64 random bytes using base64url without padding.
#[must_use]
pub fn generate_code_verifier() -> String {
    let mut bytes = [0_u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Generates a PKCE code challenge using SHA-256 and base64url encoding without padding.
#[must_use]
pub fn generate_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_has_expected_length_and_charset() {
        let verifier = generate_code_verifier();

        assert_eq!(verifier.len(), 86);
        assert!(
            verifier.chars().all(
                |character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            )
        );
    }

    #[test]
    fn challenge_matches_rfc7636_example() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

        assert_eq!(generate_code_challenge(verifier), expected);
    }
}
