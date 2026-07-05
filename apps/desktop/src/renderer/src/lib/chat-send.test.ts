import { describe, expect, it } from 'vitest'

import type { ChatSendResult, LiveChatProviderState } from '@/lib/backend'
import {
  CHAT_SEND_MAX_CHARS,
  chatSendFailures,
  localEchoMessage,
  sendablePlatforms,
  validateChatDraft
} from './chat-send'

const provider = (
  platform: LiveChatProviderState['platform'],
  state: LiveChatProviderState['state']
): LiveChatProviderState => ({ platform, state }) as LiveChatProviderState

describe('sendablePlatforms', () => {
  it('keeps connected YouTube/Twitch only', () => {
    expect(
      sendablePlatforms([
        provider('youtube', 'connected'),
        provider('twitch', 'connected'),
        provider('x', 'connected'),
        provider('youtube', 'failed')
      ])
    ).toEqual(['youtube', 'twitch'])
    expect(sendablePlatforms([provider('twitch', 'connecting')])).toEqual([])
  })
})

describe('localEchoMessage', () => {
  it('synthesizes a renderable You row with unique ids', () => {
    const echo = localEchoMessage('hi chat', 3, '2026-07-05T12:00:00Z')
    expect(echo.authorName).toBe('You')
    expect(echo.messageText).toBe('hi chat')
    expect(echo.id).not.toBe(localEchoMessage('hi chat', 4, '2026-07-05T12:00:00Z').id)
    expect(echo.eventType).toBe('message')
  })
})

describe('chatSendFailures', () => {
  const result = (
    platform: ChatSendResult['platform'],
    status: ChatSendResult['status'],
    reason?: string
  ): ChatSendResult => ({ platform, status, reason }) as ChatSendResult

  it('surfaces failed platforms with their reasons', () => {
    const failures = chatSendFailures([
      result('youtube', 'sent'),
      result('twitch', 'failed', 'Twitch rejected the send — reconnect Twitch.')
    ])
    expect(failures).toEqual([
      { platform: 'twitch', reason: 'Twitch rejected the send — reconnect Twitch.' }
    ])
  })

  it('stays quiet about expected unsupported rows when something sent', () => {
    expect(
      chatSendFailures([result('youtube', 'sent'), result('x', 'unsupported', 'No API.')])
    ).toEqual([])
  })

  it('says so when NOTHING could send', () => {
    const failures = chatSendFailures([result('x', 'unsupported', 'No API.')])
    expect(failures).toHaveLength(1)
    expect(failures[0]!.reason).toMatch(/No connected destination/)
  })
})

describe('validateChatDraft', () => {
  it('trims, rejects empty and over-long drafts', () => {
    expect(validateChatDraft('  hi  ')).toBe('hi')
    expect(validateChatDraft('   ')).toBeNull()
    expect(validateChatDraft('x'.repeat(CHAT_SEND_MAX_CHARS + 1))).toBeNull()
    expect(validateChatDraft('x'.repeat(CHAT_SEND_MAX_CHARS))).toHaveLength(CHAT_SEND_MAX_CHARS)
  })
})
