//! In-app live chat — capability + scope audit (Slice 1 of the In-App Livestream Comments
//! plan: `2026-06-06 - Videorc In-App Livestream Comments Plan`). Reports, per streaming
//! platform, whether the connected account can read live chat, needs to reconnect for a
//! missing scope, or has no verified native chat path. The `LiveChatCoordinator` and the
//! per-platform connectors arrive in later slices; this is the capability the Studio UI
//! uses to warn the streamer before they go live.

use serde::{Deserialize, Serialize};

use crate::streaming::{PlatformAccount, StreamPlatform, stream_platform_id};

// --- Live chat shared data model (slice 2) ---

/// Runtime connection state of one platform's chat connector.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LiveChatProviderConnectionState {
    Disabled,
    Connecting,
    Connected,
    Reconnecting,
    Waiting,
    Failed,
    Unsupported,
    Ended,
}

/// What kind of chat row a message is — drives special styling for monetized/system events.
// Message-level types are constructed by the platform connectors (slices 4+); this slice
// only defines the shared model + serialization.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LiveChatEventType {
    Message,
    Paid,
    Membership,
    System,
    Deleted,
    Moderation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveChatProviderState {
    pub platform: StreamPlatform,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
    pub state: LiveChatProviderConnectionState,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_connected_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// A rich-text fragment of a message (plain text, emote, mention, …) for faithful rendering.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct LiveChatMessageFragment {
    #[serde(rename = "type")]
    pub fragment_type: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct LiveChatMessage {
    /// Stable app id, `{platform}:{providerMessageId}` — the de-duplication key.
    pub id: String,
    pub provider_message_id: String,
    pub platform: StreamPlatform,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<String>,
    pub author_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_avatar_url: Option<String>,
    #[serde(default)]
    pub author_badges: Vec<String>,
    #[serde(default)]
    pub author_roles: Vec<String>,
    pub published_at: String,
    pub received_at: String,
    pub message_text: String,
    #[serde(default)]
    pub fragments: Vec<LiveChatMessageFragment>,
    pub event_type: LiveChatEventType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount_text: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_provider_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveChatSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub providers: Vec<LiveChatProviderState>,
    pub messages: Vec<LiveChatMessage>,
    pub unread_count: u64,
    pub updated_at: String,
}

/// The stable, de-dup app id for a message: `{platform}:{providerMessageId}`.
#[allow(dead_code)]
pub fn live_chat_message_id(platform: StreamPlatform, provider_message_id: &str) -> String {
    format!("{}:{}", stream_platform_id(platform), provider_message_id)
}

/// Build the initial Live Chat snapshot for setup time (no session running): one provider
/// row per native platform derived from its chat capability, with no messages yet. The
/// LiveChatCoordinator replaces this with live connector state once Go Live starts.
pub fn initial_chat_snapshot(accounts: &[PlatformAccount], updated_at: String) -> LiveChatSnapshot {
    let providers = chat_capabilities(accounts)
        .into_iter()
        .map(provider_state_from_capability)
        .collect();
    LiveChatSnapshot {
        session_id: None,
        providers,
        messages: Vec::new(),
        unread_count: 0,
        updated_at,
    }
}

/// Map a setup-time capability to a provider row. No connector is running yet, so a
/// capable/connected platform is `Disabled` (idle) and platforms with no native path are
/// `Unsupported`; the human-readable readiness lives in `message` + `capabilities`.
fn provider_state_from_capability(capability: ChatCapability) -> LiveChatProviderState {
    let state = match capability.state {
        ChatCapabilityState::Unsupported => LiveChatProviderConnectionState::Unsupported,
        ChatCapabilityState::Available
        | ChatCapabilityState::NeedsReconnect
        | ChatCapabilityState::NotConnected => LiveChatProviderConnectionState::Disabled,
    };
    LiveChatProviderState {
        platform: capability.platform,
        target_id: None,
        account_id: capability.account_id,
        account_label: capability.account_label,
        state,
        message: capability.message,
        last_connected_at: None,
        last_message_at: None,
        last_error: None,
        capabilities: vec![capability_state_tag(capability.state).to_string()],
    }
}

fn capability_state_tag(state: ChatCapabilityState) -> &'static str {
    match state {
        ChatCapabilityState::Available => "available",
        ChatCapabilityState::NeedsReconnect => "needs-reconnect",
        ChatCapabilityState::NotConnected => "not-connected",
        ChatCapabilityState::Unsupported => "unsupported",
    }
}

/// The OAuth scope each platform needs to READ live chat.
///
/// YouTube's `youtube.force-ssl` scope (already requested by Videorc) covers live chat
/// reads, so connected YouTube accounts are ready. Twitch needs `user:read:chat`, which is
/// added to the OAuth config in the Twitch connector slice — until an account is
/// reconnected with it, Twitch chat reports needs-reconnect.
pub const YOUTUBE_CHAT_SCOPE: &str = "https://www.googleapis.com/auth/youtube.force-ssl";
pub const TWITCH_CHAT_SCOPE: &str = "user:read:chat";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ChatCapabilityState {
    /// A connected account holds the scope needed to read chat.
    Available,
    /// Connected, but the granted scopes are missing the chat-read scope — reconnect needed.
    NeedsReconnect,
    /// No connected account for this platform.
    NotConnected,
    /// No verified native chat-read path (X pending API access, Custom RTMP).
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatCapability {
    pub platform: StreamPlatform,
    pub state: ChatCapabilityState,
    /// True only when chat can actually be read right now.
    pub chat_read_available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
    pub message: String,
}

/// Capability to read live chat for one platform, given its connected account (if any).
pub fn chat_capability(
    platform: StreamPlatform,
    account: Option<&PlatformAccount>,
) -> ChatCapability {
    match platform {
        StreamPlatform::Youtube => scope_capability(
            platform,
            account,
            YOUTUBE_CHAT_SCOPE,
            "YouTube live comments are ready.",
            "Reconnect YouTube to enable live comments.",
            "Connect a YouTube account to read live comments.",
        ),
        StreamPlatform::Twitch => scope_capability(
            platform,
            account,
            TWITCH_CHAT_SCOPE,
            "Twitch live comments are ready.",
            "Reconnect Twitch to enable live comments.",
            "Connect a Twitch account to read live comments.",
        ),
        StreamPlatform::X => ChatCapability {
            platform,
            state: ChatCapabilityState::Unsupported,
            chat_read_available: false,
            required_scope: None,
            account_id: account.map(|account| account.account_id.clone()),
            account_label: account.map(|account| account.account_label.clone()),
            message: "X comments require native X API access.".to_string(),
        },
        StreamPlatform::Custom => ChatCapability {
            platform,
            state: ChatCapabilityState::Unsupported,
            chat_read_available: false,
            required_scope: None,
            account_id: None,
            account_label: None,
            message: "Comments are not available for this destination yet.".to_string(),
        },
    }
}

fn scope_capability(
    platform: StreamPlatform,
    account: Option<&PlatformAccount>,
    required_scope: &str,
    available_message: &str,
    reconnect_message: &str,
    not_connected_message: &str,
) -> ChatCapability {
    match account {
        None => ChatCapability {
            platform,
            state: ChatCapabilityState::NotConnected,
            chat_read_available: false,
            required_scope: Some(required_scope.to_string()),
            account_id: None,
            account_label: None,
            message: not_connected_message.to_string(),
        },
        Some(account) => {
            let has_scope = account.scopes.iter().any(|scope| scope == required_scope);
            ChatCapability {
                platform,
                state: if has_scope {
                    ChatCapabilityState::Available
                } else {
                    ChatCapabilityState::NeedsReconnect
                },
                chat_read_available: has_scope,
                required_scope: Some(required_scope.to_string()),
                account_id: Some(account.account_id.clone()),
                account_label: Some(account.account_label.clone()),
                message: if has_scope {
                    available_message
                } else {
                    reconnect_message
                }
                .to_string(),
            }
        }
    }
}

/// Chat capability for every native platform (YouTube, Twitch, X), choosing the first
/// connected account per platform. Custom RTMP has no platform comments and is omitted.
pub fn chat_capabilities(accounts: &[PlatformAccount]) -> Vec<ChatCapability> {
    [
        StreamPlatform::Youtube,
        StreamPlatform::Twitch,
        StreamPlatform::X,
    ]
    .into_iter()
    .map(|platform| chat_capability(platform, accounts.iter().find(|a| a.platform == platform)))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::streaming::PlatformAccountStatus;

    fn account(platform: StreamPlatform, scopes: &[&str]) -> PlatformAccount {
        PlatformAccount {
            id: "acct".to_string(),
            platform,
            account_id: "channel-1".to_string(),
            account_label: "Test Channel".to_string(),
            account_handle: None,
            avatar_url: None,
            scopes: scopes.iter().map(|s| s.to_string()).collect(),
            access_token_present: true,
            refresh_token_present: true,
            stream_key_present: false,
            expires_at: None,
            connected_at: "2026-06-06T00:00:00Z".to_string(),
            updated_at: "2026-06-06T00:00:00Z".to_string(),
            status: PlatformAccountStatus::Connected,
        }
    }

    #[test]
    fn youtube_force_ssl_account_can_read_chat() {
        let account = account(StreamPlatform::Youtube, &[YOUTUBE_CHAT_SCOPE]);
        let capability = chat_capability(StreamPlatform::Youtube, Some(&account));
        assert_eq!(capability.state, ChatCapabilityState::Available);
        assert!(capability.chat_read_available);
    }

    #[test]
    fn twitch_without_user_read_chat_needs_reconnect() {
        // The current real Twitch scope set (no user:read:chat) before the connector slice.
        let account = account(
            StreamPlatform::Twitch,
            &["channel:manage:broadcast", "channel:read:stream_key"],
        );
        let capability = chat_capability(StreamPlatform::Twitch, Some(&account));
        assert_eq!(capability.state, ChatCapabilityState::NeedsReconnect);
        assert!(!capability.chat_read_available);
        assert!(capability.message.contains("Reconnect Twitch"));
    }

    #[test]
    fn twitch_with_user_read_chat_is_available() {
        let account = account(StreamPlatform::Twitch, &[TWITCH_CHAT_SCOPE]);
        assert_eq!(
            chat_capability(StreamPlatform::Twitch, Some(&account)).state,
            ChatCapabilityState::Available
        );
    }

    #[test]
    fn x_is_unsupported_and_custom_has_no_comments() {
        assert_eq!(
            chat_capability(StreamPlatform::X, None).state,
            ChatCapabilityState::Unsupported
        );
        assert_eq!(
            chat_capability(StreamPlatform::Custom, None).state,
            ChatCapabilityState::Unsupported
        );
    }

    #[test]
    fn missing_account_reports_not_connected() {
        assert_eq!(
            chat_capability(StreamPlatform::Youtube, None).state,
            ChatCapabilityState::NotConnected
        );
    }

    #[test]
    fn capabilities_cover_every_native_platform() {
        let accounts = vec![account(StreamPlatform::Youtube, &[YOUTUBE_CHAT_SCOPE])];
        let capabilities = chat_capabilities(&accounts);
        assert_eq!(capabilities.len(), 3);
        assert_eq!(capabilities[0].platform, StreamPlatform::Youtube);
        assert_eq!(capabilities[0].state, ChatCapabilityState::Available);
        assert_eq!(capabilities[1].platform, StreamPlatform::Twitch);
        assert_eq!(capabilities[1].state, ChatCapabilityState::NotConnected);
        assert_eq!(capabilities[2].platform, StreamPlatform::X);
        assert_eq!(capabilities[2].state, ChatCapabilityState::Unsupported);
    }

    #[test]
    fn live_chat_message_round_trips_with_camel_case_and_kebab_event_type() {
        let message = LiveChatMessage {
            id: live_chat_message_id(StreamPlatform::Youtube, "abc123"),
            provider_message_id: "abc123".to_string(),
            platform: StreamPlatform::Youtube,
            target_id: Some("target-1".to_string()),
            session_id: "session-1".to_string(),
            author_id: Some("author-1".to_string()),
            author_name: "Viewer".to_string(),
            author_avatar_url: None,
            author_badges: vec!["moderator".to_string()],
            author_roles: Vec::new(),
            published_at: "2026-06-06T00:00:00Z".to_string(),
            received_at: "2026-06-06T00:00:01Z".to_string(),
            message_text: "hello".to_string(),
            fragments: vec![LiveChatMessageFragment {
                fragment_type: "text".to_string(),
                text: "hello".to_string(),
                image_url: None,
            }],
            event_type: LiveChatEventType::Paid,
            amount_text: Some("$5.00".to_string()),
            is_deleted: false,
            raw_provider_type: Some("superChatEvent".to_string()),
        };
        assert_eq!(message.id, "youtube:abc123");
        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(json["providerMessageId"], "abc123");
        assert_eq!(json["eventType"], "paid");
        assert_eq!(json["platform"], "youtube");
        assert_eq!(json["fragments"][0]["type"], "text");
        let parsed: LiveChatMessage = serde_json::from_value(json).unwrap();
        assert_eq!(parsed, message);
    }

    #[test]
    fn initial_snapshot_maps_capabilities_to_provider_rows() {
        let accounts = vec![account(StreamPlatform::Youtube, &[YOUTUBE_CHAT_SCOPE])];
        let snapshot = initial_chat_snapshot(&accounts, "now".to_string());
        assert_eq!(snapshot.providers.len(), 3);
        assert!(snapshot.messages.is_empty());
        assert_eq!(snapshot.providers[0].platform, StreamPlatform::Youtube);
        assert_eq!(
            snapshot.providers[0].state,
            LiveChatProviderConnectionState::Disabled
        );
        assert_eq!(
            snapshot.providers[0].capabilities,
            vec!["available".to_string()]
        );
        assert_eq!(
            snapshot.providers[2].state,
            LiveChatProviderConnectionState::Unsupported
        );
    }
}
