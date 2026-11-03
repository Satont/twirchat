import type { Database } from 'bun:sqlite'

import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'

import { normalizedChatMessageSchema } from '../services/persisted-schemas'
import type { UserChatHistoryCursor, UserChatHistoryPage } from '../shared/rpc'
import { getDb } from './db'

export interface ChatHistoryQuery {
  platform?: Platform
  channelId?: string
  author?: string
  authorId?: string
  text?: string
  since?: number
  until?: number
  limit?: number
  cursor?: UserChatHistoryCursor
}
export interface HistoryRetention {
  maxMessages: number
  maxAgeDays: number
}
interface HistoryRow {
  id: string
  platform: Platform
  channel_id: string
  created_at: number
  data: string | null
  author_id: string
  author_name: string
  text: string
  type: NormalizedChatMessage['type']
}

const DEFAULT_RETENTION: HistoryRetention = { maxMessages: 1000, maxAgeDays: 0 }
const ORDER = 'created_at DESC, id DESC, platform DESC, channel_id DESC'

function pageLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value)) throw new Error('History page size must be an integer.')
  return Math.max(1, Math.min(maximum, value))
}

function cursorFor(row: HistoryRow): UserChatHistoryCursor {
  return {
    id: row.id,
    createdAt: row.created_at,
    platform: row.platform,
    channelId: row.channel_id,
  }
}

function parseMessage(row: HistoryRow): NormalizedChatMessage | null {
  try {
    if (row.data === null)
      return {
        id: row.id,
        platform: row.platform,
        channelId: row.channel_id,
        author: { id: row.author_id, displayName: row.author_name, badges: [] },
        text: row.text,
        type: row.type,
        timestamp: new Date(row.created_at),
        emotes: [],
      }
    const message = normalizedChatMessageSchema.parse({
      ...JSON.parse(row.data),
      id: row.id,
      platform: row.platform,
      channelId: row.channel_id,
      timestamp: row.created_at,
    })
    if (
      !message ||
      typeof message !== 'object' ||
      !message.author ||
      typeof message.text !== 'string'
    )
      return null
    return { ...message, timestamp: new Date(row.created_at) }
  } catch {
    return null
  }
}

function search(
  query: ChatHistoryQuery,
  database = getDb(),
  ascending = false,
): UserChatHistoryPage {
  const limit = pageLimit(query.limit, 100, 500)
  const where = ['1 = 1']
  const values: (string | number)[] = []
  if (query.platform !== undefined) {
    if (!['twitch', 'kick', 'youtube'].includes(query.platform))
      throw new Error('Unknown history platform.')
    where.push('platform = ?')
    values.push(query.platform)
  }
  if (query.channelId?.trim()) {
    where.push('channel_id = ?')
    values.push(query.channelId.trim())
  }
  if (query.author?.trim()) {
    where.push(
      `(author_id = ? OR twir_casefold(author_name) = twir_casefold(?) OR twir_casefold(CASE WHEN json_valid(data) THEN json_extract(data, '$.author.username') END) = twir_casefold(?))`,
    )
    values.push(query.author.trim(), query.author.trim(), query.author.trim())
  }
  if (query.authorId !== undefined) {
    where.push('author_id = ?')
    values.push(query.authorId)
  }
  if (query.text) {
    where.push('instr(twir_casefold(text), twir_casefold(?)) > 0')
    values.push(query.text.slice(0, 2000))
  }
  for (const field of ['since', 'until'] satisfies ('since' | 'until')[])
    if (query[field] !== undefined) {
      if (!Number.isSafeInteger(query[field]))
        throw new Error('History dates must be valid timestamps.')
      where.push(`created_at ${field === 'since' ? '>=' : '<='} ?`)
      values.push(query[field])
    }
  if (query.since !== undefined && query.until !== undefined && query.since > query.until)
    throw new Error('The start date must be before the end date.')
  const entries: { row: HistoryRow; message: NormalizedChatMessage }[] = []
  let cursor = query.cursor
  let exhausted = false
  // Continue past malformed rows so one damaged entry cannot hide later pages.
  while (entries.length <= limit && !exhausted) {
    const conditions = [...where]
    const bindings = [...values]
    if (cursor) {
      if (!Number.isSafeInteger(cursor.createdAt) || typeof cursor.id !== 'string')
        throw new Error('Invalid history cursor.')
      conditions.push(
        `(created_at, id, platform, channel_id) ${ascending ? '>' : '<'} (?, ?, ?, ?)`,
      )
      bindings.push(
        cursor.createdAt,
        cursor.id,
        cursor.platform ?? query.platform ?? '',
        cursor.channelId ?? '',
      )
    }
    const count = Math.max(100, limit + 1)
    const rows = database
      .query<HistoryRow, (string | number)[]>(
        `SELECT id, platform, channel_id, created_at, data, author_id, author_name, text, type FROM chat_messages WHERE ${conditions.join(' AND ')} ORDER BY ${ascending ? ORDER.replaceAll('DESC', 'ASC') : ORDER} LIMIT ?`,
      )
      .all(...bindings, count)
    for (const row of rows) {
      const message = parseMessage(row)
      if (message) entries.push({ row, message })
      if (entries.length > limit) break
    }
    exhausted = rows.length < count
    const last = rows.at(-1)
    if (last) cursor = cursorFor(last)
    else exhausted = true
  }
  const kept = entries.slice(0, limit)
  const lastKept = kept.at(-1)
  return {
    messages: ascending
      ? kept.map((entry) => entry.message)
      : kept.map((entry) => entry.message).reverse(),
    nextCursor: lastKept ? cursorFor(lastKept.row) : null,
    hasMore: entries.length > limit,
  }
}

function prune(retention: Partial<HistoryRetention> = DEFAULT_RETENTION, database = getDb()): void {
  const maxMessages = pageLimit(retention.maxMessages, DEFAULT_RETENTION.maxMessages, 1_000_000)
  const maxAgeDays = retention.maxAgeDays ?? 0
  if (!Number.isSafeInteger(maxAgeDays) || maxAgeDays < 0 || maxAgeDays > 36500)
    throw new Error('Invalid history retention period.')
  if (maxAgeDays > 0)
    database.run('DELETE FROM chat_messages WHERE created_at < ?', [
      Date.now() - maxAgeDays * 86_400_000,
    ])
  database.run(
    `DELETE FROM chat_messages WHERE rowid IN (SELECT rowid FROM chat_messages ORDER BY ${ORDER.replaceAll('DESC', 'ASC')} LIMIT MAX(0, (SELECT COUNT(*) FROM chat_messages) - ?))`,
    [maxMessages],
  )
}

export const MessageStore = {
  search,
  prune,
  getRecent(limit = 100): NormalizedChatMessage[] {
    return search({ limit: pageLimit(limit, 100, 500) }).messages
  },
  getByUser({
    platform,
    platformUserId,
    limit,
    cursor,
  }: {
    platform: Platform
    platformUserId: string
    limit?: number
    cursor?: UserChatHistoryCursor
  }): UserChatHistoryPage {
    return search({ platform, authorId: platformUserId, limit: pageLimit(limit, 50, 100), cursor })
  },
  save(message: NormalizedChatMessage): void {
    this.saveMany([message])
  },
  saveMany(
    messages: readonly NormalizedChatMessage[],
    retention: Partial<HistoryRetention> = DEFAULT_RETENTION,
    database: Database = getDb(),
  ): void {
    if (!messages.length) return
    database.transaction(() => {
      const insert = database.query(
        `INSERT INTO chat_messages (id, platform, channel_id, author_id, author_name, text, type, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(platform, channel_id, id) DO UPDATE SET author_id=excluded.author_id, author_name=excluded.author_name, text=excluded.text, type=excluded.type, created_at=excluded.created_at, data=excluded.data`,
      )
      for (const message of messages) {
        const timestamp = new Date(message.timestamp).getTime()
        if (!Number.isFinite(timestamp)) continue
        insert.run(
          message.id,
          message.platform,
          message.channelId,
          message.author.id,
          message.author.displayName,
          message.text,
          message.type,
          timestamp,
          JSON.stringify(message),
        )
      }
      prune(retention, database)
    })()
  },
}
