import { describe, expect, test } from 'bun:test'
import { createLocalTwitchSentMessage } from '@desktop/platforms/twitch/adapter'

describe('createLocalTwitchSentMessage', () => {
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
})
