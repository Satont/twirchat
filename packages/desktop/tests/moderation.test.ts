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

import * as Twitch from '../src/services/moderation/twitch.ts'
import { fetchUrl, textBody } from './fixture-values'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const TWITCH_CREDENTIALS = { accessToken: 'test-twitch-token', clientId: 'public-client' }
const TWITCH_BROADCASTER_ID = '123456'
const TWITCH_MODERATOR_ID = '654321'

// ============================================================
// Twitch Tests
// ============================================================

describe('Twitch Moderation', () => {
  it('should ban a user permanently', async () => {
    global.fetch = Object.assign(
      mock(async () =>
        Response.json({
          data: [
            {
              user_id: '98765',
              created_at: '2026-04-07T12:00:00Z',
            },
          ],
        }),
      ),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Twitch.banUser(
      TWITCH_CREDENTIALS,
      TWITCH_BROADCASTER_ID,
      TWITCH_MODERATOR_ID,
      {
        user_id: '98765',
        reason: 'Spamming',
        duration: null,
      },
    )

    expect(result.success).toBe(true)
    expect(result.isPermanent).toBe(true)
    expect(result.platform).toBe('twitch')
  })

  it('should timeout a user for 600 seconds', async () => {
    global.fetch = Object.assign(
      mock(async () =>
        Response.json({
          data: [
            {
              user_id: '98765',
              created_at: '2026-04-07T12:00:00Z',
            },
          ],
        }),
      ),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Twitch.banUser(
      TWITCH_CREDENTIALS,
      TWITCH_BROADCASTER_ID,
      TWITCH_MODERATOR_ID,
      {
        user_id: '98765',
        reason: 'Warning',
        duration: 600,
      },
    )

    expect(result.success).toBe(true)
    expect(result.isPermanent).toBe(false)
    expect(result.durationSeconds).toBe(600)
  })

  it('sends bans and timeouts in the Helix data envelope', async () => {
    const requests: { url: string; body: unknown }[] = []
    global.fetch = Object.assign(
      mock(async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: fetchUrl(url), body: JSON.parse(textBody(init?.body)) })
        return Response.json({ data: [{ user_id: '98765', created_at: '2026-04-07T12:00:00Z' }] })
      }),
      { preconnect: originalFetch.preconnect },
    )

    await Twitch.banUser(TWITCH_CREDENTIALS, TWITCH_BROADCASTER_ID, TWITCH_MODERATOR_ID, {
      user_id: '98765',
      duration: null,
    })
    await Twitch.banUser(TWITCH_CREDENTIALS, TWITCH_BROADCASTER_ID, TWITCH_MODERATOR_ID, {
      user_id: '98765',
      reason: 'Spamming',
      duration: 600,
    })

    expect(requests).toEqual([
      {
        url: 'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=123456&moderator_id=654321',
        body: { data: { user_id: '98765' } },
      },
      {
        url: 'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=123456&moderator_id=654321',
        body: { data: { user_id: '98765', duration: 600, reason: 'Spamming' } },
      },
    ])
  })

  it('should handle 409 conflict when user already banned', async () => {
    global.fetch = Object.assign(
      mock(async () =>
        Response.json(
          {
            error: 'Conflict',
            status: 409,
            message: 'User is already banned',
          },
          { status: 409 },
        ),
      ),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Twitch.banUser(
      TWITCH_CREDENTIALS,
      TWITCH_BROADCASTER_ID,
      TWITCH_MODERATOR_ID,
      {
        user_id: '98765',
        duration: 300,
      },
    )

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('TWITCH_CONFLICT')
    expect(result.error?.status).toBe(409)
  })

  it('should handle 403 when not a moderator', async () => {
    global.fetch = Object.assign(
      mock(async () =>
        Response.json(
          {
            error: 'Forbidden',
            status: 403,
            message: 'User does not have the required moderator permissions',
          },
          { status: 403 },
        ),
      ),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Twitch.banUser(
      TWITCH_CREDENTIALS,
      TWITCH_BROADCASTER_ID,
      TWITCH_MODERATOR_ID,
      {
        user_id: '98765',
      },
    )

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('TWITCH_NOT_MODERATOR')
  })

  it('should delete a message successfully', async () => {
    global.fetch = Object.assign(
      mock(async () => new Response(null, { status: 204 })),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Twitch.deleteMessage(
      TWITCH_CREDENTIALS,
      TWITCH_BROADCASTER_ID,
      TWITCH_MODERATOR_ID,
      'msg-12345',
    )

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-12345')
  })

  it('should handle 404 when message not found', async () => {
    global.fetch = Object.assign(
      mock(async () =>
        Response.json(
          {
            error: 'Not Found',
            status: 404,
            message: 'Message not found',
          },
          { status: 404 },
        ),
      ),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Twitch.deleteMessage(
      TWITCH_CREDENTIALS,
      TWITCH_BROADCASTER_ID,
      TWITCH_MODERATOR_ID,
      'msg-invalid',
    )

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('TWITCH_NOT_FOUND')
  })

  it('should check moderator status with the authenticated moderators own token', async () => {
    global.fetch = Object.assign(
      mock(async (input: string | URL | Request, init?: RequestInit) => {
        expect(fetchUrl(input)).toBe(
          'https://api.twitch.tv/helix/moderation/channels?user_id=654321&first=100',
        )
        expect(new Headers(init?.headers).get('Client-Id')).toBe('public-client')
        expect(new Headers(init?.headers).get('authorization')).toBe(
          `Bearer ${TWITCH_CREDENTIALS.accessToken}`,
        )
        return Response.json({
          data: [
            {
              broadcaster_id: TWITCH_BROADCASTER_ID,
              broadcaster_name: 'Creator',
              broadcaster_login: 'creator',
            },
          ],
          pagination: {},
        })
      }),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Twitch.isModerator(TWITCH_CREDENTIALS, TWITCH_BROADCASTER_ID, '654321')

    expect(result.isModerator).toBe(true)
    expect(result.platform).toBe('twitch')
  })

  it('finds a moderated channel on a later page instead of accepting any channel', async () => {
    let calls = 0
    global.fetch = Object.assign(
      mock(async (input: string | URL | Request) => {
        calls++
        const url = new URL(fetchUrl(input))
        expect(url.searchParams.get('user_id')).toBe('654321')
        if (calls === 1)
          return Response.json({
            data: [{ broadcaster_id: 'other' }],
            pagination: { cursor: 'page2' },
          })
        expect(url.searchParams.get('after')).toBe('page2')
        return Response.json({ data: [{ broadcaster_id: TWITCH_BROADCASTER_ID }], pagination: {} })
      }),
      { preconnect: originalFetch.preconnect },
    )
    expect(
      (await Twitch.isModerator(TWITCH_CREDENTIALS, TWITCH_BROADCASTER_ID, '654321')).isModerator,
    ).toBe(true)
    expect(calls).toBe(2)
  })

  it('should return false for non-moderator', async () => {
    global.fetch = Object.assign(
      mock(async () =>
        Response.json({
          data: [],
          pagination: {},
        }),
      ),
      { preconnect: originalFetch.preconnect },
    )

    const result = await Twitch.isModerator(TWITCH_CREDENTIALS, TWITCH_BROADCASTER_ID, '999999')

    expect(result.isModerator).toBe(false)
  })
})
