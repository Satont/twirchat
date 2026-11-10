import { expect, test } from 'bun:test'

import { normalizeVkPlayMessage, vkPlayMessageSchema } from '../src/platforms/vkplay/normalize'

test('normalizes VK Play Live message parts, emotes, badges and replies', () => {
  const message = vkPlayMessageSchema.parse({
    author: {
      avatarUrl: 'https://images.live.vkvideo.ru/user/1/avatar',
      badges: [
        {
          id: 'owner',
          name: 'Владелец',
          smallUrl: 'https://images.live.vkvideo.ru/badge/owner',
        },
      ],
      displayName: 'Стример',
      hasAvatar: true,
      id: 1,
      nick: 'streamer',
      roles: [{ id: 'moderator', name: 'Модератор' }],
    },
    createdAt: 1_700_000_000,
    data: [
      { content: 'Привет ', type: 'text' },
      { id: '123', name: ':vk:', type: 'smile' },
      { content: ' ', type: 'text' },
      { nick: 'friend', id: 2, type: 'mention' },
    ],
    id: 42,
    parent: {
      author: { displayName: 'Зритель', id: 3, nick: 'viewer' },
      createdAt: 1_699_999_900,
      data: [{ content: 'Исходное', type: 'text' }],
      id: 41,
    },
  })

  const normalized = normalizeVkPlayMessage(message, 'streamer')

  expect(normalized).toMatchObject({
    author: {
      avatarUrl: 'https://images.live.vkvideo.ru/user/1/avatar',
      badges: [
        {
          id: 'owner',
          imageUrl: 'https://images.live.vkvideo.ru/badge/owner',
          text: 'Владелец',
          type: 'vkplay',
        },
        { id: 'moderator', text: 'Модератор', type: 'vkplay-role' },
      ],
      displayName: 'Стример',
      id: '1',
      username: 'streamer',
    },
    channelId: 'streamer',
    id: '42',
    platform: 'vkplay',
    text: 'Привет :vk: @friend',
    timestamp: new Date(1_700_000_000_000),
    type: 'message',
  })
  expect(normalized.emotes).toMatchObject([
    {
      id: '123',
      imageUrl: '',
      name: ':vk:',
      positions: [{ end: 10, start: 7 }],
      source: 'channel',
    },
  ])
  expect(normalized.reply).toEqual({
    parentAuthor: { displayName: 'Зритель', id: '3', username: 'viewer' },
    parentMessageId: '41',
    parentMessageText: 'Исходное',
  })
})

test('VK Play Live timestamps already in milliseconds stay unchanged', () => {
  const message = vkPlayMessageSchema.parse({
    author: { id: 1, nick: 'streamer' },
    createdAt: 1_700_000_000_000,
    data: [],
    id: 1,
  })
  expect(normalizeVkPlayMessage(message, 'streamer').timestamp.getTime()).toBe(1_700_000_000_000)
})
