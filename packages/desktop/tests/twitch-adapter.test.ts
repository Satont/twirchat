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

describe('Twitch system notices', () => {
  test('shows IRC moderation actions without redisplaying deleted content', () => {
    const { adapter, client, messages } = selfFixture('viewer', 'another')
    const notices: NormalizedChatMessage[] = []
    const sequence: string[] = []
    adapter.on('notice', (notice) => {
      notices.push(notice)
      sequence.push('notice')
    })
    adapter.on('moderation', (event) => sequence.push(event.action))
    adapter.on('chat_clear', () => sequence.push('clear'))
    client.irc.receiveLine(
      '@room-id=420;target-user-id=10;tmi-sent-ts=1780000000000 :tmi.twitch.tv CLEARCHAT #another :maya',
    )
    client.irc.receiveLine(
      '@room-id=420;target-user-id=11;tmi-sent-ts=1780000001000;ban-duration=60 :tmi.twitch.tv CLEARCHAT #another :liam',
    )
    client.irc.receiveLine(
      '@login=liam;target-msg-id=some-message;tmi-sent-ts=1780000002000 :tmi.twitch.tv CLEARMSG #another :Deleted original text',
    )
    client.irc.receiveLine(
      '@room-id=420;tmi-sent-ts=1780000003000 :tmi.twitch.tv CLEARCHAT #another',
    )

    expect(messages).toHaveLength(0)
    expect(sequence).toEqual([
      'ban',
      'notice',
      'timeout',
      'notice',
      'delete_message',
      'notice',
      'clear',
      'notice',
    ])
    expect(notices.map((notice) => notice.text)).toEqual([
      '@maya was banned',
      '@liam was timed out for 60s',
      'Deleted a message from @liam',
      'Chat was cleared',
    ])
    expect(notices.at(-1)).toMatchObject({
      id: 'twitch:notice:clear:another:1780000003000',
      channelId: 'another',
      timestamp: new Date(1780000003000),
      metadata: { twitchNotice: { kind: 'moderation' } },
    })
  })

  test('seeds initial room modes silently and deduplicates IRC mode confirmations', () => {
    const { adapter, client } = selfFixture('viewer', 'another')
    const notices: string[] = []
    adapter.on('notice', ({ text }) => notices.push(text))
    client.irc.receiveLine(
      '@emote-only=0;followers-only=-1;r9k=0;room-id=420;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #another',
    )
    expect(adapter.getRoomState()).toMatchObject({ subscribersOnly: false, slowSeconds: 0 })
    expect(notices).toHaveLength(0)
    client.irc.receiveLine('@slow=15 :tmi.twitch.tv ROOMSTATE #another')
    client.irc.receiveLine('@followers-only=0 :tmi.twitch.tv ROOMSTATE #another')
    client.irc.receiveLine('@subs-only=1 :tmi.twitch.tv ROOMSTATE #another')
    client.irc.receiveLine(
      '@msg-id=subs_on :tmi.twitch.tv NOTICE #another :This room is now in subscribers-only mode.',
    )
    client.irc.receiveLine('@emote-only=1 :tmi.twitch.tv ROOMSTATE #another')
    client.irc.receiveLine('@r9k=1 :tmi.twitch.tv ROOMSTATE #another')
    expect(notices).toEqual([
      'Slow mode enabled (15s)',
      'Followers-only mode enabled',
      'Subscribers-only mode enabled',
      'Emote-only mode enabled',
      'Unique chat mode enabled',
    ])
  })

  test('routes IRC notices separately from regular messages and keeps the provider identity', () => {
    const { adapter, client, messages } = selfFixture('viewer', 'another')
    const notices: NormalizedChatMessage[] = []
    const events: string[] = []
    adapter.on('notice', (notice) => notices.push(notice))
    adapter.on('event', (event) => events.push(event.type))
    const send = (id: string, tags: string, detail = '') =>
      client.irc.receiveLine(
        `@id=${id};room-id=420;tmi-sent-ts=1780000000000;${tags} :tmi.twitch.tv USERNOTICE #another${detail}`,
      )

    send('sub', 'msg-id=sub;login=maya;display-name=Maya;user-id=10;msg-param-sub-plan=Prime')
    send(
      'resub',
      'msg-id=resub;login=maya;display-name=Maya;user-id=10;msg-param-cumulative-months=12;system-msg=Maya\\ssubscribed\\sfor\\s12\\smonths!',
      ' :Happy anniversary!',
    )
    send(
      'gift',
      'msg-id=subgift;login=maya;display-name=Maya;user-id=10;msg-param-recipient-id=20;msg-param-recipient-user-name=liam;msg-param-recipient-display-name=Liam',
    )
    send('batch', 'msg-id=submysterygift;login=ananonymousgifter;msg-param-mass-gift-count=5')
    send('raid', 'msg-id=raid;msg-param-displayName=Maya;msg-param-viewerCount=42')
    send(
      'reward',
      'msg-id=rewardgift;login=maya;display-name=Maya;user-id=10;msg-param-trigger-type=CHEER;msg-param-selected-count=3',
    )
    send('unrelated-reward', 'msg-id=rewardgift;msg-param-trigger-type=OTHER')

    expect(messages).toEqual([])
    expect(events).toEqual(['sub', 'resub', 'gift_sub', 'raid'])
    expect(notices.map((notice) => [notice.metadata?.twitchNotice?.kind, notice.text])).toEqual([
      ['sub', 'Maya subscribed with Prime.'],
      ['resub', 'Maya subscribed for 12 months!'],
      ['gift_sub', 'Maya gifted a subscription to Liam.'],
      ['community_gift', 'Anonymous gifted 5 subscriptions to the community.'],
      ['raid', 'Maya raided with 42 viewers.'],
      ['reward_gift', 'Maya shared 3 rewards with a Cheer.'],
    ])
    expect(notices[1]).toMatchObject({
      id: 'twitch:notice:resub',
      type: 'system',
      channelId: 'another',
      timestamp: new Date(1780000000000),
      metadata: { twitchNotice: { detail: 'Happy anniversary!' } },
    })
    expect(notices[2]?.author).toMatchObject({ id: '10', username: 'maya', displayName: 'Maya' })
  })
})

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
