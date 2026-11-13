import { describe, expect, test } from 'bun:test'

import { TWITCH_SCOPES } from '@twirchat/shared/twitch-scopes'

import { createChatToolsService, type ChatToolsInput } from '../src/services/chat-tools'
import { textBody } from './fixture-values'
import { literal, required } from './fixture-values'

const input: ChatToolsInput = {
  clientId: 'public-client',
  channelSlug: 'creator',
  accessToken: 'token',
  platformUserId: '42',
  scopes: TWITCH_SCOPES,
}

function fixture(response: () => Response = () => Response.json({ data: [] })) {
  const calls: { url: URL; init: RequestInit }[] = []
  const service = createChatToolsService({
    async fetch(url, init) {
      calls.push({ url: new URL(url), init: init ?? {} })
      return response()
    },
    async resolveTwitchUserId(identifier) {
      return identifier === 'creator' ? '100' : identifier === 'missing' ? null : '200'
    },
  })
  return { service, calls }
}

const moderated = { broadcaster_id: '100', moderator_id: '42' }
const cases: {
  text: string
  path: string
  method: string
  query: Record<string, string>
  body?: unknown
}[] = [
  {
    text: '/ban target reason',
    path: 'moderation/bans',
    method: 'POST',
    query: moderated,
    body: { data: { user_id: '200', reason: 'reason' } },
  },
  {
    text: '/timeout target 1 brief',
    path: 'moderation/bans',
    method: 'POST',
    query: moderated,
    body: { data: { user_id: '200', duration: 1, reason: 'brief' } },
  },
  {
    text: '/timeout target 1h30m',
    path: 'moderation/bans',
    method: 'POST',
    query: moderated,
    body: { data: { user_id: '200', duration: 5400 } },
  },
  {
    text: '/unban target',
    path: 'moderation/bans',
    method: 'DELETE',
    query: { ...moderated, user_id: '200' },
  },
  {
    text: '/untimeout target',
    path: 'moderation/bans',
    method: 'DELETE',
    query: { ...moderated, user_id: '200' },
  },
  {
    text: '/delete message-id',
    path: 'moderation/chat',
    method: 'DELETE',
    query: { ...moderated, message_id: 'message-id' },
  },
  { text: '/clear', path: 'moderation/chat', method: 'DELETE', query: moderated },
  {
    text: '/slow 10',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { slow_mode: true, slow_mode_wait_time: 10 },
  },
  {
    text: '/slowoff',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { slow_mode: false },
  },
  {
    text: '/followers 30',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { follower_mode: true, follower_mode_duration: 30 },
  },
  {
    text: '/followers 1h',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { follower_mode: true, follower_mode_duration: 60 },
  },
  {
    text: '/followersoff',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { follower_mode: false },
  },
  {
    text: '/subscribers',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { subscriber_mode: true },
  },
  {
    text: '/subscribersoff',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { subscriber_mode: false },
  },
  {
    text: '/emoteonly',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { emote_mode: true },
  },
  {
    text: '/emoteonlyoff',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { emote_mode: false },
  },
  {
    text: '/uniquechat',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { unique_chat_mode: true },
  },
  {
    text: '/uniquechatoff',
    path: 'chat/settings',
    method: 'PATCH',
    query: moderated,
    body: { unique_chat_mode: false },
  },
  {
    text: '/announce Welcome chat',
    path: 'chat/announcements',
    method: 'POST',
    query: moderated,
    body: { message: 'Welcome chat', color: 'primary' },
  },
  ...['blue', 'green', 'orange', 'purple'].map((color) => ({
    text: `/announce${color} Hello`,
    path: 'chat/announcements',
    method: 'POST',
    query: moderated,
    body: { message: 'Hello', color },
  })),
  {
    text: '/color #123abc',
    path: 'chat/color',
    method: 'PUT',
    query: { user_id: '42', color: '#123abc' },
  },
  {
    text: '/commercial 60',
    path: 'channels/commercial',
    method: 'POST',
    query: {},
    body: { broadcaster_id: '100', length: 60 },
  },
  {
    text: '/raid target',
    path: 'raids',
    method: 'POST',
    query: { from_broadcaster_id: '100', to_broadcaster_id: '200' },
  },
  { text: '/unraid', path: 'raids', method: 'DELETE', query: { broadcaster_id: '100' } },
  {
    text: '/shoutout target',
    path: 'chat/shoutouts',
    method: 'POST',
    query: { from_broadcaster_id: '100', to_broadcaster_id: '200', moderator_id: '42' },
  },
  {
    text: '/mod target',
    path: 'moderation/moderators',
    method: 'POST',
    query: { broadcaster_id: '100', user_id: '200' },
  },
  {
    text: '/unmod target',
    path: 'moderation/moderators',
    method: 'DELETE',
    query: { broadcaster_id: '100', user_id: '200' },
  },
  {
    text: '/vip target',
    path: 'channels/vips',
    method: 'POST',
    query: { broadcaster_id: '100', user_id: '200' },
  },
  {
    text: '/unvip target',
    path: 'channels/vips',
    method: 'DELETE',
    query: { broadcaster_id: '100', user_id: '200' },
  },
  { text: '/block target', path: 'users/blocks', method: 'PUT', query: { target_user_id: '200' } },
  {
    text: '/unblock target',
    path: 'users/blocks',
    method: 'DELETE',
    query: { target_user_id: '200' },
  },
  {
    text: '/w target hello there',
    path: 'whispers',
    method: 'POST',
    query: { from_user_id: '42', to_user_id: '200' },
    body: { message: 'hello there' },
  },
  {
    text: '/whisper target hello',
    path: 'whispers',
    method: 'POST',
    query: { from_user_id: '42', to_user_id: '200' },
    body: { message: 'hello' },
  },
]

describe('Twitch platform commands', () => {
  for (const item of cases)
    test(item.text, async () => {
      const { service, calls } = fixture()
      await service.execute({ ...input, text: item.text })
      expect(calls).toHaveLength(1)
      const { url, init } = required(calls[0])
      expect(url.origin + url.pathname).toBe(`https://api.twitch.tv/helix/${item.path}`)
      expect(Object.fromEntries(url.searchParams)).toEqual(item.query)
      expect(init.method).toBe(item.method)
      expect(init.body ? JSON.parse(textBody(init.body)) : undefined).toEqual(item.body)
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer token')
      expect(new Headers(init.headers).get('Client-Id')).toBe('public-client')
    })

  test('lists all moderator/VIP pages as real output', async () => {
    let page = 0
    const { service, calls } = fixture(() => {
      page++
      return Response.json({
        data: [{ user_name: `User ${page}`, user_login: `user${page}` }],
        pagination: page % 2 ? { cursor: 'next-page' } : {},
      })
    })
    expect(await service.execute({ ...input, text: '/mods' })).toEqual({
      message: 'Moderators: User 1, User 2',
    })
    expect(required(calls[1]).url.searchParams.get('after')).toBe('next-page')
    expect(await service.execute({ ...input, text: '/vips' })).toEqual({
      message: 'VIPs: User 3, User 4',
    })
    expect(required(calls[2]).url.pathname).toBe('/helix/channels/vips')
  })

  test('rejects invalid commands/arguments and missing scopes before a write', async () => {
    const { service, calls } = fixture()
    for (const text of [
      '/unknown',
      '/ban',
      '/delete',
      '/clear someone',
      '/slow 1',
      '/slow 121',
      '/timeout target 0',
      '/timeout target -5',
      '/timeout target 1209601',
      '/followers 129601',
      '/commercial 31',
      '/announce',
      '/mod one two',
    ]) {
      await expect(service.execute({ ...input, text })).rejects.toThrow()
    }
    await expect(service.execute({ ...input, scopes: [], text: '/ban target' })).rejects.toThrow(
      'moderator:manage:banned_users',
    )
    await expect(service.execute({ ...input, text: '/ban missing' })).rejects.toThrow('not found')
    expect(calls).toHaveLength(0)
  })

  test('preserves provider permission/rate-limit errors rather than reporting success', async () => {
    const { service } = fixture(() =>
      Response.json({ message: 'You are not a moderator' }, { status: 403 }),
    )
    await expect(service.execute({ ...input, text: '/slow' })).rejects.toThrow(
      'You are not a moderator',
    )
  })

  test('fetches and normalizes initial room settings without requiring write scopes', async () => {
    const { service, calls } = fixture(() =>
      Response.json({
        data: [
          {
            slow_mode: true,
            slow_mode_wait_time: 15,
            follower_mode: true,
            follower_mode_duration: 0,
            subscriber_mode: false,
            emote_mode: true,
            unique_chat_mode: false,
          },
        ],
      }),
    )
    expect(await service.getRoomState({ ...input, scopes: [] })).toEqual({
      platform: 'twitch',
      channelId: 'creator',
      slowSeconds: 15,
      followersOnlyMinutes: 0,
      subscribersOnly: false,
      emoteOnly: true,
      uniqueChat: false,
    })
    expect(required(calls[0]).url.toString()).toBe(
      'https://api.twitch.tv/helix/chat/settings?broadcaster_id=100',
    )
  })
})

describe('advanced moderation and stream commands', () => {
  test.each(
    literal([
      [
        '/warn target Stop spamming',
        '/helix/moderation/warnings',
        'POST',
        { data: { user_id: '200', reason: 'Stop spamming' } },
      ],
      ['/shield', '/helix/moderation/shield_mode', 'PUT', { is_active: true }],
      ['/shieldoff', '/helix/moderation/shield_mode', 'PUT', { is_active: false }],
      ['/blockterm bad phrase', '/helix/moderation/blocked_terms', 'POST', { text: 'bad phrase' }],
      [
        '/restrict target',
        '/helix/moderation/suspicious_users',
        'POST',
        { user_id: '200', status: 'RESTRICTED' },
      ],
      [
        '/monitor target',
        '/helix/moderation/suspicious_users',
        'POST',
        { user_id: '200', status: 'ACTIVE_MONITORING' },
      ],
    ]),
  )(
    '%s uses the moderator authorization and exact provider body',
    async (text, path, method, body) => {
      const { service, calls } = fixture()
      await service.execute({ ...input, text })
      expect(calls).toHaveLength(1)
      expect(required(calls[0]).url.pathname).toBe(path)
      expect(required(calls[0]).url.searchParams.get('broadcaster_id')).toBe('100')
      expect(required(calls[0]).url.searchParams.get('moderator_id')).toBe('42')
      expect(required(calls[0]).init.method).toBe(method)
      expect(JSON.parse(textBody(required(calls[0]).init.body))).toEqual(body)
    },
  )
  test.each(['unrestrict', 'unmonitor', 'unblockterm'])(
    '/%s deletes the actual resource',
    async (name) => {
      const { service, calls } = fixture()
      await service.execute({ ...input, text: `/${name} target` })
      expect(required(calls[0]).init.method).toBe('DELETE')
      expect(
        required(calls[0]).url.searchParams.get(name === 'unblockterm' ? 'id' : 'user_id'),
      ).toBe(name === 'unblockterm' ? 'target' : '200')
      expect(required(calls[0]).init.body).toBeUndefined()
    },
  )
  test.each(['allow', 'deny'])(
    'AutoMod %s supplies actor, message and decision',
    async (decision) => {
      const { service, calls } = fixture()
      await service.execute({ ...input, text: `/automod${decision} held-id` })
      expect(required(calls[0]).url.pathname).toBe('/helix/moderation/automod/message')
      expect(required(calls[0]).url.search).toBe('')
      expect(JSON.parse(textBody(required(calls[0]).init.body))).toEqual({
        user_id: '42',
        msg_id: 'held-id',
        action: decision.toUpperCase(),
      })
    },
  )
  test('blocked terms paginate and include IDs usable for deletion', async () => {
    let page = 0
    const { service, calls } = fixture(() =>
      Response.json(
        page++ === 0
          ? { data: [{ id: 'a', text: 'first term' }], pagination: { cursor: 'next' } }
          : { data: [{ id: 'b', text: 'second term' }] },
      ),
    )
    expect((await service.execute({ ...input, text: '/blockedterms' })).message).toBe(
      'a: first term\nb: second term',
    )
    expect(required(calls[1]).url.searchParams.get('after')).toBe('next')
  })
  test.each([
    '/warn target',
    '/blockterm a',
    '/shield extra',
    '/automodallow',
    `/marker ${'x'.repeat(141)}`,
  ])('%s fails validation before provider writes', async (text) => {
    const { service, calls } = fixture()
    await expect(service.execute({ ...input, text })).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
  test('missing advanced scope produces a reconnect error before any request', async () => {
    const { service, calls } = fixture()
    await expect(
      service.execute({ ...input, scopes: [], text: '/warn target reason' }),
    ).rejects.toThrow('moderator:manage:warnings')
    expect(calls).toHaveLength(0)
  })
  test('clip returns provider edit URL; marker returns actual position', async () => {
    const clip = fixture(() =>
      Response.json({ data: [{ id: 'clip', edit_url: 'https://clips.twitch.tv/edit/clip' }] }),
    )
    expect((await clip.service.execute({ ...input, text: '/clip' })).message).toContain(
      'https://clips.twitch.tv/edit/clip',
    )
    expect(required(clip.calls[0]).url.searchParams.get('broadcaster_id')).toBe('100')
    const marker = fixture(() => Response.json({ data: [{ id: 'mark', position_seconds: 42 }] }))
    expect(
      (await marker.service.execute({ ...input, text: '/marker Highlight this' })).message,
    ).toContain('42s')
    expect(JSON.parse(textBody(required(marker.calls[0]).init.body))).toEqual({
      user_id: '100',
      description: 'Highlight this',
    })
  })
  test('title read requires no write scope, while update checks it', async () => {
    const { service, calls } = fixture(() =>
      Response.json({ data: [{ title: 'Current title', game_name: 'Current category' }] }),
    )
    expect((await service.execute({ ...input, scopes: [], text: '/title' })).message).toBe(
      'Current title',
    )
    await expect(
      service.execute({ ...input, scopes: [], text: '/title New title' }),
    ).rejects.toThrow('channel:manage:broadcast')
    expect(calls).toHaveLength(1)
  })
  test('category chooses exact match instead of the first search result', async () => {
    const { service, calls } = fixture(() =>
      Response.json({
        data: [
          { id: 'bad', name: 'Other' },
          { id: '123', name: 'Just Chatting' },
        ],
      }),
    )
    await service.execute({ ...input, text: '/category just chatting' })
    expect(JSON.parse(textBody(required(calls[1]).init.body))).toEqual({ game_id: '123' })
  })
  test('uptime and usercolor use returned state with no write scopes', async () => {
    const offline = fixture()
    expect((await offline.service.execute({ ...input, scopes: [], text: '/uptime' })).message).toBe(
      'Channel is offline.',
    )
    const color = fixture(() =>
      Response.json({ data: [{ user_name: 'Viewer', color: '#123456' }] }),
    )
    expect(
      (await color.service.execute({ ...input, scopes: [], text: '/usercolor' })).message,
    ).toBe('Viewer: #123456')
    expect(required(color.calls[0]).url.searchParams.get('user_id')).toBe('42')
  })
})
