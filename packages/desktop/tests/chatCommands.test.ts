import { describe, expect, test } from 'bun:test'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { parseUserCardCommand, resolveUserCardCommand } from '../src/views/main/utils/chatCommands'

function createMessage(overrides: Partial<NormalizedChatMessage>): NormalizedChatMessage {
  return {
    id: 'msg-1',
    platform: 'twitch',
    channelId: 'channel-1',
    author: {
      id: 'user-1',
      username: 'satont',
      displayName: 'Satont',
      badges: [],
    },
    text: 'hello',
    emotes: [],
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    type: 'message',
    ...overrides,
  }
}

describe('parseUserCardCommand', () => {
  test('parses /user command query', () => {
    expect(parseUserCardCommand('/user @satont')).toBe('satont')
  })

  test('returns null for non-user command', () => {
    expect(parseUserCardCommand('/shrug')).toBeNull()
  })
})

describe('resolveUserCardCommand', () => {
  test('resolves an exact username match', () => {
    const result = resolveUserCardCommand('/user @satont', [createMessage({})])

    expect(result).toEqual({
      ok: true,
      target: {
        platform: 'twitch',
        platformUserId: 'user-1',
        displayName: 'Satont',
        username: 'satont',
        avatarUrl: undefined,
        currentAlias: undefined,
      },
    })
  })

  test('resolves an exact alias match', () => {
    const aliasMap = new Map([['twitch', new Map([['user-1', 'boss']])]])

    const result = resolveUserCardCommand('/user @boss', [createMessage({})], aliasMap)

    expect(result).toEqual({
      ok: true,
      target: {
        platform: 'twitch',
        platformUserId: 'user-1',
        displayName: 'Satont',
        username: 'satont',
        avatarUrl: undefined,
        currentAlias: 'boss',
      },
    })
  })

  test('returns not-found when no exact match exists', () => {
    expect(resolveUserCardCommand('/user @missing', [createMessage({})])).toEqual({
      ok: false,
      error: 'not-found',
    })
  })

  test('returns ambiguous when multiple users match the same query', () => {
    const result = resolveUserCardCommand('/user @satont', [
      createMessage({
        author: { id: 'user-1', username: 'satont', displayName: 'Satont', badges: [] },
      }),
      createMessage({
        id: 'msg-2',
        platform: 'kick',
        author: { id: 'user-2', username: 'satont', displayName: 'Satont', badges: [] },
      }),
    ])

    expect(result).toEqual({ ok: false, error: 'ambiguous' })
  })

  test('returns missing-query for /user without nickname', () => {
    expect(resolveUserCardCommand('/user', [createMessage({})])).toEqual({
      ok: false,
      error: 'missing-query',
    })
  })
})
