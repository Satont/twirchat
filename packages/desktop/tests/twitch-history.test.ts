import type { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chatMessageIdentity } from '@twirchat/shared/message-identity'
import type { Badge, NormalizedChatMessage } from '@twirchat/shared/types'

import {
  defaultChatLoggingSettings,
  saveChatLoggingSettings,
  flushChatLogs,
} from '../src/gpuix/backend/chat-history'
import { createTwitchHistoryRuntime, mergeHistoryPage } from '../src/gpuix/backend/twitch-history'
import { parseTwitchBadgeCatalog } from '../src/platforms/twitch/badge-data'
import { createTwitchHistoryClient, parseTwitchHistoryLine } from '../src/services/twitch-history'
import { getDb, initDb } from '../src/store/db'
import { MessageStore } from '../src/store/message-store'

const time = Date.parse('2026-11-03T01:00:00Z')
const raw = (id: string, text = 'same', extra = '') =>
  `@id=${id};tmi-sent-ts=${time};user-id=42;display-name=Alice;badges=broadcaster/1;color=#abcdef;${extra} :alice!alice@alice.tmi.twitch.tv PRIVMSG #channel :${text}`
const source = { id: 'one', kind: 'recent', status: 'ok', messages: 1, capabilities: ['recent'] }
const response = (messages: string[]) =>
  Response.json({ messages, sources: [source], partial: false, truncated: false })
const emptyBadges = async () => new Map<string, Badge>()
let database: Database | undefined
let directory: string | undefined
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  if (database) {
    await flushChatLogs()
    database.close()
    database = undefined
  }
  if (directory) {
    await rm(directory, { recursive: true, force: true })
    directory = undefined
  }
})
async function setup() {
  directory = await mkdtemp(join(tmpdir(), 'twirchat-external-history-'))
  database = initDb(join(directory, 'db.sqlite'))
  return database
}
function message(id: string, text = 'same'): NormalizedChatMessage {
  const parsed = parseTwitchHistoryLine(raw(id, text), 'channel')
  if (!parsed) throw new Error('Invalid history fixture')
  return parsed
}

test('history uses Twitch IRC metadata, canonical IDs, badges, emotes and replies', () => {
  const parsed = parseTwitchHistoryLine(
    raw(
      'a',
      '😀 Kappa',
      'emotes=25:2-6;reply-parent-msg-id=parent;reply-parent-user-id=9;reply-parent-user-login=bob;reply-parent-msg-body=hello;',
    ),
    'channel',
    parseTwitchBadgeCatalog({ badges: { 'broadcaster/1': 'https://badge/image' } }),
  )
  expect(parsed).toMatchObject({
    id: 'a',
    channelId: 'channel',
    text: '😀 Kappa',
    author: {
      id: '42',
      username: 'alice',
      color: '#abcdef',
      badges: [{ imageUrl: 'https://badge/image' }],
    },
    reply: { parentMessageId: 'parent', parentAuthor: { id: '9' } },
  })
  expect(parsed?.emotes[0]?.positions).toEqual([{ start: 3, end: 7 }])
  expect(parsed?.timestamp.getTime()).toBe(time)
  expect(
    parseTwitchHistoryLine(raw('action', '\u0001ACTION waves\u0001'), 'channel'),
  ).toMatchObject({ type: 'action', text: 'waves' })
  const action = parseTwitchHistoryLine(
    raw('action-emote', '\u0001ACTION Kappa\u0001', 'emotes=25:0-4;'),
    'channel',
  )
  expect(action?.emotes[0]).toMatchObject({ name: 'Kappa', positions: [{ start: 0, end: 4 }] })
})

test('malformed, idless, deleted and foreign-channel lines never become synthetic chat rows', () => {
  for (const line of [
    'invalid',
    raw('a').replace('id=a;', ''),
    raw('a', 'removed', 'rm-deleted=1;'),
    raw('a').replace(String(time), 'invalid'),
    raw('a').replace('#channel', '#other'),
  ])
    expect(parseTwitchHistoryLine(line, 'channel')).toBeNull()
  expect(chatMessageIdentity(message('a'))).toBe(
    chatMessageIdentity({ ...message('a'), channelId: '#ChAnNeL' }),
  )
  expect(chatMessageIdentity(message('a'))).not.toBe(
    chatMessageIdentity({ ...message('a'), channelId: 'other' }),
  )
})

test('local chat history preserves badge titles and descriptions after storage', async () => {
  const db = await setup()
  const badges = parseTwitchBadgeCatalog({
    badges: { 'broadcaster/1': 'https://example.com/broadcaster.png' },
    badgeMetadata: {
      'broadcaster/1': { title: 'Broadcaster', description: 'The channel owner.' },
    },
  })
  const parsed = parseTwitchHistoryLine(raw('metadata'), 'channel', badges)
  if (!parsed) throw new Error('Invalid history fixture')
  MessageStore.saveMany([parsed], { maxMessages: 1000 }, db)
  expect(
    MessageStore.search({ platform: 'twitch', channelId: 'channel' }, db).messages[0]?.author
      .badges,
  ).toEqual(parsed.author.badges)
})

test('history client reaches only backend and coalesces concurrent requests', async () => {
  let calls = 0
  const gate = Promise.withResolvers<Response>()
  const client = createTwitchHistoryClient({
    fetch: async (path, init) => {
      calls++
      expect(path).toBe('/api/twitch/history')
      expect(JSON.parse(String(init?.body))).toMatchObject({ channel: 'channel' })
      return gate.promise
    },
    loadBadges: emptyBadges,
  })
  cleanups.push(() => client.dispose())
  const first = client.load({ channel: '#ChAnNeL', limit: 100 })
  const second = client.load({ channel: 'channel', limit: 100 })
  gate.resolve(response([raw('a')]))
  expect((await first).messages[0]?.id).toBe('a')
  await second
  await client.load({ channel: 'channel', limit: 100 })
  expect(calls).toBe(1)
})

test('default history badge loading retains backend metadata in imported messages', async () => {
  const client = createTwitchHistoryClient({
    fetch: async (path) =>
      path.startsWith('/api/twitch/badges?')
        ? Response.json({
            badges: { 'broadcaster/1': 'https://example.com/broadcaster.png' },
            badgeMetadata: {
              'broadcaster/1': { title: 'Broadcaster', description: 'The channel owner.' },
            },
          })
        : response([raw('metadata')]),
  })
  cleanups.push(() => client.dispose())
  const batch = await client.load({ channel: 'channel', limit: 100 })
  expect(batch.messages[0]?.author.badges).toEqual([
    {
      id: 'broadcaster/1',
      type: 'broadcaster',
      text: 'Broadcaster',
      description: 'The channel owner.',
      imageUrl: 'https://example.com/broadcaster.png',
    },
  ])
})

test('backend provider failure is explicit while local logs remain readable', async () => {
  await setup()
  MessageStore.save(message('local'))
  const client = createTwitchHistoryClient({
    fetch: async () =>
      Response.json(
        {
          error: 'All history providers are unavailable.',
          sources: [{ ...source, status: 'unavailable', messages: 0 }],
        },
        { status: 502 },
      ),
    loadBadges: emptyBadges,
  })
  const runtime = createTwitchHistoryRuntime({ channels: () => ['channel'], client })
  cleanups.push(() => runtime.dispose())
  const page = await runtime.query({ platform: 'twitch', channelId: 'channel' })
  expect(page.messages.map((item) => item.id)).toEqual(['local'])
  expect(page.history).toMatchObject({
    partial: true,
    error: 'All history providers are unavailable.',
    sources: [{ id: 'one', status: 'unavailable' }],
  })
})

test('cold history import preserves existing local payload across channel aliases and equal texts', async () => {
  const db = await setup()
  MessageStore.saveMany(
    [{ ...message('a', 'live payload'), channelId: 'ChAnNeL' }],
    { maxMessages: 1000 },
    db,
  )
  MessageStore.importHistory(
    [message('a', 'remote payload'), message('b'), message('b'), message('c')],
    { maxMessages: 1000 },
    db,
  )
  const page = MessageStore.search({ platform: 'twitch', channelId: '#CHANNEL' }, db)
  expect(page.messages.map((item) => item.id).sort()).toEqual(['a', 'b', 'c'])
  expect(page.messages.find((item) => item.id === 'a')?.text).toBe('live payload')
  expect(page.messages.filter((item) => item.text === 'same')).toHaveLength(2)
})

test('merged log pages preserve local authority and stable cursor ties', () => {
  const local = { messages: [message('b', 'live')], nextCursor: null, hasMore: false }
  const history = { sources: [], partial: false, truncated: false }
  const first = mergeHistoryPage(
    local,
    [message('a'), message('b'), message('c'), message('c')],
    { limit: 2 },
    history,
  )
  expect(first.messages.map((item) => item.id)).toEqual(['b', 'c'])
  expect(first.messages[0]?.text).toBe('live')
  expect(first.hasMore).toBe(true)
  const next = mergeHistoryPage(
    { messages: [], nextCursor: null, hasMore: false },
    [message('a'), message('b'), message('c')],
    { limit: 2, cursor: first.nextCursor ?? undefined },
    history,
  )
  expect(next.messages.map((item) => item.id)).toEqual(['a'])
})

test('runtime opt-out prevents external requests and leaves local logs readable', async () => {
  await setup()
  await saveChatLoggingSettings({ ...defaultChatLoggingSettings(), twitchHistoryEnabled: false })
  MessageStore.save(message('local'))
  let calls = 0
  const runtime = createTwitchHistoryRuntime({
    channels: () => ['channel'],
    client: {
      async load() {
        calls++
        throw new Error('Must not fetch')
      },
      dispose() {},
    },
  })
  cleanups.push(() => runtime.dispose())
  expect(
    (await runtime.query({ platform: 'twitch', channelId: 'channel' })).messages.map(
      (item) => item.id,
    ),
  ).toEqual(['local'])
  await runtime.refresh('channel')
  expect(calls).toBe(0)
})

test('an authoritative local payload is resolved before applying a remote text filter', async () => {
  await setup()
  MessageStore.save(message('same-id', 'authoritative live body'))
  const runtime = createTwitchHistoryRuntime({
    channels: () => ['channel'],
    client: {
      async load() {
        return {
          messages: [message('same-id', 'stale keyword')],
          sources: [],
          partial: false,
          truncated: false,
        }
      },
      dispose() {},
    },
  })
  cleanups.push(() => runtime.dispose())
  const page = await runtime.query({ platform: 'twitch', channelId: 'channel', text: 'keyword' })
  expect(page.messages).toEqual([])
  expect(MessageStore.getRecent()[0]?.text).toBe('authoritative live body')
})

test('global history queries bound merged memory while retaining fetched channels in SQLite', async () => {
  await setup()
  const runtime = createTwitchHistoryRuntime({
    channels: () => ['one', 'two', 'three'],
    client: {
      async load(query) {
        return {
          messages: Array.from({ length: 400 }, (_, index) => ({
            ...message(`${query.channel}-${index}`),
            channelId: query.channel,
            timestamp: new Date(time + index),
          })),
          sources: [],
          partial: false,
          truncated: false,
        }
      },
      dispose() {},
    },
  })
  cleanups.push(() => runtime.dispose())
  const result = await runtime.prepare({ platform: 'twitch' })
  expect(result.messages).toHaveLength(1000)
  expect(result.history.truncated).toBe(true)
  expect(
    getDb().query<{ count: number }, []>('SELECT COUNT(*) count FROM chat_messages').get()?.count,
  ).toBe(1200)
})

test('runtime merges live arrivals during backfill and publishes only cold snapshots', async () => {
  await setup()
  const gate = Promise.withResolvers<void>()
  const published: NormalizedChatMessage[][] = []
  const runtime = createTwitchHistoryRuntime({
    channels: () => ['channel'],
    publish: (_channel, messages) => {
      published.push(messages)
    },
    client: {
      async load() {
        await gate.promise
        return {
          messages: [message('a', 'remote'), message('b')],
          sources: [],
          partial: false,
          truncated: false,
        }
      },
      dispose() {},
    },
  })
  cleanups.push(() => runtime.dispose())
  const refreshing = runtime.refresh('channel')
  MessageStore.save(message('a', 'live'))
  gate.resolve()
  await refreshing
  expect(published).toHaveLength(1)
  expect(published[0]?.map((item) => item.id)).toEqual(['a', 'b'])
  expect(published[0]?.[0]?.text).toBe('live')
})

test('external transcript export pages into isolated SQLite without replacing global database', async () => {
  const db = await setup()
  MessageStore.save(message('z', 'live'))
  let pages = 0
  const runtime = createTwitchHistoryRuntime({
    channels: () => ['channel'],
    client: {
      async load(query) {
        pages++
        return {
          messages: query.before ? [message('a')] : [message('z', 'remote'), message('b')],
          sources: [],
          partial: false,
          truncated: !query.before,
        }
      },
      dispose() {},
    },
  })
  cleanups.push(() => runtime.dispose())
  const path = join(directory ?? '', 'transcript.txt')
  const result = await runtime.export({ query: { platform: 'twitch', channelId: 'channel' }, path })
  expect(getDb()).toBe(db)
  expect(result.count).toBe(3)
  expect(pages).toBe(2)
  const transcript = await Bun.file(path).text()
  expect(transcript).toContain('live')
  expect(transcript).not.toContain('remote')
  expect(MessageStore.getRecent().map((item) => item.id)).toEqual(['z'])
})
