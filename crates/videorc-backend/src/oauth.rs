use std::collections::HashMap;

use anyhow::Result;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::streaming::StreamPlatform;

const OAUTH_STATE_TTL_MINUTES: i64 = 10;

#[derive(Debug, Default)]
pub struct OAuthSessions {
    pending: Mutex<HashMap<String, PendingOAuthSession>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStartParams {
    pub platform: StreamPlatform,
    pub authorization_url: String,
    pub client_id: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_uri: Option<String>,
    #[serde(default)]
    pub extra_params: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStartResult {
    pub platform: StreamPlatform,
    pub state: String,
    pub auth_url: String,
    pub redirect_uri: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCompleteParams {
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum OAuthCallbackStatus {
    Success,
    Failed,
    Expired,
    UnknownState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCallbackResult {
    pub platform: Option<StreamPlatform>,
    pub state: String,
    pub status: OAuthCallbackStatus,
    pub code_present: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub received_at: String,
}

#[derive(Debug, Clone)]
struct PendingOAuthSession {
    platform: StreamPlatform,
    expires_at: chrono::DateTime<Utc>,
}

impl OAuthSessions {
    pub async fn start(
        &self,
        params: OAuthStartParams,
        backend_port: u16,
    ) -> Result<OAuthStartResult> {
        validate_start_params(&params)?;
        let state = Uuid::new_v4().to_string();
        let redirect_uri = params
            .redirect_uri
            .clone()
            .unwrap_or_else(|| format!("http://127.0.0.1:{backend_port}/oauth/callback"));
        let expires_at = Utc::now() + Duration::minutes(OAUTH_STATE_TTL_MINUTES);
        let auth_url = authorization_url(&params, &state, &redirect_uri);

        self.pending.lock().await.insert(
            state.clone(),
            PendingOAuthSession {
                platform: params.platform,
                expires_at,
            },
        );

        Ok(OAuthStartResult {
            platform: params.platform,
            state,
            auth_url,
            redirect_uri,
            expires_at: expires_at.to_rfc3339(),
        })
    }

    pub async fn complete(&self, params: OAuthCompleteParams) -> OAuthCallbackResult {
        let received_at = Utc::now();
        let Some(pending) = self.pending.lock().await.remove(&params.state) else {
            return OAuthCallbackResult {
                platform: None,
                state: params.state,
                status: OAuthCallbackStatus::UnknownState,
                code_present: params.code.as_ref().is_some_and(|code| !code.is_empty()),
                error: params.error,
                message: Some("OAuth callback state is not recognized.".to_string()),
                received_at: received_at.to_rfc3339(),
            };
        };

        if pending.expires_at < received_at {
            return OAuthCallbackResult {
                platform: Some(pending.platform),
                state: params.state,
                status: OAuthCallbackStatus::Expired,
                code_present: params.code.as_ref().is_some_and(|code| !code.is_empty()),
                error: params.error,
                message: Some(
                    "OAuth callback state expired. Start the connection again.".to_string(),
                ),
                received_at: received_at.to_rfc3339(),
            };
        }

        let code_present = params.code.as_ref().is_some_and(|code| !code.is_empty());
        let failed = params.error.is_some() || !code_present;
        OAuthCallbackResult {
            platform: Some(pending.platform),
            state: params.state,
            status: if failed {
                OAuthCallbackStatus::Failed
            } else {
                OAuthCallbackStatus::Success
            },
            code_present,
            error: params.error,
            message: params.error_description.or_else(|| {
                (!code_present).then(|| "OAuth callback did not include a code.".to_string())
            }),
            received_at: received_at.to_rfc3339(),
        }
    }
}

fn validate_start_params(params: &OAuthStartParams) -> Result<()> {
    if matches!(params.platform, StreamPlatform::Custom) {
        anyhow::bail!("Custom RTMP does not support OAuth.");
    }
    if params.authorization_url.trim().is_empty() {
        anyhow::bail!("OAuth authorization URL is required.");
    }
    if params.client_id.trim().is_empty() {
        anyhow::bail!("OAuth client id is required.");
    }
    Ok(())
}

fn authorization_url(params: &OAuthStartParams, state: &str, redirect_uri: &str) -> String {
    let mut query = vec![
        ("response_type".to_string(), "code".to_string()),
        ("client_id".to_string(), params.client_id.clone()),
        ("redirect_uri".to_string(), redirect_uri.to_string()),
        ("state".to_string(), state.to_string()),
    ];
    let scopes = normalized_scopes(&params.scopes);
    if !scopes.is_empty() {
        query.push(("scope".to_string(), scopes.join(" ")));
    }
    let mut extra = params
        .extra_params
        .iter()
        .filter(|(key, _)| !reserved_oauth_param(key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Vec<_>>();
    extra.sort_by(|left, right| left.0.cmp(&right.0));
    query.extend(extra);

    let separator = if params.authorization_url.contains('?') {
        '&'
    } else {
        '?'
    };
    format!(
        "{}{}{}",
        params.authorization_url.trim(),
        separator,
        query
            .into_iter()
            .map(|(key, value)| format!("{}={}", percent_encode(&key), percent_encode(&value)))
            .collect::<Vec<_>>()
            .join("&")
    )
}

fn reserved_oauth_param(key: &str) -> bool {
    matches!(
        key,
        "response_type" | "client_id" | "redirect_uri" | "state" | "scope"
    )
}

fn normalized_scopes(scopes: &[String]) -> Vec<String> {
    let mut scopes = scopes
        .iter()
        .map(|scope| scope.trim().to_string())
        .filter(|scope| !scope.is_empty())
        .collect::<Vec<_>>();
    scopes.sort();
    scopes.dedup();
    scopes
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    fn start_params() -> OAuthStartParams {
        OAuthStartParams {
            platform: StreamPlatform::Youtube,
            authorization_url: "https://accounts.example.test/oauth".to_string(),
            client_id: "client 123".to_string(),
            scopes: vec![
                "videos.write".to_string(),
                " account.read ".to_string(),
                "videos.write".to_string(),
            ],
            redirect_uri: None,
            extra_params: HashMap::from([
                ("prompt".to_string(), "consent".to_string()),
                ("state".to_string(), "malicious".to_string()),
            ]),
        }
    }

    #[tokio::test]
    async fn start_builds_loopback_auth_url_and_pending_state() {
        let sessions = OAuthSessions::default();
        let result = sessions.start(start_params(), 61234).await.unwrap();

        assert_eq!(result.platform, StreamPlatform::Youtube);
        assert_eq!(result.redirect_uri, "http://127.0.0.1:61234/oauth/callback");
        assert!(
            result
                .auth_url
                .starts_with("https://accounts.example.test/oauth?")
        );
        assert!(result.auth_url.contains("response_type=code"));
        assert!(result.auth_url.contains("client_id=client%20123"));
        assert!(
            result
                .auth_url
                .contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A61234%2Foauth%2Fcallback")
        );
        assert!(result.auth_url.contains(&format!("state={}", result.state)));
        assert!(
            result
                .auth_url
                .contains("scope=account.read%20videos.write")
        );
        assert!(result.auth_url.contains("prompt=consent"));
        assert!(!result.auth_url.contains("malicious"));

        let completed = sessions
            .complete(OAuthCompleteParams {
                state: result.state,
                code: Some("auth-code".to_string()),
                error: None,
                error_description: None,
            })
            .await;
        assert_eq!(completed.status, OAuthCallbackStatus::Success);
        assert_eq!(completed.platform, Some(StreamPlatform::Youtube));
        assert!(completed.code_present);
    }

    #[tokio::test]
    async fn callback_state_can_only_be_used_once() {
        let sessions = OAuthSessions::default();
        let result = sessions.start(start_params(), 61234).await.unwrap();
        let params = OAuthCompleteParams {
            state: result.state,
            code: Some("auth-code".to_string()),
            error: None,
            error_description: None,
        };

        assert_eq!(
            sessions.complete(params.clone()).await.status,
            OAuthCallbackStatus::Success
        );
        assert_eq!(
            sessions.complete(params).await.status,
            OAuthCallbackStatus::UnknownState
        );
    }

    #[tokio::test]
    async fn callback_error_is_reported_as_failed() {
        let sessions = OAuthSessions::default();
        let result = sessions.start(start_params(), 61234).await.unwrap();

        let completed = sessions
            .complete(OAuthCompleteParams {
                state: result.state,
                code: None,
                error: Some("access_denied".to_string()),
                error_description: Some("User cancelled.".to_string()),
            })
            .await;

        assert_eq!(completed.status, OAuthCallbackStatus::Failed);
        assert_eq!(completed.error.as_deref(), Some("access_denied"));
        assert_eq!(completed.message.as_deref(), Some("User cancelled."));
        assert!(!completed.code_present);
    }
}
