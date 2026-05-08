import { getDb } from './db'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import type { UserChatHistoryCursor, UserChatHistoryPage } from '../shared/rpc'

const MAX_STORED = 1000
const DEFAULT_LOAD_COUNT = 100
const DEFAULT_USER_HISTORY_LOAD_COUNT = 50
const MAX_USER_HISTORY_LOAD_COUNT = 100

interface GetByUserParams {
  platform: NormalizedChatMessage['platform']
  platformUserId: string
  limit?: number
  cursor?: UserChatHistoryCursor
}

export const MessageStore = {
  getRecent(limit: number = DEFAULT_LOAD_COUNT): NormalizedChatMessage[] {
    const db = getDb()

    const rows = db
      .query<{ data: string; created_at: number }, [number]>(
        `SELECT data, created_at FROM chat_messages
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit)

    return rows
      .map((row) => {
        try {
          const msg = JSON.parse(row.data) as NormalizedChatMessage
          // Ensure timestamp is a proper Date (JSON stringify turns it into string)
          msg.timestamp = new Date(msg.timestamp)
          return msg
        } catch {
          return null
        }
      })
      .filter((m): m is NormalizedChatMessage => m !== null)
      .reverse() // oldest first (newest last) to match chat display order
  },

  getByUser({
    platform,
    platformUserId,
    limit = DEFAULT_USER_HISTORY_LOAD_COUNT,
    cursor,
  }: GetByUserParams): UserChatHistoryPage {
    const db = getDb()
    const safeLimit = Math.max(1, Math.min(limit, MAX_USER_HISTORY_LOAD_COUNT))

    const rows = db
      .query<
        { id: string; data: string; created_at: number },
        [string, string, number | null, number, number, string, number]
      >(
        `SELECT id, data, created_at FROM chat_messages
         WHERE platform = ?
           AND author_id = ?
           AND data IS NOT NULL
           AND (
             ? IS NULL
             OR created_at < ?
             OR (created_at = ? AND id < ?)
           )
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(
        platform,
        platformUserId,
        cursor?.createdAt ?? null,
        cursor?.createdAt ?? 0,
        cursor?.createdAt ?? 0,
        cursor?.id ?? '',
        safeLimit + 1,
      )

    const parsedRows = rows
      .map((row) => {
        try {
          const msg = JSON.parse(row.data) as NormalizedChatMessage
          msg.timestamp = new Date(msg.timestamp)
          return { createdAt: row.created_at, id: row.id, message: msg }
        } catch {
          return null
        }
      })
      .filter(
        (entry): entry is { createdAt: number; id: string; message: NormalizedChatMessage } =>
          entry !== null,
      )

    const hasMore = parsedRows.length > safeLimit
    const messages = hasMore ? parsedRows.slice(0, safeLimit) : parsedRows

    const oldestEntry = messages.at(-1)

    return {
      messages: messages.map((entry) => entry.message).reverse(),
      nextCursor: oldestEntry
        ? {
            createdAt: oldestEntry.createdAt,
            id: oldestEntry.id,
          }
        : null,
      hasMore,
    }
  },

  save(msg: NormalizedChatMessage): void {
    const db = getDb()

    db.run(
      `INSERT OR REPLACE INTO chat_messages (id, platform, channel_id, author_id, author_name, text, type, created_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id,
        msg.platform,
        msg.channelId,
        msg.author.id,
        msg.author.displayName,
        msg.text,
        msg.type,
        new Date(msg.timestamp).getTime(),
        JSON.stringify(msg),
      ],
    )

    // Trim to MAX_STORED — delete oldest rows beyond the limit
    db.run(
      `DELETE FROM chat_messages
       WHERE created_at <= (
         SELECT created_at FROM chat_messages
         ORDER BY created_at DESC
         LIMIT 1 OFFSET ?
       )`,
      [MAX_STORED - 1],
    )
  },
}
