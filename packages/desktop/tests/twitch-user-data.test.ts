import { afterEach, describe, expect, test } from 'bun:test'

import { getRuntimeConfig, setRuntimeConfig } from '../src/runtime-config'
import { getNativeTwitchEmotes } from '../src/services/native-emotes'
import { loadTwitchUserCardDetails } from '../src/services/twitch-user-card'
import { enrichTwitchUserProfile } from '../src/services/twitch-user-profile'

const originalFetch = globalThis.fetch
const originalConfig = getRuntimeConfig()
const backendUrl = 'https://backend.example'

type TestFetch = (url: URL, init?: RequestInit) => Response | Promise<Response>

function mockFetch(transport: TestFetch) {
  setRuntimeConfig({ backendUrl })
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) =>
      transport(new URL(input instanceof Request ? input.url : input), init),
    { preconnect: originalFetch.preconnect },
  )
}

function tokenResponse(scopes: string[]) {
  return Response.json({
    client_id: 'token-client',
    user_id: '42',
    login: 'creator',
    scopes,
    expires_in: 3600,
  })
}

function emotes(name: string) {
  return {
    template:
      'https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}',
    data: [{ id: name, name, format: ['static'], scale: ['1.0'], theme_mode: ['light'] }],
  }
}

describe('private Twitch user data', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    setRuntimeConfig(originalConfig)
  })

  test('paginates local emotes with the token client ID and coalesces account validation', async () => {
    let validations = 0
    mockFetch((url, init) => {
      const headers = new Headers(init?.headers)
      expect(init?.redirect).toBe('error')
      if (url.hostname === 'id.twitch.tv') {
        validations++
        expect(headers.get('Authorization')).toBe('OAuth emote-token')
        return tokenResponse(['user:read:emotes'])
      }
      expect(url.hostname).toBe('api.twitch.tv')
      expect(headers.get('Authorization')).toBe('Bearer emote-token')
      expect(headers.get('Client-Id')).toBe('token-client')
      if (url.pathname.endsWith('/emotes/global')) return Response.json(emotes('Global'))
      if (url.pathname.endsWith('/emotes/user')) {
        expect(url.searchParams.get('user_id')).toBe('42')
        expect(url.searchParams.get('broadcaster_id')).toBe('42')
        if (url.searchParams.has('after')) {
          expect(url.searchParams.get('after')).toBe('next')
          return Response.json(emotes('PageTwo'))
        }
        return Response.json({ ...emotes('PageOne'), pagination: { cursor: 'next' } })
      }
      return Response.json(emotes('Channel'))
    })

    const [one, two] = await Promise.all([
      getNativeTwitchEmotes('42', 'emote-token'),
      getNativeTwitchEmotes('42', 'emote-token'),
    ])
    expect(one.map((emote) => emote.alias)).toEqual(['PageOne', 'PageTwo', 'Channel', 'Global'])
    expect(two).toEqual(one)
    expect(validations).toBe(1)
  })

  test('keeps public emotes available after rejected credentials without sending the token', async () => {
    mockFetch((url, init) => {
      if (url.hostname === 'id.twitch.tv') return new Response(null, { status: 401 })
      expect(url.origin).toBe(backendUrl)
      expect(url.pathname).toBe('/api/emote-catalog/twitch')
      expect(new Headers(init?.headers).get('Authorization')).toBeNull()
      expect(init?.body).toBe(JSON.stringify({ channelSlug: '42', force: true }))
      return Response.json([])
    })
    expect(await getNativeTwitchEmotes('42', 'expired-token', true)).toEqual([])
  })

  test('reports a repeated user emote cursor', async () => {
    mockFetch((url) => {
      if (url.hostname === 'id.twitch.tv') return tokenResponse(['user:read:emotes'])
      return Response.json({
        ...emotes('Loop'),
        pagination: url.pathname.endsWith('/user') ? { cursor: 'same' } : {},
      })
    })
    await expect(getNativeTwitchEmotes('42', 'loop-token')).rejects.toThrow('repeated')
  })

  test('loads follower count, roles, follow age and subscription details directly from Twitch', async () => {
    mockFetch((url, init) => {
      const headers = new Headers(init?.headers)
      if (url.hostname === 'id.twitch.tv')
        return tokenResponse([
          'moderation:read',
          'moderator:read:followers',
          'channel:read:vips',
          'channel:read:editors',
          'channel:read:subscriptions',
        ])
      if (url.origin === backendUrl) {
        expect(url.pathname).toBe('/api/emote-catalog/twitch/channel')
        expect(headers.get('Authorization')).toBeNull()
        expect(init?.body).toBe(JSON.stringify({ channelSlug: 'creator' }))
        return Response.json({ platformUserId: '42', login: 'creator' })
      }
      expect(url.hostname).toBe('api.twitch.tv')
      expect(headers.get('Client-Id')).toBe('token-client')
      expect(headers.get('Authorization')).toBe('Bearer profile-token')
      if (url.pathname.endsWith('/followers'))
        return Response.json(
          url.searchParams.has('first')
            ? { total: 1234 }
            : { data: [{ followed_at: '2021-02-03T04:05:06Z' }] },
        )
      if (url.pathname.endsWith('/vips')) return Response.json({ data: [] })
      if (url.pathname.endsWith('/subscriptions'))
        return Response.json({ data: [{ tier: '1000', is_gift: true, gifter_name: 'GiftUser' }] })
      return Response.json({ data: [{ user_id: '200' }] })
    })
    const [profile, card] = await Promise.all([
      enrichTwitchUserProfile(
        { platform: 'twitch', platformUserId: '200', channelSlug: 'creator' },
        {
          id: '200',
          roles: { broadcaster: false },
          errors: [
            { section: 'followers', message: 'Connect Twitch to read follower count.' },
            { section: 'roles', message: 'Roles require the channel owner.' },
            { section: 'live', message: 'Live status is unavailable.' },
          ],
        },
        'profile-token',
      ),
      loadTwitchUserCardDetails(
        { platform: 'twitch', platformUserId: '200', channelId: 'creator' },
        'profile-token',
      ),
    ])
    expect(profile.followers).toBe(1234)
    expect(profile.roles).toEqual({ broadcaster: false, moderator: true, vip: false, editor: true })
    expect(profile.errors).toEqual([{ section: 'live', message: 'Live status is unavailable.' }])
    expect(card.followAge).toEqual({ status: 'available', followedAt: '2021-02-03T04:05:06Z' })
    expect(card.subscriptionDuration).toMatchObject({
      status: 'available',
      currentlySubscribed: true,
      tier: '1000',
      isGift: true,
    })
  })
})
