import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import {
  createLocalTwitchSentMessage,
  TwitchAdapter,
  twitchAuthorAppearance,
  twitchMessageMetadata,
} from '@desktop/platforms/twitch/adapter'
import { AccountStore } from '@desktop/store/account-store'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { ChatClient } from '@twurple/chat'

import { parseTwitchBadgeCatalog } from '../src/platforms/twitch/badge-data'

describe('createLocalTwitchSentMessage', () => {
  test('preserves Twitch first/returning/highlight/reward/bits/subscription/shared-chat metadata', () => {
    expect(
      twitchMessageMetadata({
        isFirst: true,
        isReturningChatter: true,
        isHighlight: true,
        rewardId: 'reward-id',
        bits: 100,
        tags: new Map([
          ['source-room-id', 'other-channel'],
          ['source-id', 'other-message'],
        ]),
        userInfo: { badgeInfo: new Map([['subscriber', '24']]) },
      }),
    ).toEqual({
      firstMessage: true,
      returningChatter: true,
      highlighted: true,
      rewardId: 'reward-id',
      bits: 100,
      subscriptionMonths: 24,
      sharedChat: { sourceChannelId: 'other-channel', sourceMessageId: 'other-message' },
    })
    const plain = twitchMessageMetadata({
      isFirst: false,
      isReturningChatter: false,
      isHighlight: false,
      rewardId: null,
      bits: 0,
      tags: new Map(),
      userInfo: { badgeInfo: new Map() },
    })
    expect(plain).toEqual({ firstMessage: false, returningChatter: false, highlighted: false })
  })
  test('builds a normalized local Twitch message', () => {
    const timestamp = new Date('2026-05-02T12:00:00.000Z')

    const message = createLocalTwitchSentMessage({
      author: {
        displayName: 'Satont',
        id: '12345',
        username: 'satont',
      },
      channelId: 'Satont',
      id: 'local:twitch:satont:test-id',
      text: 'hello from app',
      timestamp,
    })

    expect(message).toEqual({
      author: {
        badges: [],
        displayName: 'Satont',
        id: '12345',
        username: 'satont',
      },
      channelId: 'satont',
      emotes: [],
      id: 'local:twitch:satont:test-id',
      platform: 'twitch',
      text: 'hello from app',
      timestamp,
      type: 'message',
    })
  })

  test('preserves reply metadata when provided', () => {
    const message = createLocalTwitchSentMessage({
      author: {
        displayName: 'Satont',
        id: '12345',
      },
      channelId: 'satont',
      id: 'local:twitch:satont:reply',
      reply: {
        parentAuthor: {
          displayName: 'OtherUser',
          id: '67890',
          username: 'otheruser',
        },
        parentMessageId: 'msg-1',
        parentMessageText: 'first message',
      },
      text: 'replying',
    })

    expect(message.reply).toEqual({
      parentAuthor: {
        displayName: 'OtherUser',
        id: '67890',
        username: 'otheruser',
      },
      parentMessageId: 'msg-1',
      parentMessageText: 'first message',
    })
  })

  test('normalizes IRC channel prefixes for local IDs and message scope', () => {
    const message = createLocalTwitchSentMessage({
      author: { displayName: 'Satont', id: '12345' },
      channelId: ' #MiXeDcase ',
      text: 'normalized channel',
    })
    expect(message.channelId).toBe('mixedcase')
    expect(message.id.startsWith('local:twitch:mixedcase:')).toBe(true)
  })
})

const clients: ChatClient[] = []
const accountLookups: Array<ReturnType<typeof spyOn<typeof AccountStore, 'findByPlatform'>>> = []
afterEach(() => {
  for (const lookup of accountLookups.splice(0)) lookup.mockRestore()
  for (const client of clients.splice(0)) client.quit()
})

function selfFixture(login = 'satont', channel = 'satont') {
  const client = new ChatClient({ logger: { minLevel: 0 } })
  clients.push(client)
  const adapter = new TwitchAdapter()
  Object.assign(adapter, {
    chatClient: client,
    channelName: channel,
    anonymous: false,
    login,
    displayName: login,
    platformUserId: '123',
    badgeCache: parseTwitchBadgeCatalog({
      badges: {
        'broadcaster/1': 'https://example.com/broadcaster.png',
        'moderator/1': 'https://example.com/moderator.png',
        'subscriber/12': 'https://example.com/subscriber.png',
      },
    }),
  })
  accountLookups.push(spyOn(AccountStore, 'findByPlatform').mockReturnValue(null))
  adapter['setupEventHandlers']()
  const messages: NormalizedChatMessage[] = []
  adapter.on('message', (message) => messages.push(message))
  return { adapter, client, messages }
}

describe('Twitch self message badges', () => {
  test('resolves authoritative badges and color without inventing channel roles', () => {
    expect(twitchAuthorAppearance(new Map(), new Map()).badges).toEqual([])
    expect(
      twitchAuthorAppearance(
        new Map([
          ['badges', 'broadcaster/1,subscriber/12'],
          ['color', '#123456'],
        ]),
        parseTwitchBadgeCatalog({ badges: { 'subscriber/12': 'https://example.com/sub.png' } }),
        true,
      ),
    ).toEqual({
      badges: [
        { id: 'broadcaster/1', type: 'broadcaster', text: 'broadcaster' },
        {
          id: 'subscriber/12',
          type: 'subscriber',
          text: 'subscriber',
          imageUrl: 'https://example.com/sub.png',
        },
      ],
      color: '#123456',
    })
  })

  test('first own-channel send has broadcaster badge before USERSTATE arrives', () => {
    const { adapter, messages } = selfFixture('SaToNt')
    adapter['emitLocalSentMessage']('satont', 'first message')
    expect(messages.at(-1)?.author.badges).toEqual([
      {
        id: 'broadcaster/1',
        type: 'broadcaster',
        text: 'broadcaster',
        imageUrl: 'https://example.com/broadcaster.png',
      },
    ])
  })

  test('a viewer does not gain broadcaster and receives actual per-channel USERSTATE roles', () => {
    const { adapter, client, messages } = selfFixture('viewer')
    adapter['emitLocalSentMessage']('satont', 'before state')
    expect(messages.at(-1)?.author.badges).toEqual([])
    client.irc.receiveLine(
      '@badges=moderator/1,subscriber/12;color=#12AB34 :tmi.twitch.tv USERSTATE #satont',
    )
    adapter['emitLocalSentMessage']('satont', 'after state')
    expect(messages.at(-1)?.author.badges?.map((badge) => badge.type)).toEqual([
      'moderator',
      'subscriber',
    ])
    expect(messages.at(-1)?.author.badges?.at(0)?.imageUrl).toBe(
      'https://example.com/moderator.png',
    )
    expect(messages.at(-1)?.author.color).toBe('#12AB34')
    client.irc.receiveLine('@badges=vip/1;color=#FFFFFF :tmi.twitch.tv USERSTATE #other')
    adapter['emitLocalSentMessage']('satont', 'unchanged')
    expect(messages.at(-1)?.author.color).toBe('#12AB34')
  })

  test('an old client cannot change self roles after identity change and disconnect clears them', async () => {
    const { adapter, client, messages } = selfFixture('viewer')
    client.irc.receiveLine('@badges=moderator/1 :tmi.twitch.tv USERSTATE #satont')
    await adapter.disconnect()
    const next = new ChatClient({ logger: { minLevel: 0 } })
    clients.push(next)
    Object.assign(adapter, { chatClient: next, anonymous: false, login: 'newviewer' })
    adapter['setupEventHandlers']()
    client.irc.receiveLine('@badges=moderator/1;color=#FFFFFF :tmi.twitch.tv USERSTATE #satont')
    adapter['emitLocalSentMessage']('satont', 'fresh identity')
    expect(messages.at(-1)?.author.badges).toEqual([])
    expect(messages.at(-1)?.author.color).toBeUndefined()
  })

  test.each(['PRIMARY', 'BLUE', 'GREEN', 'ORANGE', 'PURPLE'])(
    '%s announcements preserve their color separately from sender appearance',
    (color) => {
      const { client, messages } = selfFixture()
      client.irc.receiveLine(
        `@badges=moderator/1;color=#ABCDEF;display-name=Mod;user-id=456;msg-id=announcement;msg-param-color=${color} :tmi.twitch.tv USERNOTICE #satont :announcement body`,
      )
      expect(messages.at(-1)?.author.badges?.at(0)?.type).toBe('moderator')
      expect(messages.at(-1)?.author.color).toBe('#ABCDEF')
      expect(messages.at(-1)?.metadata?.announcement).toBe(color.toLowerCase())
      expect(messages.at(-1)?.text).toBe('announcement body')
      expect(messages.at(-1)?.channelId).toBe('satont')
    },
  )

  test('a delayed badge fetch cannot replace the next channel or account badge cache', async () => {
    const adapter = new TwitchAdapter()
    const response = Promise.withResolvers<Response>()
    const fetcher = spyOn(globalThis, 'fetch').mockReturnValue(response.promise)
    try {
      Object.assign(adapter, { channelName: 'first' })
      const pending = adapter['fetchBadges']()
      Object.assign(adapter, { identityRevision: 1, channelName: 'second' })
      response.resolve(
        Response.json({ badges: { 'subscriber/12': 'https://example.com/old.png' } }),
      )
      await pending
      expect(adapter['badgeCache'].size).toBe(0)
    } finally {
      fetcher.mockRestore()
    }
  })

  test('live badge catalog fetch preserves backend titles and descriptions', async () => {
    const { adapter, messages } = selfFixture()
    const fetcher = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        badges: { 'broadcaster/1': 'https://example.com/broadcaster.png' },
        badgeMetadata: {
          'broadcaster/1': { title: 'Broadcaster', description: 'The channel owner.' },
        },
      }),
    )
    try {
      await adapter['fetchBadges']()
      adapter['emitLocalSentMessage']('satont', 'with metadata')
      expect(messages.at(-1)?.author.badges[0]).toEqual({
        id: 'broadcaster/1',
        type: 'broadcaster',
        text: 'Broadcaster',
        description: 'The channel owner.',
        imageUrl: 'https://example.com/broadcaster.png',
      })
    } finally {
      fetcher.mockRestore()
    }
  })
})
