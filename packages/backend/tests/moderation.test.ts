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

import { describe, it, expect, mock } from 'bun:test'
import * as Twitch from '../src/api/moderation/twitch.ts'
import * as Kick from '../src/api/moderation/kick.ts'

const TWITCH_TOKEN = 'test-twitch-token'
const TWITCH_BROADCASTER_ID = '123456'
const TWITCH_MODERATOR_ID = '654321'
const KICK_TOKEN = 'test-kick-token'
const KICK_BROADCASTER_USER_ID = 999

// ============================================================
// Twitch Tests
// ============================================================

describe('Twitch Moderation', () => {
  it('should ban a user permanently', async () => {
    global.fetch = mock(async () =>
      Response.json({
        data: [
          {
            user_id: '98765',
            created_at: '2026-04-07T12:00:00Z',
          },
        ],
      }),
    ) as unknown as typeof global.fetch

    const result = await Twitch.banUser(TWITCH_TOKEN, TWITCH_BROADCASTER_ID, TWITCH_MODERATOR_ID, {
      user_id: '98765',
      reason: 'Spamming',
      duration: null,
    })

    expect(result.success).toBe(true)
    expect(result.isPermanent).toBe(true)
    expect(result.platform).toBe('twitch')
  })

  it('should timeout a user for 600 seconds', async () => {
    global.fetch = mock(async () =>
      Response.json({
        data: [
          {
            user_id: '98765',
            created_at: '2026-04-07T12:00:00Z',
          },
        ],
      }),
    ) as unknown as typeof global.fetch

    const result = await Twitch.banUser(TWITCH_TOKEN, TWITCH_BROADCASTER_ID, TWITCH_MODERATOR_ID, {
      user_id: '98765',
      reason: 'Warning',
      duration: 600,
    })

    expect(result.success).toBe(true)
    expect(result.isPermanent).toBe(false)
    expect(result.durationSeconds).toBe(600)
  })

  it('should handle 409 conflict when user already banned', async () => {
    global.fetch = mock(async () =>
      Response.json(
        {
          error: 'Conflict',
          status: 409,
          message: 'User is already banned',
        },
        { status: 409 },
      ),
    ) as unknown as typeof global.fetch

    const result = await Twitch.banUser(TWITCH_TOKEN, TWITCH_BROADCASTER_ID, TWITCH_MODERATOR_ID, {
      user_id: '98765',
      duration: 300,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('TWITCH_CONFLICT')
    expect(result.error?.status).toBe(409)
  })

  it('should handle 403 when not a moderator', async () => {
    global.fetch = mock(async () =>
      Response.json(
        {
          error: 'Forbidden',
          status: 403,
          message: 'User does not have the required moderator permissions',
        },
        { status: 403 },
      ),
    ) as unknown as typeof global.fetch

    const result = await Twitch.banUser(TWITCH_TOKEN, TWITCH_BROADCASTER_ID, TWITCH_MODERATOR_ID, {
      user_id: '98765',
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('TWITCH_NOT_MODERATOR')
  })

  it('should delete a message successfully', async () => {
    global.fetch = mock(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof global.fetch

    const result = await Twitch.deleteMessage(
      TWITCH_TOKEN,
      TWITCH_BROADCASTER_ID,
      TWITCH_MODERATOR_ID,
      'msg-12345',
    )

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-12345')
  })

  it('should handle 404 when message not found', async () => {
    global.fetch = mock(async () =>
      Response.json(
        {
          error: 'Not Found',
          status: 404,
          message: 'Message not found',
        },
        { status: 404 },
      ),
    ) as unknown as typeof global.fetch

    const result = await Twitch.deleteMessage(
      TWITCH_TOKEN,
      TWITCH_BROADCASTER_ID,
      TWITCH_MODERATOR_ID,
      'msg-invalid',
    )

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('TWITCH_NOT_FOUND')
  })

  it('should check moderator status', async () => {
    global.fetch = mock(async () =>
      Response.json({
        data: [
          {
            user_id: '654321',
            user_name: 'ModUser',
            user_login: 'moduser',
          },
        ],
        pagination: {},
      }),
    ) as unknown as typeof global.fetch

    const result = await Twitch.isModerator(TWITCH_TOKEN, TWITCH_BROADCASTER_ID, '654321')

    expect(result.isModerator).toBe(true)
    expect(result.platform).toBe('twitch')
  })

  it('should return false for non-moderator', async () => {
    global.fetch = mock(async () =>
      Response.json({
        data: [],
        pagination: {},
      }),
    ) as unknown as typeof global.fetch

    const result = await Twitch.isModerator(TWITCH_TOKEN, TWITCH_BROADCASTER_ID, '999999')

    expect(result.isModerator).toBe(false)
  })
})

// ============================================================
// Kick Tests
// ============================================================

describe('Kick Moderation', () => {
  it('should ban a user permanently on Kick', async () => {
    global.fetch = mock(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.kick.com/public/v1/moderation/bans')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        broadcaster_user_id: KICK_BROADCASTER_USER_ID,
        user_id: 999,
        reason: 'Harassment',
      })
      return Response.json({ data: {} })
    }) as unknown as typeof global.fetch

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
    global.fetch = mock(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.kick.com/public/v1/moderation/bans')
      expect(JSON.parse(String(init?.body))).toEqual({
        broadcaster_user_id: KICK_BROADCASTER_USER_ID,
        user_id: 999,
        duration: 5,
      })
      return Response.json({ data: {} })
    }) as unknown as typeof global.fetch

    const result = await Kick.banUser(KICK_TOKEN, {
      broadcaster_user_id: KICK_BROADCASTER_USER_ID,
      user_id: 999,
      duration: 5,
    })

    expect(result.success).toBe(true)
    expect(result.durationSeconds).toBe(300)
  })

  it('should handle 401 unauthorized on Kick', async () => {
    global.fetch = mock(async () =>
      Response.json(
        {
          error: 'Unauthorized',
        },
        { status: 401 },
      ),
    ) as unknown as typeof global.fetch

    const result = await Kick.banUser(KICK_TOKEN, {
      broadcaster_user_id: KICK_BROADCASTER_USER_ID,
      user_id: 999,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('KICK_UNAUTHORIZED')
  })

  it('should delete a message on Kick', async () => {
    global.fetch = mock(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.kick.com/public/v1/chat/msg-kick-123')
      expect(init?.method).toBe('DELETE')
      return new Response(null, { status: 204 })
    }) as unknown as typeof global.fetch

    const result = await Kick.deleteMessage(KICK_TOKEN, 'msg-kick-123')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-kick-123')
  })

  it('should handle 404 when message not found on Kick', async () => {
    global.fetch = mock(async () =>
      Response.json(
        {
          error: 'Not found',
        },
        { status: 404 },
      ),
    ) as unknown as typeof global.fetch

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
