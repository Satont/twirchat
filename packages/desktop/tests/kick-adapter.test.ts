import { describe, expect, test } from 'bun:test'
import { normalizeKickChatMessage, type KickChatMessage } from '@desktop/platforms/kick/adapter'

function createKickMessage(overrides: Partial<KickChatMessage> = {}): KickChatMessage {
  return {
    chatroom_id: 77,
    content: 'hello [emote:37232:PeepoClap] world',
    created_at: '2026-05-10T12:00:00.000Z',
    id: 'kick-msg-1',
    sender: {
      id: 42,
      identity: {
        badges: [{ text: 'MOD', type: 'moderator' }],
        color: '#53fc18',
      },
      profile_picture: undefined,
      slug: 'satont',
      username: 'Satont',
    },
    type: 'message',
    ...overrides,
  }
}

describe('normalizeKickChatMessage', () => {
  test('fills avatarUrl via resolver and preserves normalized kick fields', async () => {
    const normalized = await normalizeKickChatMessage(
      createKickMessage(),
      3132057,
      async (input) => {
        expect(input).toEqual({
          authorId: '42',
          lookupSource: 'slug',
          profilePicture: undefined,
          slugOrUsername: 'satont',
        })

        return 'https://files.kick.com/images/user/42/profile.webp'
      },
    )

    expect(normalized.author.avatarUrl).toBe('https://files.kick.com/images/user/42/profile.webp')
    expect(normalized.author.displayName).toBe('Satont')
    expect(normalized.author.id).toBe('42')
    expect(normalized.author.username).toBe('Satont')
    expect(normalized.channelId).toBe('3132057')
    expect(normalized.platform).toBe('kick')
    expect(normalized.text).toBe('hello PeepoClap world')
    expect(normalized.emotes).toEqual([
      {
        id: '37232',
        imageUrl: 'https://files.kick.com/emotes/37232/fullsize',
        name: 'PeepoClap',
        positions: [{ start: 6, end: 14 }],
      },
    ])
  })

  test('preserves reply metadata and falls back to chatroom id when broadcaster id is absent', async () => {
    const normalized = await normalizeKickChatMessage(
      createKickMessage({
        content: 'reply body',
        metadata: {
          original_message: {
            content: 'parent text',
            id: 'parent-1',
          },
          original_sender: {
            id: '100',
            username: 'OtherUser',
          },
        },
        type: 'reply',
      }),
      null,
      async () => undefined,
    )

    expect(normalized.author.avatarUrl).toBeUndefined()
    expect(normalized.channelId).toBe('77')
    expect(normalized.reply).toEqual({
      parentAuthor: {
        displayName: 'OtherUser',
        id: '100',
        username: 'OtherUser',
      },
      parentMessageId: 'parent-1',
      parentMessageText: 'parent text',
    })
  })
})
