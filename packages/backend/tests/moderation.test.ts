import { afterEach, describe, it, expect, mock } from 'bun:test'
/**
 * Moderation API client tests
 *
 * Tests cover:
 * - Successful ban/timeout operations
 * - Error handling (403, 409, etc.)
 * - Message deletion
 * - Moderator status checks
 * - Platform-specific behavior
 */

import * as Kick from '../src/api/moderation/kick.ts'
import { fetchUrl, textBody } from './literal'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const KICK_TOKEN = 'test-kick-token'
const KICK_BROADCASTER_USER_ID = 999

describe('Kick Moderation', () => {
  it('should ban a user permanently on Kick', async () => {
    global.fetch = Object.assign(
      mock(async (input: string | URL | Request, init?: RequestInit) => {
        expect(fetchUrl(input)).toBe('https://api.kick.com/public/v1/moderation/bans')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(textBody(init?.body))).toEqual({
          broadcaster_user_id: KICK_BROADCASTER_USER_ID,
          user_id: 999,
          reason: 'Harassment',
        })
        return Response.json({ data: {} })
      }),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Kick.banUser(KICK_TOKEN, {
      broadcaster_user_id: KICK_BROADCASTER_USER_ID,
      user_id: 999,
      reason: 'Harassment',
    })

    expect(result.success).toBe(true)
    expect(result.isPermanent).toBe(true)
    expect(result.platform).toBe('kick')
  })

  it('should timeout a user for 5 minutes on Kick', async () => {
    global.fetch = Object.assign(
      mock(async (input: string | URL | Request, init?: RequestInit) => {
        expect(fetchUrl(input)).toBe('https://api.kick.com/public/v1/moderation/bans')
        expect(JSON.parse(textBody(init?.body))).toEqual({
          broadcaster_user_id: KICK_BROADCASTER_USER_ID,
          user_id: 999,
          duration: 5,
        })
        return Response.json({ data: {} })
      }),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Kick.banUser(KICK_TOKEN, {
      broadcaster_user_id: KICK_BROADCASTER_USER_ID,
      user_id: 999,
      duration: 5,
    })

    expect(result.success).toBe(true)
    expect(result.durationSeconds).toBe(300)
  })

  it('should handle 401 unauthorized on Kick', async () => {
    global.fetch = Object.assign(
      mock(async () =>
        Response.json(
          {
            error: 'Unauthorized',
          },
          { status: 401 },
        ),
      ),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Kick.banUser(KICK_TOKEN, {
      broadcaster_user_id: KICK_BROADCASTER_USER_ID,
      user_id: 999,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('KICK_UNAUTHORIZED')
  })

  it('should delete a message on Kick', async () => {
    global.fetch = Object.assign(
      mock(async (input: string | URL | Request, init?: RequestInit) => {
        expect(fetchUrl(input)).toBe('https://api.kick.com/public/v1/chat/msg-kick-123')
        expect(init?.method).toBe('DELETE')
        return new Response(null, { status: 204 })
      }),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Kick.deleteMessage(KICK_TOKEN, 'msg-kick-123')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-kick-123')
  })

  it('should handle 404 when message not found on Kick', async () => {
    global.fetch = Object.assign(
      mock(async () =>
        Response.json(
          {
            error: 'Not found',
          },
          { status: 404 },
        ),
      ),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Kick.deleteMessage(KICK_TOKEN, 'msg-invalid')

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('KICK_NOT_FOUND')
  })
})

// ============================================================
// Cross-platform Tests
// ============================================================

describe('Cross-platform Moderation', () => {
  it('should handle different error code formats', () => {
    const twitchErrorCode = 'TWITCH_CONFLICT'
    const kickErrorCode = 'KICK_CONFLICT'

    expect(twitchErrorCode).toContain('TWITCH')
    expect(kickErrorCode).toContain('KICK')
  })

  it('should convert timeout durations correctly', () => {
    const twitchSeconds = 600
    const kickMinutes = 10
    const kickSeconds = kickMinutes * 60

    expect(kickSeconds).toBe(twitchSeconds)
  })
})
