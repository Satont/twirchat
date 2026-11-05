import type { Database } from 'bun:sqlite'

import { chatMessageIdentity } from '@twirchat/shared/message-identity'

const ECHO_WINDOW_MS = 3000
const ECHO_BATCH_SIZE = 500

interface EchoScope {
  channel: string
  first: number
  last: number
}

interface EchoRow {
  rowid: number
  id: string
  channel: string
  author_id: string
  text: string
  created_at: number
  reply_id: string | null
}

const CHANNEL = "lower(ltrim(channel_id, '#@'))"
const JSON_DATA = 'CASE WHEN json_valid(data) THEN data END'
const REPLY_ID = `json_extract(${JSON_DATA}, '$.reply.parentMessageId')`
const NORMAL_TWITCH_MESSAGE = `platform = 'twitch' AND type = 'message'
  AND (data IS NULL OR json_valid(data))
  AND json_extract(${JSON_DATA}, '$.metadata.announcement') IS NULL`

// Runs inside the history import or migration transaction.
export function reconcileTwitchHistoryEchoes(
  database: Database,
  replacements?: Map<string, string>,
  scope?: EchoScope,
): void {
  const echoes = database.query<EchoRow, [number] | [number, string, number, number]>(`
    SELECT rowid, id, ${CHANNEL} AS channel, author_id, text, created_at, ${REPLY_ID} AS reply_id
    FROM chat_messages
    WHERE id GLOB 'local:twitch:*' AND author_id <> '' AND rowid > ?
      ${scope ? `AND ${CHANNEL} = ? AND created_at BETWEEN ? AND ?` : ''}
      AND ${NORMAL_TWITCH_MESSAGE}
    ORDER BY rowid LIMIT ${ECHO_BATCH_SIZE}
  `)
  const findCanonical = database.query<
    { id: string },
    [string, string, number, number, string, string | null, string | null, number]
  >(`
    SELECT candidate.id FROM chat_messages AS candidate
    WHERE author_id = ? AND ${CHANNEL} = ?
      AND created_at BETWEEN ? AND ? AND text = ? AND id <> '' AND id NOT GLOB 'local:*'
      AND ${NORMAL_TWITCH_MESSAGE}
      AND (? IS NULL OR ${REPLY_ID} = ?)
      AND NOT EXISTS (
        SELECT 1 FROM chat_messages AS matched
        WHERE matched.platform = 'twitch' AND lower(ltrim(matched.channel_id, '#@')) = lower(ltrim(candidate.channel_id, '#@'))
          AND matched.id = candidate.id AND matched.local_twitch_echo_id IS NOT NULL
      )
    ORDER BY abs(created_at - ?), created_at, id LIMIT 1
  `)
  const assignEcho = database.query(`
    UPDATE chat_messages SET local_twitch_echo_id = ?
    WHERE platform = 'twitch' AND ${CHANNEL} = ? AND id = ?
  `)
  const deleteEcho = database.query('DELETE FROM chat_messages WHERE rowid = ?')
  let cursor = 0
  while (true) {
    const batch = scope
      ? echoes.all(cursor, scope.channel, scope.first - ECHO_WINDOW_MS, scope.last + ECHO_WINDOW_MS)
      : echoes.all(cursor)
    for (const echo of batch) {
      cursor = echo.rowid
      const canonical = findCanonical.get(
        echo.author_id,
        echo.channel,
        echo.created_at - ECHO_WINDOW_MS,
        echo.created_at + ECHO_WINDOW_MS,
        echo.text,
        echo.reply_id,
        echo.reply_id,
        echo.created_at,
      )
      if (!canonical) continue
      assignEcho.run(echo.id, echo.channel, canonical.id)
      deleteEcho.run(echo.rowid)
      replacements?.set(
        chatMessageIdentity({ platform: 'twitch', channelId: echo.channel, id: canonical.id }),
        echo.id,
      )
    }
    if (batch.length < ECHO_BATCH_SIZE) return
  }
}
