import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import {
  defaultChatLoggingSettings,
  exportChatHistory,
  flushChatLogs,
  getChatHistory,
  getChatLoggingSettings,
  recordChatMessage,
  saveChatLoggingSettings,
} from '../src/gpuix/backend/chat-history'
import { getDb, initDb } from '../src/store/db'
import { MessageStore, type ChatHistoryQuery } from '../src/store/message-store'
import { required } from './fixture-values'

function message(
  id: string,
  overrides: Partial<NormalizedChatMessage> = {},
): NormalizedChatMessage {
  return {
    id,
    platform: 'twitch',
    channelId: 'channel',
    author: { id: 'author', username: 'alice', displayName: 'Алиса', badges: [] },
    text: `ПРИВЕТ Мир ${id}`,
    timestamp: new Date('2026-11-01T12:00:00Z'),
    type: 'message',
    emotes: [],
    ...overrides,
  }
}
let directory = ''
let databases: Database[] = []
function setup(path = join(directory, 'db.sqlite')) {
  const database = initDb(path)
  databases.push(database)
  return database
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'twirchat-history-'))
  databases = []
})
afterEach(async () => {
  try {
    await flushChatLogs()
  } catch {}
  for (const database of databases) database.close()
  rmSync(directory, { recursive: true, force: true })
})

function legacy(path: string, dataColumn = true): void {
  const database = new Database(path)
  database.run(
    `CREATE TABLE chat_messages (id TEXT PRIMARY KEY, platform TEXT NOT NULL, channel_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL, text TEXT NOT NULL, type TEXT NOT NULL, created_at INTEGER NOT NULL${dataColumn ? ', data TEXT' : ''})`,
  )
  const original = message('legacy', { metadata: { firstMessage: true, bits: 50 } })
  database.run(
    `INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?${dataColumn ? ', ?' : ''})`,
    [
      'legacy',
      'twitch',
      'channel',
      'author',
      'Алиса',
      original.text,
      'message',
      original.timestamp.getTime(),
      ...(dataColumn ? [JSON.stringify(original)] : []),
    ],
  )
  database.close()
}

describe('durable chat history', () => {
  test('migrates old identity keys atomically while preserving provider metadata', () => {
    const path = join(directory, 'legacy.sqlite')
    legacy(path)
    const database = setup(path)
    const primary = database
      .query<{ name: string; pk: number }, []>('PRAGMA table_info(chat_messages)')
      .all()
      .filter((column) => column.pk)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name)
    expect(primary).toEqual(['platform', 'channel_id', 'id'])
    expect(MessageStore.getRecent()[0]?.metadata).toEqual({ firstMessage: true, bits: 50 })
    MessageStore.save(message('legacy', { platform: 'kick' }))
    MessageStore.save(message('legacy', { channelId: 'another' }))
    expect(MessageStore.getRecent()).toHaveLength(3)
  })

  test('migrates pre-JSON history without losing its stored text', () => {
    const path = join(directory, 'oldest.sqlite')
    legacy(path, false)
    setup(path)
    expect(MessageStore.getRecent()[0]).toMatchObject({
      id: 'legacy',
      text: 'ПРИВЕТ Мир legacy',
      author: { displayName: 'Алиса' },
    })
  })

  test('a migration failure rolls back without replacing the old history table', () => {
    const path = join(directory, 'rollback.sqlite')
    legacy(path, false)
    const blocker = new Database(path)
    blocker.run('CREATE TABLE chat_messages_composite (blocked INTEGER)')
    blocker.close()
    expect(() => initDb(path)).toThrow()
    const verify = new Database(path)
    expect(
      verify.query<{ total: number }, []>('SELECT COUNT(*) AS total FROM chat_messages').get()
        ?.total,
    ).toBe(1)
    expect(
      verify
        .query<{ name: string }, []>('PRAGMA table_info(chat_messages)')
        .all()
        .some((column) => column.name === 'data'),
    ).toBe(false)
    verify.close()
  })

  test('retains the newest exact count even when every timestamp is identical', () => {
    const database = setup()
    MessageStore.saveMany(
      Array.from({ length: 1200 }, (_, index) => message(`m-${String(index).padStart(4, '0')}`)),
      { maxMessages: 1000 },
    )
    expect(
      database.query<{ total: number }, []>('SELECT COUNT(*) AS total FROM chat_messages').get()
        ?.total,
    ).toBe(1000)
    expect(MessageStore.getRecent(500)[0]?.id).toBe('m-0700')
    expect(() => MessageStore.getRecent(Number.NaN)).toThrow('integer')
    expect(MessageStore.getRecent(500000)).toHaveLength(500)
  })

  test('leaves pruning to the caller when a save skips it', () => {
    const database = setup()
    const messages = Array.from({ length: 5 }, (_, index) => message(`skip-${index}`))
    MessageStore.saveMany(messages, { maxMessages: 2 }, database, false)
    const total = () =>
      database.query<{ total: number }, []>('SELECT COUNT(*) AS total FROM chat_messages').get()
        ?.total
    expect(total()).toBe(5)
    MessageStore.saveMany([message('skip-5')], { maxMessages: 2 }, database)
    expect(total()).toBe(2)
  })

  test('applies configured age retention independently of the message count', () => {
    setup()
    MessageStore.saveMany(
      [
        message('old', { timestamp: new Date(Date.now() - 3 * 86_400_000) }),
        message('recent', { timestamp: new Date() }),
      ],
      { maxMessages: 100, maxAgeDays: 1 },
    )
    expect(MessageStore.getRecent().map((entry) => entry.id)).toEqual(['recent'])
  })

  test('composite cursors paginate repeated provider IDs across channels and platforms', () => {
    setup()
    MessageStore.saveMany([
      message('same'),
      message('same', { channelId: 'second' }),
      message('same', { platform: 'kick' }),
    ])
    let cursor: ChatHistoryQuery['cursor']
    const identities: string[] = []
    do {
      const page = MessageStore.search({ limit: 1, cursor })
      identities.push(
        ...page.messages.map((entry) => `${entry.platform}:${entry.channelId}:${entry.id}`),
      )
      cursor = page.hasMore ? (page.nextCursor ?? undefined) : undefined
    } while (cursor)
    expect(new Set(identities).size).toBe(3)
    const first = MessageStore.getByUser({ platform: 'twitch', platformUserId: 'author', limit: 1 })
    const second = MessageStore.getByUser({
      platform: 'twitch',
      platformUserId: 'author',
      limit: 1,
      cursor: required(first.nextCursor),
    })
    expect(first.messages[0]?.channelId).not.toBe(second.messages[0]?.channelId)
    expect(second.hasMore).toBe(false)
  })

  test('searches literal Unicode text, authors, channel and inclusive dates without SQL interpolation', () => {
    setup()
    MessageStore.saveMany([
      message('first'),
      message('second', { platform: 'kick', timestamp: new Date('2026-11-02T12:00:00Z') }),
    ])
    expect(
      MessageStore.search({
        text: 'привет',
        author: 'АЛИСА',
        platform: 'twitch',
        channelId: 'channel',
      }).messages.map((entry) => entry.id),
    ).toEqual(['first'])
    expect(MessageStore.search({ author: 'ALICE' }).messages).toHaveLength(2)
    expect(MessageStore.search({ text: "' OR 1=1 --" }).messages).toEqual([])
    expect(
      MessageStore.search({
        since: Date.parse('2026-11-02T12:00:00Z'),
        until: Date.parse('2026-11-02T12:00:00Z'),
      }).messages.map((entry) => entry.id),
    ).toEqual(['second'])
    expect(() => MessageStore.search({ since: 10, until: 1 })).toThrow('start date')
    expect(() => MessageStore.search({ since: Number.NaN })).toThrow('timestamps')
  })

  test('user history only matches user IDs and damaged rows cannot hide older pages', () => {
    const database = setup()
    const messages = Array.from({ length: 110 }, (_, index) =>
      message(`m-${String(index).padStart(3, '0')}`),
    )
    MessageStore.saveMany(messages)
    database.transaction(() => {
      for (let index = 0; index < 150; index += 1)
        database.run(
          'INSERT INTO chat_messages (id,platform,channel_id,author_id,author_name,text,type,created_at,data) VALUES (?,?,?,?,?,?,?,?,?)',
          [
            `z-${index}`,
            'twitch',
            'channel',
            'author',
            'broken',
            '',
            'message',
            required(messages[0]).timestamp.getTime(),
            '{',
          ],
        )
    })()
    const first = MessageStore.getByUser({
      platform: 'twitch',
      platformUserId: 'author',
      limit: 100,
    })
    expect(first.messages).toHaveLength(100)
    expect(first.hasMore).toBe(true)
    expect(
      MessageStore.getByUser({
        platform: 'twitch',
        platformUserId: 'author',
        cursor: required(first.nextCursor),
      }).messages,
    ).toHaveLength(10)
    MessageStore.save(
      message('different-author', { author: { id: 'other', displayName: 'author', badges: [] } }),
    )
    expect(
      MessageStore.getByUser({ platform: 'twitch', platformUserId: 'author' }).messages.some(
        (entry) => entry.id === 'different-author',
      ),
    ).toBe(false)
  })

  test('recording coalesces persistence, deduplicates shared events and restores saved retention settings', async () => {
    setup()
    const settings = {
      ...defaultChatLoggingSettings(),
      directory: join(directory, 'logs'),
      maxMessages: 20,
    }
    await saveChatLoggingSettings(settings)
    const incoming = message('queued')
    recordChatMessage(incoming)
    recordChatMessage(incoming)
    expect(
      getDb().query<{ total: number }, []>('SELECT COUNT(*) AS total FROM chat_messages').get()
        ?.total,
    ).toBe(0)
    expect((await getChatHistory({})).messages).toHaveLength(1)
    const reloaded = setup()
    expect(await getChatLoggingSettings()).toEqual(settings)
    expect(
      reloaded.query<{ total: number }, []>('SELECT COUNT(*) AS total FROM chat_messages').get()
        ?.total,
    ).toBe(1)
  })

  test('enabled recording writes watched-source history and one file line per provider identity', async () => {
    setup()
    const settings = {
      ...defaultChatLoggingSettings(),
      enabled: true,
      directory: join(directory, 'logs'),
    }
    await saveChatLoggingSettings(settings)
    const incoming = message('watched', { channelId: 'watched-channel' })
    recordChatMessage(incoming)
    recordChatMessage({ ...incoming })
    await flushChatLogs()
    expect((await getChatHistory({ channelId: 'watched-channel' })).messages).toHaveLength(1)
    const paths = await Array.fromAsync(new Bun.Glob('**/*.log').scan({ cwd: settings.directory }))
    expect(paths).toHaveLength(1)
    expect(
      (await Bun.file(join(settings.directory, required(paths[0]))).text()).trim().split('\n'),
    ).toHaveLength(1)
  })

  test('streams chronological transcript exports across multiple pages and never overwrites a file', async () => {
    setup()
    MessageStore.saveMany(
      Array.from({ length: 620 }, (_, index) =>
        message(`m-${String(index).padStart(3, '0')}`, {
          timestamp: new Date(1_800_000_000_000 + index),
        }),
      ),
    )
    const path = join(directory, 'export', 'transcript.txt')
    expect(await exportChatHistory({ query: {}, path })).toEqual({ path, count: 620 })
    const lines = (await Bun.file(path).text()).trim().split('\n')
    expect(lines).toHaveLength(620)
    expect(lines[0]).toEndWith('m-000')
    expect(lines.at(-1)).toEndWith('m-619')
    await expect(exportChatHistory({ query: {}, path })).rejects.toThrow('already exists')
    await expect(exportChatHistory({ query: {}, path: 'relative.txt' })).rejects.toThrow('absolute')
  })
})
