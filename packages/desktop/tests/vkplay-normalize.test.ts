import { expect, test } from 'bun:test'

import {
  normalizeVkPlayMessage,
  vkPlayMessageSchema,
  vkPlayPublicationSchema,
} from '../src/platforms/vkplay/normalize'

test('normalizes a VK Play Live chat publication from the official websocket', () => {
  const publication = vkPlayPublicationSchema.parse({
    type: 'channel_chat_message_send',
    data: {
      chat_message: {
        author: {
          avatar_url: 'https://images.live.vkvideo.ru/user/1/avatar',
          badges: ['owner'],
          id: 1,
          is_moderator: true,
          is_owner: true,
          nick: 'streamer',
          nick_color: 0,
          roles: [{ id: 'moderator', name: 'Модератор' }],
        },
        created_at: 1_700_000_000,
        id: 42,
        parts: [
          { text: { content: 'Привет ' } },
          { link: { content: 'https://example.com', url: 'https://example.com' } },
          { text: { content: ' ' } },
          { mention: { content: '@friend' } },
          { smile: { content: ':)' } },
        ],
      },
    },
  })

  const normalized = normalizeVkPlayMessage(publication.data.chat_message, 'streamer')

  expect(normalized).toMatchObject({
    author: {
      avatarUrl: 'https://images.live.vkvideo.ru/user/1/avatar',
      badges: [
        { id: 'owner', text: 'owner', type: 'vkplay' },
        { id: 'moderator', text: 'Модератор', type: 'vkplay-role' },
      ],
      displayName: 'streamer',
      id: '1',
      username: 'streamer',
    },
    channelId: 'streamer',
    emotes: [],
    id: '42',
    platform: 'vkplay',
    text: 'Привет https://example.com @friend:)',
    timestamp: new Date(1_700_000_000_000),
    type: 'message',
  })
})

test('keeps smile artwork when VK includes it', () => {
  const message = vkPlayMessageSchema.parse({
    author: { id: 1, nick: 'streamer' },
    created_at: 1_700_000_000,
    id: 1,
    parts: [
      { text: { content: 'hi ' } },
      {
        smile: {
          animated: true,
          content: ':vk:',
          id: '123',
          mediumUrl: 'https://images.live.vkvideo.ru/smile/123',
          name: ':vk:',
        },
      },
    ],
  })

  expect(normalizeVkPlayMessage(message, 'streamer')).toMatchObject({
    emotes: [
      {
        animated: true,
        id: '123',
        imageUrl: 'https://images.live.vkvideo.ru/smile/123',
        name: ':vk:',
        positions: [{ end: 6, start: 3 }],
        source: 'channel',
      },
    ],
    text: 'hi :vk:',
  })
})

test('VK Play Live timestamps already in milliseconds stay unchanged', () => {
  const message = vkPlayMessageSchema.parse({
    author: { id: 1, nick: 'streamer' },
    created_at: 1_700_000_000_000,
    id: 1,
    parts: [],
  })
  expect(normalizeVkPlayMessage(message, 'streamer').timestamp.getTime()).toBe(1_700_000_000_000)
})
