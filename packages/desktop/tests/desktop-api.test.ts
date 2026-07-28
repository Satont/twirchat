import { expect, test } from 'bun:test'

import { createDesktopApi, createRpcFacade } from '../src/views/main/services/desktop-api'

test('serializes legacy request names and arguments through the Wails gateway', async () => {
  let receivedRequest: unknown
  const api = createDesktopApi({
    Call: async (request) => {
      receivedRequest = request
      return undefined
    },
    Capabilities: async () => ({ updates: false }),
  })

  await api.request.sendMessage({
    platform: 'twitch',
    channelId: 'channel-1',
    text: 'hello',
    replyToMessageId: 'message-1',
  })

  expect(receivedRequest).toEqual({
    method: 'sendMessage',
    params: {
      platform: 'twitch',
      channelId: 'channel-1',
      text: 'hello',
      replyToMessageId: 'message-1',
    },
  })
})

test('serializes chatters requests with all targets through the Wails gateway', async () => {
  let receivedRequest: unknown
  const api = createDesktopApi({
    Call: async (request) => {
      receivedRequest = request
      return undefined
    },
    Capabilities: async () => ({ updates: false }),
  })

  await api.request.getChatters({
    targets: [
      { platform: 'twitch', channelSlug: 'streamer' },
      { platform: 'kick', channelSlug: 'kicker' },
    ],
  })

  expect(receivedRequest).toEqual({
    method: 'getChatters',
    params: {
      targets: [
        { platform: 'twitch', channelSlug: 'streamer' },
        { platform: 'kick', channelSlug: 'kicker' },
      ],
    },
  })
})

test('returns per-channel chatters results unchanged from the Wails gateway', async () => {
  const chattersResponse = {
    results: [
      {
        platform: 'twitch',
        channelSlug: 'streamer',
        total: 2,
        groups: [
          {
            role: 'broadcaster',
            users: [{ userId: 'user-1', username: 'streamer', displayName: 'Streamer' }],
          },
          {
            role: 'chatters',
            users: [{ username: 'viewer', displayName: 'Viewer', avatarUrl: 'avatar.webp' }],
          },
        ],
      },
      {
        platform: 'kick',
        channelSlug: 'kicker',
        total: 0,
        groups: [],
        error: 'Reconnect Kick to read chatters.',
      },
    ],
  }
  const api = createDesktopApi({
    Call: async (request) => {
      if (request.method === 'getChatters') {
        return chattersResponse
      }
      return undefined
    },
    Capabilities: async () => ({ updates: false }),
  })

  const result = await api.request.getChatters({
    targets: [
      { platform: 'twitch', channelSlug: 'streamer' },
      { platform: 'kick', channelSlug: 'kicker' },
    ],
  })

  expect(result).toBe(chattersResponse)
})

test('preserves chatters request rejections from the Wails binding', async () => {
  const unavailable = new Error(
    'desktop request "getChatters" is unavailable: service has not been ported',
  )
  const api = createDesktopApi({
    Call: async () => Promise.reject(unavailable),
    Capabilities: async () => ({ updates: false }),
  })

  await expect(
    api.request.getChatters({ targets: [{ platform: 'twitch', channelSlug: 'streamer' }] }),
  ).rejects.toBe(unavailable)
})

test('converts ISO timestamps to Date for chat and history responses', async () => {
  const api = createDesktopApi({
    Call: async (request) => {
      if (request.method === 'getRecentMessages') {
        return [chatMessage('message-1')]
      }
      if (request.method === 'getUserChatHistory') {
        return {
          messages: [chatMessage('message-2')],
          nextCursor: null,
          hasMore: false,
        }
      }
      return undefined
    },
    Capabilities: async () => ({ updates: false }),
  })

  const messages = await api.request.getRecentMessages({})
  const history = await api.request.getUserChatHistory({
    platform: 'twitch',
    platformUserId: 'viewer-1',
  })

  expect(messages[0]?.timestamp).toBeInstanceOf(Date)
  expect(messages[0]?.timestamp.toISOString()).toBe('2026-07-12T14:30:00.000Z')
  expect(history.messages[0]?.timestamp).toBeInstanceOf(Date)
})

test('preserves unavailable request rejections from the Wails binding', async () => {
  const unavailable = new Error(
    'desktop request "getAccounts" is unavailable: service has not been ported',
  )
  const api = createDesktopApi({
    Call: async () => Promise.reject(unavailable),
    Capabilities: async () => ({ updates: false }),
  })

  await expect(api.request.getAccounts()).rejects.toBe(unavailable)
})

test('exposes the disabled update capability', async () => {
  const api = createDesktopApi({
    Call: async () => undefined,
    Capabilities: async () => ({ updates: false }),
  })

  await expect(api.capabilities()).resolves.toEqual({ updates: false })
})

test('returns source-tagged channel emotes from the Wails gateway', async () => {
  const api = createDesktopApi({
    Call: async (request) => {
      if (request.method === 'getChannelEmotes') {
        return [
          {
            id: '7tv-1',
            alias: 'чё',
            name: 'чё',
            imageUrl: 'https://cdn.test/7tv.webp',
            animated: false,
            zeroWidth: false,
            aspectRatio: 1,
            source: 'seventv',
          },
        ]
      }
      return undefined
    },
    Capabilities: async () => ({ updates: false }),
  })

  const emotes = await api.request.getChannelEmotes({ platform: 'kick', channelId: 'channel-1' })

  expect(emotes[0]?.source).toBe('seventv')
})

test('preserves legacy message listener registration and removal', () => {
  let listener: ((payload: { id: string }) => void) | undefined
  let cleanedUp = false
  const api = createDesktopApi({
    Call: async () => undefined,
    Capabilities: async () => ({ updates: false }),
  })
  const rpc = createRpcFacade(api, {
    on: (_eventName, handler) => {
      listener = handler as (payload: { id: string }) => void
      return () => {
        cleanedUp = true
      }
    },
  })
  let received: string | undefined
  const handler = (payload: { id: string }) => {
    received = payload.id
  }

  rpc.addMessageListener('chat_message', handler)
  listener?.({ id: 'message-1' })
  rpc.removeMessageListener('chat_message', handler)

  expect(received).toBe('message-1')
  expect(cleanedUp).toBe(true)
})

test('releases an existing listener before registering the same handler again', () => {
  const cleanups: Array<() => void> = []
  const api = createDesktopApi({
    Call: async () => undefined,
    Capabilities: async () => ({ updates: false }),
  })
  const rpc = createRpcFacade(api, {
    on: () => {
      const cleanup = () => {
        cleanups.push(cleanup)
      }
      return cleanup
    },
  })
  const handler = () => {}

  rpc.addMessageListener('chat_message', handler)
  rpc.addMessageListener('chat_message', handler)

  expect(cleanups).toHaveLength(1)
})

function chatMessage(id: string) {
  return {
    id,
    platform: 'twitch',
    channelId: 'channel-1',
    author: {
      id: 'viewer-1',
      displayName: 'Viewer',
      badges: [],
    },
    text: 'hello',
    emotes: [],
    timestamp: '2026-07-12T14:30:00.000Z',
    type: 'message',
  }
}
