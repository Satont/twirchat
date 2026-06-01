use crate::auth::{AuthError, AuthResult};
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthCallback {
    pub code: String,
    pub state: String,
}

impl AuthCallback {
    pub fn from_url(value: &Url) -> AuthResult<Self> {
        if let Some(error) = value.query_pairs().find_map(|(key, value)| {
            if key == "error" {
                Some(value.into_owned())
            } else {
                None
            }
        }) {
            let description = value.query_pairs().find_map(|(key, value)| {
                if key == "error_description" {
                    Some(value.into_owned())
                } else {
                    None
                }
            });
            return Err(AuthError::ProviderRejected { error, description });
        }

        let code = query_param(value, "code")?;
        let state = query_param(value, "state")?;
        Ok(Self { code, state })
    }
}

fn query_param(value: &Url, name: &'static str) -> AuthResult<String> {
    value
        .query_pairs()
        .find_map(|(key, value)| {
            if key == name {
                Some(value.into_owned())
            } else {
                None
            }
        })
        .filter(|value| !value.is_empty())
        .ok_or(AuthError::MissingCallbackParam { name })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallbackPage {
    pub status: u16,
    pub content_type: &'static str,
    pub body: String,
}

pub fn success_page(platform_name: &str) -> CallbackPage {
    CallbackPage {
        status: 200,
        content_type: "text/html; charset=utf-8",
        body: format!(
            "<!DOCTYPE html><html><head><title>Authentication Successful</title></head><body><h1>Successfully connected to {platform_name}!</h1><p>You can close this window and return to TwirChat.</p></body></html>"
        ),
    }
}

pub fn error_page(message: &str) -> CallbackPage {
    CallbackPage {
        status: 500,
        content_type: "text/html; charset=utf-8",
        body: format!(
            "<!DOCTYPE html><html><head><title>Auth Error</title></head><body><h1>Authentication Error</h1><p>{message}</p><p>You can close this window.</p></body></html>"
        ),
    }
}
