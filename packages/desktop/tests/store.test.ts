import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getDb, initDb } from '@desktop/store/db'
import { AccountStore } from '@desktop/store/account-store'
import { MessageStore } from '@desktop/store/message-store'
import { SettingsStore } from '@desktop/store/settings-store'
import { UserAliasStore } from '@desktop/store/user-alias-store'
import { DEFAULT_SETTINGS, type NormalizedChatMessage } from '@twirchat/shared/types'
import { existsSync, unlinkSync } from 'node:fs'

const TEST_DB = '/tmp/twirchat-test.sqlite'

function createMessage(overrides: Partial<NormalizedChatMessage> = {}): NormalizedChatMessage {
  return {
    id: overrides.id ?? 'msg-default',
    platform: overrides.platform ?? 'twitch',
    channelId: overrides.channelId ?? 'channel-1',
    author: {
      id: overrides.author?.id ?? 'author-1',
      username: overrides.author?.username ?? 'author1',
      displayName: overrides.author?.displayName ?? 'Author One',
      color: overrides.author?.color,
      avatarUrl: overrides.author?.avatarUrl,
      badges: overrides.author?.badges ?? [],
    },
    text: overrides.text ?? 'hello',
    emotes: overrides.emotes ?? [],
    timestamp: overrides.timestamp ?? new Date('2024-01-01T00:00:00.000Z'),
    type: overrides.type ?? 'message',
    reply: overrides.reply,
  }
}

describe('Database', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
    initDb(TEST_DB)
  })

  afterEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
  })

  test('creates tables on init', () => {
    const db = getDb()
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name)

    expect(tables).toContain('accounts')
    expect(tables).toContain('settings')
    expect(tables).toContain('chat_messages')
  })
})

describe('AccountStore', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
    initDb(TEST_DB)
  })

  afterEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
  })

  test('upsert and findByPlatform', () => {
    AccountStore.upsert({
      accessToken: 'access_token_123',
      displayName: 'Test User',
      id: 'kick:12345',
      platform: 'kick',
      platformUserId: '12345',
      refreshToken: 'refresh_token_456',
      scopes: ['user:read', 'chat:write'],
      username: 'testuser',
    })

    const account = AccountStore.findByPlatform('kick')
    expect(account).not.toBeNull()
    expect(account!.username).toBe('testuser')
    expect(account!.displayName).toBe('Test User')
    expect(account!.platform).toBe('kick')
    expect(account!.scopes).toEqual(['user:read', 'chat:write'])
  })

  test('tokens are encrypted and decryptable', () => {
    AccountStore.upsert({
      accessToken: 'secret_access_token',
      displayName: 'Streamer',
      id: 'twitch:999',
      platform: 'twitch',
      platformUserId: '999',
      refreshToken: 'secret_refresh_token',
      username: 'streamer',
    })

    const tokens = AccountStore.getTokens('twitch:999')
    expect(tokens).not.toBeNull()
    expect(tokens!.accessToken).toBe('secret_access_token')
    expect(tokens!.refreshToken).toBe('secret_refresh_token')

    // Токены в БД должны быть зашифрованы (не равны исходным)
    const db = getDb()
    const raw = db
      .query<{ access_token: string }, [string]>('SELECT access_token FROM accounts WHERE id = ?')
      .get('twitch:999')
    expect(raw!.access_token).not.toBe('secret_access_token')
  })

  test('upsert updates existing account', () => {
    AccountStore.upsert({
      accessToken: 'old_token',
      displayName: 'User 1',
      id: 'kick:1',
      platform: 'kick',
      platformUserId: '1',
      username: 'user1',
    })

    AccountStore.upsert({
      accessToken: 'new_token',
      displayName: 'User 1 Updated',
      id: 'kick:1',
      platform: 'kick',
      platformUserId: '1',
      username: 'user1_updated',
    })

    const account = AccountStore.findByPlatform('kick')
    expect(account!.username).toBe('user1_updated')
  })

  test('delete account', () => {
    AccountStore.upsert({
      accessToken: 'token',
      displayName: 'Delete Me',
      id: 'kick:42',
      platform: 'kick',
      platformUserId: '42',
      username: 'deleteme',
    })

    AccountStore.delete('kick:42')
    expect(AccountStore.findByPlatform('kick')).toBeNull()
  })

  test('findAll returns all accounts', () => {
    AccountStore.upsert({
      accessToken: 'kick_token',
      displayName: 'Kick User',
      id: 'kick:1',
      platform: 'kick',
      platformUserId: '1',
      username: 'kick_user',
    })

    AccountStore.upsert({
      accessToken: 'twitch_token',
      displayName: 'Twitch User',
      id: 'twitch:2',
      platform: 'twitch',
      platformUserId: '2',
      username: 'twitch_user',
    })

    const all = AccountStore.findAll()
    expect(all.length).toBe(2)
  })
})

describe('SettingsStore', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
    initDb(TEST_DB)
  })

  afterEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
  })

  test('returns default settings when nothing saved', () => {
    const settings = SettingsStore.get()
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize)
  })

  test('update merges settings', () => {
    const updated = SettingsStore.update({ fontSize: 16, theme: 'light' })
    expect(updated.theme).toBe('light')
    expect(updated.fontSize).toBe(16)
    expect(updated.showPlatformIcon).toBe(DEFAULT_SETTINGS.showPlatformIcon)
  })

  test('get returns persisted settings', () => {
    SettingsStore.update({ theme: 'light' })
    const settings = SettingsStore.get()
    expect(settings.theme).toBe('light')
  })
})

describe('UserAliasStore', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
    initDb(TEST_DB)
  })

  afterEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
  })

  test('creates user_aliases table on init', () => {
    const db = getDb()
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name)

    expect(tables).toContain('user_aliases')
  })

  test('findAll returns empty array on fresh DB', () => {
    const aliases = UserAliasStore.findAll()
    expect(aliases).toEqual([])
  })

  test('upsert creates new alias', () => {
    UserAliasStore.upsert('twitch', 'user123', 'CoolStreamer')
    const aliases = UserAliasStore.findAll()
    expect(aliases.length).toBe(1)
    expect(aliases[0].platform).toBe('twitch')
    expect(aliases[0].platformUserId).toBe('user123')
    expect(aliases[0].alias).toBe('CoolStreamer')
  })

  test('upsert updates existing alias (same platform+userId)', () => {
    UserAliasStore.upsert('twitch', 'user123', 'OldAlias')
    UserAliasStore.upsert('twitch', 'user123', 'NewAlias')
    const aliases = UserAliasStore.findAll()
    expect(aliases.length).toBe(1)
    expect(aliases[0].alias).toBe('NewAlias')
  })

  test('remove deletes alias', () => {
    UserAliasStore.upsert('kick', 'user456', 'SomeAlias')
    UserAliasStore.remove('kick', 'user456')
    const aliases = UserAliasStore.findAll()
    expect(aliases.length).toBe(0)
  })

  test('findAll returns all aliases', () => {
    UserAliasStore.upsert('twitch', 'user1', 'Alias1')
    UserAliasStore.upsert('kick', 'user2', 'Alias2')
    UserAliasStore.upsert('youtube', 'user3', 'Alias3')
    const aliases = UserAliasStore.findAll()
    expect(aliases.length).toBe(3)
  })
})

describe('MessageStore', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
    initDb(TEST_DB)
  })

  afterEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
  })

  test('getByUser returns only selected platform user messages oldest-first', () => {
    MessageStore.save(
      createMessage({
        id: 'a1',
        platform: 'twitch',
        author: { id: 'user-1', username: 'alpha', displayName: 'Alpha', badges: [] },
        text: 'first',
        timestamp: new Date('2024-01-01T00:00:01.000Z'),
      }),
    )
    MessageStore.save(
      createMessage({
        id: 'a2',
        platform: 'twitch',
        author: { id: 'user-1', username: 'alpha', displayName: 'Alpha', badges: [] },
        text: 'second',
        timestamp: new Date('2024-01-01T00:00:02.000Z'),
      }),
    )
    MessageStore.save(
      createMessage({
        id: 'b1',
        platform: 'kick',
        author: { id: 'user-1', username: 'alpha', displayName: 'Alpha', badges: [] },
        text: 'other-platform',
        timestamp: new Date('2024-01-01T00:00:03.000Z'),
      }),
    )
    MessageStore.save(
      createMessage({
        id: 'c1',
        platform: 'twitch',
        author: { id: 'user-2', username: 'beta', displayName: 'Beta', badges: [] },
        text: 'other-user',
        timestamp: new Date('2024-01-01T00:00:04.000Z'),
      }),
    )

    const result = MessageStore.getByUser({
      platform: 'twitch',
      platformUserId: 'user-1',
      limit: 10,
    })

    expect(result.messages.map((message) => message.id)).toEqual(['a1', 'a2'])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toEqual({ createdAt: 1704067201000, id: 'a1' })
  })

  test('getByUser paginates older messages with stable cursor ordering', () => {
    MessageStore.save(
      createMessage({
        id: 'm1',
        author: { id: 'user-1', username: 'alpha', displayName: 'Alpha', badges: [] },
        text: 'one',
        timestamp: new Date('2024-01-01T00:00:01.000Z'),
      }),
    )
    MessageStore.save(
      createMessage({
        id: 'm2',
        author: { id: 'user-1', username: 'alpha', displayName: 'Alpha', badges: [] },
        text: 'two',
        timestamp: new Date('2024-01-01T00:00:02.000Z'),
      }),
    )
    MessageStore.save(
      createMessage({
        id: 'm3',
        author: { id: 'user-1', username: 'alpha', displayName: 'Alpha', badges: [] },
        text: 'three',
        timestamp: new Date('2024-01-01T00:00:03.000Z'),
      }),
    )

    const firstPage = MessageStore.getByUser({
      platform: 'twitch',
      platformUserId: 'user-1',
      limit: 2,
    })

    expect(firstPage.messages.map((message) => message.id)).toEqual(['m2', 'm3'])
    expect(firstPage.hasMore).toBe(true)
    expect(firstPage.nextCursor).toEqual({ createdAt: 1704067202000, id: 'm2' })

    const secondPage = MessageStore.getByUser({
      platform: 'twitch',
      platformUserId: 'user-1',
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    })

    expect(secondPage.messages.map((message) => message.id)).toEqual(['m1'])
    expect(secondPage.hasMore).toBe(false)
    expect(secondPage.nextCursor).toEqual({ createdAt: 1704067201000, id: 'm1' })
  })

  test('getByUser uses id as tie-breaker when timestamps match', () => {
    MessageStore.save(
      createMessage({
        id: 'a',
        author: { id: 'user-1', username: 'alpha', displayName: 'Alpha', badges: [] },
        timestamp: new Date('2024-01-01T00:00:05.000Z'),
      }),
    )
    MessageStore.save(
      createMessage({
        id: 'b',
        author: { id: 'user-1', username: 'alpha', displayName: 'Alpha', badges: [] },
        timestamp: new Date('2024-01-01T00:00:05.000Z'),
      }),
    )
    MessageStore.save(
      createMessage({
        id: 'c',
        author: { id: 'user-1', username: 'alpha', displayName: 'Alpha', badges: [] },
        timestamp: new Date('2024-01-01T00:00:05.000Z'),
      }),
    )

    const firstPage = MessageStore.getByUser({
      platform: 'twitch',
      platformUserId: 'user-1',
      limit: 2,
    })
    const secondPage = MessageStore.getByUser({
      platform: 'twitch',
      platformUserId: 'user-1',
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    })

    expect(firstPage.messages.map((message) => message.id)).toEqual(['b', 'c'])
    expect(secondPage.messages.map((message) => message.id)).toEqual(['a'])
  })

  test('getByUser skips malformed rows safely', () => {
    MessageStore.save(
      createMessage({
        id: 'valid-1',
        author: { id: 'user-1', username: 'alpha', displayName: 'Alpha', badges: [] },
        timestamp: new Date('2024-01-01T00:00:01.000Z'),
      }),
    )

    const db = getDb()
    db.run(
      `INSERT OR REPLACE INTO chat_messages (id, platform, channel_id, author_id, author_name, text, type, created_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['broken', 'twitch', 'channel-1', 'user-1', 'Alpha', 'bad', 'message', 1704067202000, '{'],
    )

    const result = MessageStore.getByUser({
      platform: 'twitch',
      platformUserId: 'user-1',
      limit: 10,
    })

    expect(result.messages.map((message) => message.id)).toEqual(['valid-1'])
  })
})
