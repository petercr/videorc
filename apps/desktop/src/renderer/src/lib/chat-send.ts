import type {
  ChatSendResult,
  LiveChatMessage,
  LiveChatProviderState,
  StreamPlatform
} from '@/lib/backend'

// Send-to-all-platforms (Comments upgrade S5): pure decisions for the
// Comments window's input row — where a message will go, the optimistic
// local echo, and how per-platform results read back. Never silently
// partial: failures always surface per platform.

export const CHAT_SEND_MAX_CHARS = 200

/** Platforms a message can actually reach right now: connected providers on
 * platforms with a send path (YouTube, Twitch). X/custom read as unsupported. */
export function sendablePlatforms(providers: LiveChatProviderState[]): StreamPlatform[] {
  return providers
    .filter(
      (provider) =>
        provider.state === 'connected' &&
        (provider.platform === 'youtube' || provider.platform === 'twitch')
    )
    .map((provider) => provider.platform)
}

/** The optimistic "You" row shown in the feed the moment a send fires. It is
 * a synthesized LiveChatMessage so the reader renders it like any other row;
 * platform echoes arriving later read as delivery confirmation. */
export function localEchoMessage(text: string, sequence: number, nowIso: string): LiveChatMessage {
  return {
    id: `local-echo:${sequence}`,
    providerMessageId: `local-echo:${sequence}`,
    platform: 'custom',
    sessionId: 'local',
    authorName: 'You',
    authorBadges: [],
    authorRoles: [],
    publishedAt: nowIso,
    receivedAt: nowIso,
    messageText: text,
    fragments: [],
    eventType: 'message',
    isDeleted: false
  } as unknown as LiveChatMessage
}

export interface ChatSendFailure {
  platform: StreamPlatform
  reason: string
}

/** Failures worth showing. `unsupported` rows are expected (X, custom) and
 * stay quiet — UNLESS nothing could send at all, which must be said. */
export function chatSendFailures(results: ChatSendResult[]): ChatSendFailure[] {
  const failures = results
    .filter((result) => result.status === 'failed')
    .map((result) => ({
      platform: result.platform,
      reason: result.reason ?? 'Send failed.'
    }))
  if (failures.length === 0 && results.length > 0 && !results.some((r) => r.status === 'sent')) {
    return [
      {
        platform: results[0]!.platform,
        reason: 'No connected destination supports sending right now.'
      }
    ]
  }
  return failures
}

export function validateChatDraft(draft: string): string | null {
  const text = draft.trim()
  if (text.length === 0) {
    return null
  }
  return text.length > CHAT_SEND_MAX_CHARS ? null : text
}
