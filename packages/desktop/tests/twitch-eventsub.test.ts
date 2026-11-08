import { afterEach, describe, expect, test } from 'bun:test'

import type {
  TwitchActivityEvent,
  TwitchEventSubStatus,
  TwitchWhisper,
} from '@twirchat/shared/twitch-activities'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import type { TwitchAutoModEvent } from '../src/services/twitch-automod'
import { TwitchEventSubClient, type EventSubSocket } from '../src/services/twitch-eventsub'
import { required } from './fixture-values'

class FakeSocket implements EventSubSocket {
  onmessage: EventSubSocket['onmessage'] = null
  onclose: EventSubSocket['onclose'] = null
  onerror: EventSubSocket['onerror'] = null
  closed = false
  constructor(readonly url: string) {}
  close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.(new CloseEvent('close'))
  }
  message(type: string, payload: unknown, id: string = crypto.randomUUID()) {
    this.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          metadata: {
            message_type: type,
            message_id: id,
            message_timestamp: '2026-11-02T00:00:00Z',
          },
          payload,
        }),
      }),
    )
  }
  welcome(id = 'session') {
    this.message('session_welcome', { session: { id, keepalive_timeout_seconds: 30 } })
  }
}
const clients: TwitchEventSubClient[] = []
const hold = (channel: string, messageId = 'held-message') => ({
  subscription: { type: 'automod.message.hold' },
  event: {
    broadcaster_user_login: channel,
    message_id: messageId,
    user_name: 'Viewer',
    message: { text: 'Held text' },
    reason: 'blocked_term',
  },
})
afterEach(() => {
  for (const client of clients.splice(0)) client.stop()
})
async function settle() {
  await Bun.sleep(5)
}
function fixture(override?: {
  subscribe?: (
    session: string,
    channel?: string,
  ) => Promise<{
    subscriptions: { id: string; type: string; condition: Record<string, string> }[]
    errors: string[]
  }>
}) {
  const sockets: FakeSocket[] = []
  const registrations: string[] = []
  const removed: string[][] = []
  const activities: TwitchActivityEvent[] = []
  const autoMod: TwitchAutoModEvent[] = []
  const moderationNotices: NormalizedChatMessage[] = []
  const whispers: TwitchWhisper[] = []
  const statuses: TwitchEventSubStatus[] = []
  let account = true
  const client = new TwitchEventSubClient({
    hasAccount: () => account,
    socket: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    subscribe:
      override?.subscribe ??
      (async (session, channel) => {
        const key = `${session}:${channel ?? 'whispers'}`
        registrations.push(key)
        return {
          subscriptions: [
            {
              id: key,
              type: channel ? 'channel.poll.begin' : 'user.whisper.message',
              condition: {},
            },
          ],
          errors: [],
        }
      }),
    unsubscribe: async (ids) => {
      removed.push(ids)
    },
    activity: (event) => activities.push(event),
    autoMod: (event) => autoMod.push(event),
    moderationNotice: (message) => moderationNotices.push(message),
    whisper: (event) => whispers.push(event),
    status: (status) => statuses.push(status),
    reconnectDelayMs: 1,
  })
  clients.push(client)
  return {
    client,
    sockets,
    registrations,
    removed,
    activities,
    autoMod,
    moderationNotices,
    whispers,
    statuses,
    setAccount: (value: boolean) => {
      account = value
    },
  }
}

describe('Twitch EventSub lifecycle', () => {
  test('shows privileged supplemental moderation events only for watched channels', async () => {
    const f = fixture()
    await f.client.watch('creator', true)
    const socket = required(f.sockets[0])
    socket.welcome()
    const action = {
      broadcaster_user_login: 'Creator',
      source_broadcaster_user_login: 'Friend',
      moderator_user_login: 'mod',
      action: 'shared_chat_delete',
      shared_chat_delete: { user_login: 'chatter', message_body: 'deleted body' },
    }
    const send = (event: object, id: string) =>
      socket.message(
        'notification',
        {
          subscription: { type: 'channel.moderate' },
          event,
        },
        id,
      )
    send(action, 'shared-delete')
    send(action, 'shared-delete')
    send({ ...action, action: 'delete', delete: action.shared_chat_delete }, 'irc-duplicate')
    send({ ...action, broadcaster_user_login: 'other' }, 'other-channel')
    send({ ...action, shared_chat_delete: { user_login: '../invalid' } }, 'invalid-target')
    expect(f.moderationNotices).toHaveLength(1)
    expect(f.moderationNotices[0]).toMatchObject({
      id: 'twitch:notice:eventsub:shared-delete',
      channelId: 'creator',
      text: '@mod deleted a message from @chatter in #friend (Shared Chat)',
      metadata: { twitchNotice: { kind: 'moderation' } },
    })
    await f.client.watch('creator', false)
    send(action, 'closed-channel')
    expect(f.moderationNotices).toHaveLength(1)
  })

  test('delivers AutoMod only for watched channels and clears the queue on final unwatch', async () => {
    const f = fixture()
    await f.client.watch('Creator', true)
    await f.client.watch('creator', true)
    const socket = required(f.sockets[0])
    socket.welcome()
    await settle()

    socket.message('notification', hold('other'))
    socket.message('notification', hold('creator', 'held-message another'))
    socket.message('notification', hold('Creator'))
    socket.message('notification', {
      subscription: { type: 'automod.message.update' },
      event: {
        broadcaster_user_login: 'creator',
        message_id: 'held-message',
        status: 'Approved',
      },
    })
    await f.client.watch('creator', false)
    expect(f.autoMod).toEqual([
      {
        type: 'hold',
        channelSlug: 'creator',
        messageId: 'held-message',
        displayName: 'Viewer',
        text: 'Held text',
        blockedTerm: true,
      },
      { type: 'resolve', channelSlug: 'creator', messageId: 'held-message' },
    ])
    await f.client.watch('creator', false)
    socket.message('notification', hold('creator'))
    expect(f.autoMod.at(-1)).toEqual({ type: 'clear', channelSlug: 'creator' })
    expect(f.autoMod).toHaveLength(3)
    f.client.stop()
    expect(f.autoMod.at(-1)).toEqual({ type: 'clear' })
  })

  test('shares one socket and refcounts channel subscriptions', async () => {
    const f = fixture()
    await f.client.watch('Creator', true)
    await f.client.watch('creator', true)
    expect(f.sockets).toHaveLength(1)
    required(f.sockets[0]).welcome()
    await settle()
    expect(f.registrations.sort()).toEqual(['session:creator', 'session:whispers'])
    await f.client.watch('creator', false)
    expect(f.removed).toHaveLength(0)
    await f.client.watch('creator', false)
    expect(f.removed).toEqual([['session:creator']])
    f.client.stop()
    expect(required(f.sockets[0]).closed).toBe(true)
  })

  test('deduplicates notifications and delivers typed activity and whisper data', async () => {
    const f = fixture()
    f.client.start()
    const socket = required(f.sockets[0])
    socket.welcome()
    socket.message(
      'notification',
      {
        subscription: { type: 'channel.poll.progress' },
        event: { broadcaster_user_id: '100', title: 'Question' },
      },
      'repeat',
    )
    socket.message(
      'notification',
      { subscription: { type: 'channel.poll.progress' }, event: { broadcaster_user_id: '100' } },
      'repeat',
    )
    socket.message('notification', {
      subscription: { type: 'user.whisper.message' },
      event: {
        whisper_id: 'w1',
        from_user_id: '200',
        from_user_login: 'friend',
        from_user_name: 'Friend',
        to_user_id: '100',
        whisper: { text: 'Hi' },
      },
    })
    expect(f.activities).toHaveLength(1)
    expect(f.activities[0]).toEqual({
      type: 'poll',
      channelId: '100',
      eventType: 'channel.poll.progress',
      data: { broadcaster_user_id: '100', title: 'Question' },
    })
    expect(f.whispers[0]).toEqual({
      id: 'w1',
      fromUserId: '200',
      fromLogin: 'friend',
      fromDisplayName: 'Friend',
      toUserId: '100',
      text: 'Hi',
      at: '2026-11-02T00:00:00Z',
    })
    f.client.stop()
    socket.message('notification', { subscription: { type: 'user.whisper.message' }, event: {} })
    expect(f.whispers).toHaveLength(1)
  })

  test('migrates to Twitch reconnect URL without resubscribing or losing the old socket early', async () => {
    const f = fixture()
    await f.client.watch('creator', true)
    const original = required(f.sockets[0])
    original.welcome()
    await settle()
    original.message('session_reconnect', {
      session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=secret' },
    })
    expect(original.closed).toBe(false)
    expect(f.sockets).toHaveLength(2)
    required(f.sockets[1]).welcome('migrated')
    expect(original.closed).toBe(true)
    await settle()
    expect(f.registrations).toHaveLength(2)
    expect(f.sockets).toHaveLength(2)
  })

  test('resubscribes after an ordinary dropped connection', async () => {
    const f = fixture()
    await f.client.watch('creator', true)
    required(f.sockets[0]).welcome('old')
    await settle()
    required(f.sockets[0]).close()
    await settle()
    expect(f.sockets).toHaveLength(2)
    required(f.sockets[1]).welcome('new')
    await settle()
    expect(f.registrations).toContain('new:creator')
    expect(f.registrations).toContain('new:whispers')
  })

  test('reports revoked authorization and rejects foreign reconnect endpoints', async () => {
    const f = fixture()
    f.client.start()
    required(f.sockets[0]).welcome()
    await settle()
    required(f.sockets[0]).message('revocation', {
      subscription: { id: 'session:whispers', status: 'authorization_revoked' },
    })
    expect(f.statuses.at(-1)?.message).toContain('authorization_revoked')
    required(f.sockets[0]).message('session_reconnect', {
      session: { reconnect_url: 'wss://attacker.example/ws' },
    })
    expect(f.sockets).toHaveLength(1)
    expect(f.statuses.at(-1)?.message).toContain('invalid reconnect URL')
  })

  test('does not connect without an account or reconnect after disposal', async () => {
    const f = fixture()
    f.setAccount(false)
    f.client.start()
    expect(f.sockets).toHaveLength(0)
    f.setAccount(true)
    f.client.start()
    expect(f.sockets).toHaveLength(1)
    f.client.stop()
    await settle()
    expect(f.sockets).toHaveLength(1)
  })

  test('cleans subscriptions that finish registering after a channel was closed', async () => {
    let finish:
      | ((value: {
          subscriptions: { id: string; type: string; condition: Record<string, string> }[]
          errors: string[]
        }) => void)
      | undefined
    const f = fixture({
      subscribe: async (_session, channel) =>
        channel
          ? new Promise((resolve) => {
              finish = resolve
            })
          : { subscriptions: [], errors: [] },
    })
    await f.client.watch('creator', true)
    required(f.sockets[0]).welcome()
    await f.client.watch('creator', false)
    required(finish)({
      subscriptions: [{ id: 'late', type: 'channel.poll.begin', condition: {} }],
      errors: [],
    })
    await settle()
    expect(f.removed).toEqual([['late']])
  })
})
