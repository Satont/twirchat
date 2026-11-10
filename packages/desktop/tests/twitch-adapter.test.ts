import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import {
  TwitchAdapter,
  twitchAuthorAppearance,
  twitchMessageMetadata,
} from '@desktop/platforms/twitch/adapter'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { ChatClient, LogLevel, UserState } from '@twurple/chat'

import { parseTwitchBadgeCatalog } from '../src/platforms/twitch/badge-data'
import { onTwitchSendRejected } from '../src/platforms/twitch/send-outcomes'
import { createTwitchSenderPool, type TwitchSenderPool } from '../src/platforms/twitch/sender-pool'

describe('twitchMessageMetadata', () => {
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
})

const clients: ChatClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.quit()
})

function readerFixture(login = 'satont', channel = 'satont', senders?: TwitchSenderPool) {
  const client = new ChatClient({ logger: { minLevel: LogLevel.CRITICAL } })
  clients.push(client)
  const adapter = new TwitchAdapter(senders)
  Object.assign(adapter, {
    chatClient: client,
    channelName: channel,
    anonymous: false,
    login,
    accountId: 'twitch:123',
    isConnected: true,
    badgeCache: parseTwitchBadgeCatalog({
      badges: {
        'broadcaster/1': 'https://example.com/broadcaster.png',
        'moderator/1': 'https://example.com/moderator.png',
        'subscriber/12': 'https://example.com/subscriber.png',
      },
    }),
  })
  adapter['setupEventHandlers']()
  const messages: NormalizedChatMessage[] = []
  adapter.on('message', (message) => messages.push(message))
  return { adapter, client, messages }
}

function writerFixture(
  write: (client: ChatClient, channel: string, text: string, replyTo?: string) => Promise<void>,
) {
  const client = new ChatClient({ logger: { minLevel: LogLevel.CRITICAL } })
  clients.push(client)
  return createTwitchSenderPool({
    token: async () => 'fixture',
    refreshToken: async () => 'fixture',
    acquire: async () => {},
    createClient: () => ({
      connect() {},
      quit: () => client.quit(),
      async join() {},
      part() {},
      say: (channel, text, replyTo) => write(client, channel, text, replyTo),
      onConnect: (handler) => queueMicrotask(handler),
      onDisconnect: (handler) => {
        client.onDisconnect(handler)
      },
      onAuthenticationFailure() {},
      onUserState: (handler) => {
        client.irc.onTypedMessage(UserState, (message) => handler(message.channel, message.tags))
      },
      onRejected: (handler) => onTwitchSendRejected(client, handler),
    }),
  })
}

describe('Twitch system notices', () => {
  test('shows IRC moderation actions without redisplaying deleted content', () => {
    const { adapter, client, messages } = readerFixture('viewer', 'another')
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
    const { adapter, client } = readerFixture('viewer', 'another')
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
    const { adapter, client, messages } = readerFixture('viewer', 'another')
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

describe('Twitch incoming message appearance', () => {
  test('resolves authoritative badges and color without inventing channel roles', () => {
    expect(twitchAuthorAppearance(new Map(), new Map()).badges).toEqual([])
    expect(
      twitchAuthorAppearance(
        new Map([
          ['badges', 'broadcaster/1,subscriber/12'],
          ['color', '#123456'],
        ]),
        parseTwitchBadgeCatalog({ badges: { 'subscriber/12': 'https://example.com/sub.png' } }),
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

  test.each(['PRIMARY', 'BLUE', 'GREEN', 'ORANGE', 'PURPLE'])(
    '%s announcements preserve their color separately from sender appearance',
    (color) => {
      const { client, messages } = readerFixture()
      client.irc.receiveLine(
        `@badges=moderator/1;color=#ABCDEF;display-name=Mod;user-id=456;id=announcement-id;msg-id=announcement;msg-param-color=${color} :tmi.twitch.tv USERNOTICE #satont :announcement body`,
      )
      expect(messages.at(-1)?.author.badges?.at(0)?.type).toBe('moderator')
      expect(messages.at(-1)?.author.color).toBe('#ABCDEF')
      expect(messages.at(-1)?.metadata?.announcement).toBe(color.toLowerCase())
      expect(messages.at(-1)?.text).toBe('announcement body')
      expect(messages.at(-1)?.channelId).toBe('satont')
      expect(messages.at(-1)?.id).toBe('announcement-id')
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
    const { adapter, client, messages } = readerFixture()
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
      client.irc.receiveLine(
        '@badges=broadcaster/1;id=with-metadata;msg-id=announcement;msg-param-color=PRIMARY :tmi.twitch.tv USERNOTICE #satont :with metadata',
      )
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

describe('Twitch writer and reader', () => {
  test('a writer acknowledgment creates no row and the incoming IRC reply supplies its metadata', async () => {
    const written: Array<{ channel: string; text: string; replyTo?: string }> = []
    const senders = writerFixture(async (writer, channel, text, replyTo) => {
      written.push({ channel, text, replyTo })
      writer.irc.receiveLine('@id=real-message :tmi.twitch.tv USERSTATE #satont')
    })
    const { adapter, client, messages } = readerFixture('satont', 'satont', senders)
    try {
      await adapter.sendMessage('satont', 'reply', 'parent')
      expect(written).toEqual([{ channel: 'satont', text: 'reply', replyTo: 'parent' }])
      expect(messages).toEqual([])

      const received = Promise.withResolvers<NormalizedChatMessage>()
      adapter.on('message', received.resolve)
      client.irc.receiveLine(
        '@badges=broadcaster/1;id=real-message;reply-parent-msg-id=parent;reply-parent-msg-body=original;reply-parent-user-id=456;reply-parent-user-login=viewer;reply-parent-display-name=Viewer :satont!satont@satont.tmi.twitch.tv PRIVMSG #satont :reply',
      )
      expect(await received.promise).toMatchObject({
        id: 'real-message',
        text: 'reply',
        author: { badges: [{ id: 'broadcaster/1' }] },
        reply: {
          parentMessageId: 'parent',
          parentMessageText: 'original',
          parentAuthor: { id: '456', username: 'viewer', displayName: 'Viewer' },
        },
      })
      expect(messages).toHaveLength(1)
    } finally {
      await adapter.disconnect()
    }
  })

  test.each(['msg_automod_held', 'msg_rejected'])(
    'an AutoMod %s notice returns a held receipt without creating a row',
    async (msgId) => {
      const senders = writerFixture(async (writer) => {
        writer.irc.receiveLine('@id=unrelated :tmi.twitch.tv USERSTATE #other')
        writer.irc.receiveLine(':tmi.twitch.tv USERSTATE #another')
        writer.irc.receiveLine(
          `@msg-id=${msgId} :tmi.twitch.tv NOTICE #another :Your message is being checked.`,
        )
      })
      const { adapter, messages } = readerFixture('viewer', 'another', senders)
      try {
        expect(await adapter.sendMessage('another', 'held text')).toEqual({
          channelId: 'another',
          held: true,
        })
        expect(messages).toEqual([])
      } finally {
        await adapter.disconnect()
      }
    },
  )

  test('a mandatory moderation rejection is a send failure', async () => {
    const senders = writerFixture(async (writer) => {
      writer.irc.receiveLine(
        '@msg-id=msg_rejected_mandatory :tmi.twitch.tv NOTICE #another :Your message was blocked.',
      )
    })
    const { adapter, messages } = readerFixture('viewer', 'another', senders)
    try {
      await expect(adapter.sendMessage('another', 'blocked text')).rejects.toThrow(
        'Twitch did not send the message from @viewer: Twitch blocked the message.',
      )
      expect(messages).toEqual([])
    } finally {
      await adapter.disconnect()
    }
  })

  test('disconnecting the last reader cancels the wait for a send acknowledgment', async () => {
    const written = Promise.withResolvers<void>()
    const senders = writerFixture(async () => written.resolve())
    const { adapter, messages } = readerFixture('viewer', 'another', senders)
    const sending = adapter.sendMessage('another', 'sending')
    const disconnecting = written.promise.then(() => adapter.disconnect())
    await expect(sending).rejects.toThrow('disconnected before delivery')
    await disconnecting
    expect(messages).toEqual([])
  })
})
