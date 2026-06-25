//! HTTP client for the Videorc web API (videorc.com) — the desktop account auth
//! bridge.
//!
//! Base URL: release/packaged builds are pinned to `https://videorc.com` so a
//! stray environment variable can never redirect the user's Bearer token at
//! another host. Dev/debug builds may override via `VIDEORC_API_BASE_URL`
//! (e.g. a local `videorc-web` at `http://localhost:3000`).

use anyhow::{bail, Context, Result};
use serde::Deserialize;

const DEFAULT_API_BASE_URL: &str = "https://videorc.com";
const API_BASE_URL_ENV: &str = "VIDEORC_API_BASE_URL";

/// The effective Videorc web API base URL for this build.
pub fn api_base_url() -> String {
    resolve_api_base_url(
        cfg!(debug_assertions),
        std::env::var(API_BASE_URL_ENV).ok().as_deref(),
    )
}

fn resolve_api_base_url(dev_build: bool, env_override: Option<&str>) -> String {
    if !dev_build {
        // Packaged builds are pinned — never honor the override in production.
        return DEFAULT_API_BASE_URL.to_string();
    }
    match env_override.map(str::trim).filter(|value| !value.is_empty()) {
        Some(url) => url.trim_end_matches('/').to_string(),
        None => DEFAULT_API_BASE_URL.to_string(),
    }
}

/// The account identity + durable session token obtained by exchanging a
/// one-time token at `/api/auth/one-time-token/verify`.
pub struct VerifiedSession {
    pub session_token: String,
    pub name: Option<String>,
    pub email: String,
}

/// A thin client over the Videorc web API.
#[derive(Clone)]
pub struct VideorcApiClient {
    base_url: String,
    http: reqwest::Client,
}

impl VideorcApiClient {
    pub fn new() -> Result<Self> {
        Ok(Self {
            base_url: api_base_url(),
            http: reqwest::Client::builder()
                .user_agent(concat!("Videorc-Desktop/", env!("CARGO_PKG_VERSION")))
                .build()
                .context("Could not build the Videorc API HTTP client.")?,
        })
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }

    /// Exchange a single-use one-time token (delivered via the `videorc://`
    /// deep-link) for a durable Better Auth session token + the account identity.
    pub async fn verify_one_time_token(&self, one_time_token: &str) -> Result<VerifiedSession> {
        let response = self
            .http
            .post(self.endpoint("/api/auth/one-time-token/verify"))
            .json(&serde_json::json!({ "token": one_time_token }))
            .send()
            .await
            .context("Could not reach the Videorc sign-in service.")?;

        if !response.status().is_success() {
            bail!("Sign-in token exchange failed ({}).", response.status());
        }

        let body: VerifyResponse = response
            .json()
            .await
            .context("Could not read the sign-in response.")?;

        Ok(VerifiedSession {
            session_token: body.session.token,
            name: body.user.name,
            email: body.user.email,
        })
    }
}

#[derive(Deserialize)]
struct VerifyResponse {
    session: VerifySession,
    user: VerifyUser,
}

#[derive(Deserialize)]
struct VerifySession {
    token: String,
}

#[derive(Deserialize)]
struct VerifyUser {
    #[serde(default)]
    name: Option<String>,
    email: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_builds_pin_the_production_base_url() {
        assert_eq!(
            resolve_api_base_url(false, Some("http://localhost:3000")),
            DEFAULT_API_BASE_URL
        );
        assert_eq!(resolve_api_base_url(false, None), DEFAULT_API_BASE_URL);
    }

    #[test]
    fn dev_builds_honor_the_env_override_and_trim_a_trailing_slash() {
        assert_eq!(
            resolve_api_base_url(true, Some("http://localhost:3000/")),
            "http://localhost:3000"
        );
        assert_eq!(resolve_api_base_url(true, Some("   ")), DEFAULT_API_BASE_URL);
        assert_eq!(resolve_api_base_url(true, None), DEFAULT_API_BASE_URL);
    }

    #[test]
    fn endpoint_joins_paths_without_double_slashes() {
        let client = VideorcApiClient {
            base_url: "https://videorc.com".to_string(),
            http: reqwest::Client::new(),
        };
        assert_eq!(
            client.endpoint("/api/auth/one-time-token/verify"),
            "https://videorc.com/api/auth/one-time-token/verify"
        );
        assert_eq!(
            client.endpoint("api/ai/capabilities"),
            "https://videorc.com/api/ai/capabilities"
        );
    }

    #[test]
    fn verify_response_parses_the_session_token_and_user_identity() {
        let json = r#"{"session":{"token":"sess_abc","expiresAt":"2026-07-01T00:00:00Z"},"user":{"id":"u1","name":"Orc Dev","email":"orc@videorc.com"}}"#;
        let parsed: VerifyResponse = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.session.token, "sess_abc");
        assert_eq!(parsed.user.email, "orc@videorc.com");
        assert_eq!(parsed.user.name.as_deref(), Some("Orc Dev"));
    }
}
