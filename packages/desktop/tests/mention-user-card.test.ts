import { describe, expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { resolveMentionUser } from '../src/services/mention-user'
import { resolveMentionTarget } from '../src/views/main/utils/mention-user-card'

function message(partial: Partial<NormalizedChatMessage> = {}): NormalizedChatMessage {
  return {
    id: 'source-message',
    platform: 'twitch',
    channelId: 'source-channel',
    type: 'message',
    timestamp: new Date(0),
    text: '@viewer',
    emotes: [],
    author: {
      id: 'sender-id',
      username: 'sender',
      displayName: 'Sender',
      badges: [],
      avatarUrl: 'sender-avatar',
    },
    ...partial,
  }
}

describe('mention user identity', () => {
  test('uses a real local ID from the same platform and preserves the source channel only', async () => {
    let lookups = 0
    const target = await resolveMentionTarget({
      message: message(),
      username: 'VIEWER',
      channelSlug: 'streamer',
      accounts: [],
      messages: [
        message({
          platform: 'kick',
          author: { id: 'wrong-platform', username: 'viewer', displayName: 'Wrong', badges: [] },
        }),
        message({
          channelId: 'another-channel',
          author: {
            id: 'viewer-id',
            username: 'viewer',
            displayName: 'Viewer',
            badges: [],
            avatarUrl: 'viewer-avatar',
          },
        }),
      ],
      resolveUser: async () => {
        lookups++
        return null
      },
    })
    expect(target).toEqual({
      platform: 'twitch',
      platformUserId: 'viewer-id',
      username: 'viewer',
      displayName: 'Viewer',
      avatarUrl: 'viewer-avatar',
      channelId: 'source-channel',
      channelSlug: 'streamer',
    })
    expect(target.messageId).toBeUndefined()
    expect(lookups).toBe(0)
  })

  test('uses reply author identity without borrowing the replying sender', async () => {
    const target = await resolveMentionTarget({
      message: message({
        reply: {
          parentMessageId: 'parent-message',
          parentMessageText: 'hello',
          parentAuthor: { id: 'reply-user-id', username: 'viewer', displayName: 'Viewer' },
        },
      }),
      username: 'viewer',
      accounts: [],
      messages: [],
      resolveUser: async () => null,
    })
    expect(target.platformUserId).toBe('reply-user-id')
    expect(target.avatarUrl).toBeUndefined()
    expect(target.messageId).toBeUndefined()
  })

  test('resolves an unseen user remotely instead of passing their login as an ID', async () => {
    const calls: string[] = []
    const target = await resolveMentionTarget({
      message: message(),
      username: 'unknown',
      accounts: [],
      messages: [],
      resolveUser: async (input) => {
        calls.push(`${input.platform}:${input.username}`)
        return { platformUserId: '456', displayName: 'Unknown', username: 'unknown' }
      },
    })
    expect(calls).toEqual(['twitch:unknown'])
    expect(target.platformUserId).toBe('456')
    expect(target.messageId).toBeUndefined()
  })

  test('reports an unknown user without opening the sender card', async () => {
    await expect(
      resolveMentionTarget({
        message: message(),
        username: 'missing',
        accounts: [],
        messages: [],
        resolveUser: async () => null,
      }),
    ).rejects.toThrow('Could not find @missing on twitch.')
  })

  test('parses Twitch login identity and missing users at the network boundary', async () => {
    const paths: string[] = []
    const user = await resolveMentionUser({ platform: 'twitch', username: '123' }, async (path) => {
      paths.push(path)
      return Response.json({
        user: {
          id: '456',
          login: '123',
          display_name: 'Numeric login',
          profile_image_url: 'avatar',
        },
      })
    })
    expect(paths).toEqual(['/api/twitch/user?login=123'])
    expect(user).toEqual({
      platformUserId: '456',
      username: '123',
      displayName: 'Numeric login',
      avatarUrl: 'avatar',
    })
    await expect(
      resolveMentionUser({ platform: 'twitch', username: 'missing' }, async () =>
        Response.json({ user: null }),
      ),
    ).resolves.toBeNull()
    await expect(
      resolveMentionUser({ platform: 'twitch', username: 'invalid' }, async () =>
        Response.json({ user: { id: 'login', login: 'invalid' } }),
      ),
    ).rejects.toThrow()
  })

  test('preserves every badge from a matched message author', async () => {
    const badges = [
      { id: 'moderator/1', type: 'moderator', text: 'Moderator' },
      { id: 'subscriber/12', type: 'subscriber', text: 'Subscriber' },
      { id: '7tv/1', type: 'seventv', text: '7TV' },
    ]
    const target = await resolveMentionTarget({
      message: message(),
      username: 'viewer',
      accounts: [],
      messages: [
        message({
          author: { id: 'viewer-id', username: 'viewer', displayName: 'Viewer', badges },
        }),
      ],
      resolveUser: async () => null,
    })
    expect(target.badges).toEqual(badges)
  })

  test('uses Kick broadcaster user ID, not chatroom ID, and retains API errors', async () => {
    const user = await resolveMentionUser(
      { platform: 'kick', username: 'viewer' },
      async (path) => {
        expect(path).toBe('/api/kick/chatroom?slug=viewer')
        return Response.json({ broadcasterUserId: 42, chatroomId: 99, avatarUrl: 'kick-avatar' })
      },
    )
    expect(user).toEqual({
      platformUserId: '42',
      username: 'viewer',
      displayName: 'viewer',
      avatarUrl: 'kick-avatar',
    })
    await expect(
      resolveMentionUser(
        { platform: 'kick', username: 'viewer' },
        async () => new Response('', { status: 503 }),
      ),
    ).rejects.toThrow('Could not look up @viewer (503).')
  })

  test('resolves YouTube handles to stable channel IDs and preserves the public handle', async () => {
    const channelId = 'UCabcdefghijklmnopqrstuv'
    const user = await resolveMentionUser(
      { platform: 'youtube', username: 'Viewer' },
      async (path) => {
        expect(path).toBe('/api/youtube/resolve?handle=Viewer')
        return Response.json({ channelId })
      },
    )
    expect(user).toEqual({ platformUserId: channelId, username: '@Viewer', displayName: 'Viewer' })
    await expect(
      resolveMentionUser(
        { platform: 'youtube', username: 'missing' },
        async () => new Response('', { status: 404 }),
      ),
    ).resolves.toBeNull()
    await expect(
      resolveMentionUser({ platform: 'youtube', username: 'missing' }, async () =>
        Response.json({ channelId: null }),
      ),
    ).resolves.toBeNull()
    await expect(
      resolveMentionUser({ platform: 'youtube', username: 'UCbad' }, async () =>
        Response.json({ channelId: 'UCbad' }),
      ),
    ).rejects.toThrow()
  })

  test('matches a connected YouTube handle with its leading @ without guessing display names', async () => {
    let lookups = 0
    const target = await resolveMentionTarget({
      message: message({ platform: 'youtube' }),
      username: 'VIEWER',
      messages: [],
      accounts: [
        {
          id: 'youtube-account',
          platform: 'youtube',
          platformUserId: 'UCabcdefghijklmnopqrstuv',
          username: '@Viewer',
          displayName: 'My channel',
          scopes: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      resolveUser: async () => {
        lookups++
        return null
      },
    })
    expect(target.platformUserId).toBe('UCabcdefghijklmnopqrstuv')
    expect(target.username).toBe('@Viewer')
    expect(lookups).toBe(0)
    await expect(
      resolveMentionTarget({
        message: message({
          platform: 'youtube',
          author: { id: 'UCabcdefghijklmnopqrstuv', displayName: 'viewer', badges: [] },
        }),
        username: 'viewer',
        accounts: [],
        messages: [],
        resolveUser: async () => null,
      }),
    ).rejects.toThrow('Could not find @viewer on youtube.')
  })
})
