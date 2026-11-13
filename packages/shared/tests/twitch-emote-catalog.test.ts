import { describe, expect, test } from 'bun:test'

import { createTwitchEmoteCatalog, parseTwitchEmoteCatalog } from '../twitch-emote-catalog'

const template =
  'https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}'

function emote(
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    format: ['static'],
    scale: ['1.0', '2.0', '3.0'],
    theme_mode: ['light', 'dark'],
    ...extra,
  }
}

function body(emotes: Array<Record<string, unknown>>): Record<string, unknown> {
  return { template, data: emotes }
}

const json = (value: unknown) => new Response(JSON.stringify(value))

describe('Twitch emote access', () => {
  test('locks subscriber channel emotes that the user emote catalog does not include', () => {
    const sorted = parseTwitchEmoteCatalog(
      body([
        emote('sub-1', 'SubOne', { emote_type: 'subscriptions', tier: '1000' }),
        emote('sub-2', 'SubTwo', { emote_type: 'subscriptions', tier: '2000' }),
        emote('free-1', 'Free', { emote_type: 'none' }),
      ]),
      'channel',
      '42',
      new Set(['sub-1']),
    )
    expect(sorted.map(({ alias, locked }) => [alias, locked])).toEqual([
      ['SubOne', undefined],
      ['SubTwo', true],
      ['Free', undefined],
    ])
  })

  test('leaves subscriber emotes unlocked while user access is unknown', () => {
    const entries = parseTwitchEmoteCatalog(
      body([emote('sub-1', 'SubOne', { emote_type: 'subscriptions' })]),
      'channel',
      '42',
    )
    expect(entries[0]?.locked).toBeUndefined()
  })

  test('does not lock user-owned catalog entries even when a type is restricted', () => {
    const entries = parseTwitchEmoteCatalog(
      body([emote('sub-1', 'SubOne', { emote_type: 'subscriptions', owner_id: '42' })]),
      'collectibles',
      '42',
    )
    expect(entries[0]?.locked).toBeUndefined()
  })

  test('uses the signed-in user catalog to unlock subscribed channel emotes', async () => {
    const catalog = createTwitchEmoteCatalog()
    const emotes = await catalog({
      channelSlug: 'creator',
      source: {
        kind: 'user',
        cacheKey: 'token',
        userId: '7',
        fetch: async (path) => {
          if (path.startsWith('users?')) return json({ data: [{ id: '42', login: 'creator' }] })
          if (path.startsWith('chat/emotes/user'))
            return json(
              body([emote('sub-1', 'SubOne', { emote_type: 'subscriptions', owner_id: '42' })]),
            )
          if (path.startsWith('chat/emotes/global')) return json(body([]))
          if (path.startsWith('chat/emotes?'))
            return json(
              body([
                emote('sub-1', 'SubOne', { emote_type: 'subscriptions', owner_id: '42' }),
                emote('sub-2', 'SubTwo', {
                  emote_type: 'subscriptions',
                  tier: '2000',
                  owner_id: '42',
                }),
                emote('follower-1', 'Follower', { emote_type: 'follower', owner_id: '42' }),
              ]),
            )
          throw new Error(`Unexpected Twitch request: ${path}`)
        },
      },
    })
    expect(emotes.map(({ alias, locked }) => [alias, locked])).toEqual([
      ['SubOne', undefined],
      ['SubTwo', true],
      ['Follower', undefined],
    ])
  })

  test('does not lock the broadcaster own channel emotes', async () => {
    const catalog = createTwitchEmoteCatalog()
    const emotes = await catalog({
      channelSlug: '42',
      source: {
        kind: 'user',
        cacheKey: 'token',
        userId: '42',
        fetch: async (path) => {
          if (path.startsWith('chat/emotes/user')) return json(body([]))
          if (path.startsWith('chat/emotes/global')) return json(body([]))
          if (path.startsWith('chat/emotes?'))
            return json(body([emote('sub-1', 'SubOne', { emote_type: 'subscriptions' })]))
          throw new Error(`Unexpected Twitch request: ${path}`)
        },
      },
    })
    expect(emotes[0]?.alias).toBe('SubOne')
    expect(emotes[0]?.locked).toBeUndefined()
  })
})
