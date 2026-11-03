import type { Database } from 'bun:sqlite'
import { mkdir, open, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { getDbPath } from '../../runtime-config'
import { platformSchema } from '../../services/persisted-schemas'
import type { UserChatHistoryPage } from '../../shared/rpc'
import { getDb } from '../../store/db'
import { MessageStore, type ChatHistoryQuery } from '../../store/message-store'
import { formatChatTranscript } from '../chat-tools'
import { createChatFileLogger } from './chat-logging'

export type { ChatHistoryQuery }
export interface ChatLoggingSettings {
  twitchHistoryEnabled: boolean
  enabled: boolean
  directory: string
  channels: { platform: Platform; channelId: string }[]
  timestamps: boolean
  rotation: 'daily' | 'session'
  maxFileBytes: number
  maxMessages: number
  maxAgeDays: number
}
const SETTINGS_KEY = 'chat_logging_v1'
export function defaultChatLoggingSettings(): ChatLoggingSettings {
  return {
    twitchHistoryEnabled: true,
    enabled: false,
    directory: join(dirname(getDbPath()), 'chat-logs'),
    channels: [],
    timestamps: true,
    rotation: 'daily',
    maxFileBytes: 32 * 1024 * 1024,
    maxMessages: 100000,
    maxAgeDays: 0,
  }
}
export function validateChatLoggingSettings(value: unknown): ChatLoggingSettings {
  if (!value || typeof value !== 'object')
    throw new Error('Chat logging settings must contain an object.')
  const settings = z
    .toZod<ChatLoggingSettings>()(
      z.object({
        twitchHistoryEnabled: z.boolean().default(true),
        enabled: z.boolean(),
        directory: z.string(),
        channels: z.array(z.object({ platform: platformSchema, channelId: z.string() })),
        timestamps: z.boolean(),
        rotation: z.enum(['daily', 'session']),
        maxFileBytes: z.number(),
        maxMessages: z.number(),
        maxAgeDays: z.number(),
      }),
    )
    .parse(value)
  if (
    typeof settings.enabled !== 'boolean' ||
    typeof settings.timestamps !== 'boolean' ||
    typeof settings.directory !== 'string' ||
    !isAbsolute(settings.directory) ||
    settings.directory.includes('\0')
  )
    throw new Error('Choose an absolute folder path for chat logs.')
  if (!['daily', 'session'].includes(settings.rotation))
    throw new Error('Choose daily or session log rotation.')
  if (
    !Number.isSafeInteger(settings.maxFileBytes) ||
    settings.maxFileBytes < 1024 ||
    settings.maxFileBytes > 1024 ** 3
  )
    throw new Error('Log file size must be between 1 KiB and 1 GiB.')
  if (
    !Number.isSafeInteger(settings.maxMessages) ||
    settings.maxMessages < 1 ||
    settings.maxMessages > 1000000
  )
    throw new Error('History retention must be between 1 and 1,000,000 messages.')
  if (
    !Number.isSafeInteger(settings.maxAgeDays) ||
    settings.maxAgeDays < 0 ||
    settings.maxAgeDays > 36500
  )
    throw new Error('History retention days must be between 0 and 36,500.')
  if (
    !Array.isArray(settings.channels) ||
    settings.channels.length > 1000 ||
    settings.channels.some(
      (channel) =>
        !channel ||
        !['twitch', 'kick', 'youtube'].includes(channel.platform) ||
        typeof channel.channelId !== 'string' ||
        !channel.channelId.trim() ||
        channel.channelId.length > 256,
    )
  )
    throw new Error('Each log channel needs a platform and a channel name or ID.')
  return settings
}
interface Recorder {
  settings: ChatLoggingSettings
  pending: NormalizedChatMessage[]
  timer?: ReturnType<typeof setTimeout>
  logger: ReturnType<typeof createChatFileLogger>
  error: string | null
  seen: Set<string>
  retryAt: number
}
const recorders = new WeakMap<Database, Recorder>()
function recorder(database = getDb()): Recorder {
  let current = recorders.get(database)
  if (current) return current
  const raw = database
    .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
    .get(SETTINGS_KEY)
  let settings = defaultChatLoggingSettings()
  let error: string | null = null
  if (raw)
    try {
      settings = validateChatLoggingSettings(JSON.parse(raw.value))
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure)
    }
  current = {
    settings,
    pending: [],
    logger: createChatFileLogger(),
    error,
    seen: new Set(),
    retryAt: 0,
  }
  recorders.set(database, current)
  return current
}
function flushDatabase(database: Database, state: Recorder): void {
  clearTimeout(state.timer)
  state.timer = undefined
  if (!state.pending.length) return
  const pending = state.pending
  try {
    MessageStore.saveMany(
      pending,
      { maxMessages: state.settings.maxMessages, maxAgeDays: state.settings.maxAgeDays },
      database,
    )
    state.pending = []
    state.error = null
    state.retryAt = 0
  } catch (failure) {
    state.error = failure instanceof Error ? failure.message : String(failure)
    state.retryAt = Date.now() + 5000
  }
}
export function recordChatMessage(message: NormalizedChatMessage): void {
  const database = getDb()
  const state = recorder(database)
  const key = `${message.platform}:${message.channelId}:${message.id}`
  if (state.seen.has(key)) return
  state.seen.add(key)
  if (state.seen.size > 10000) state.seen.delete(state.seen.values().next().value!)
  if (state.pending.length < 5000) state.pending.push(message)
  else state.error = 'The history queue is full. Check the database disk space and flush again.'
  state.logger.enqueue(message, state.settings)
  if (state.pending.length >= 1000 && Date.now() >= state.retryAt) flushDatabase(database, state)
  else if (!state.timer) {
    state.timer = setTimeout(
      () => flushDatabase(database, state),
      Math.max(50, state.retryAt - Date.now()),
    )
    state.timer.unref()
  }
}
export async function getChatHistory(query: ChatHistoryQuery): Promise<UserChatHistoryPage> {
  const database = getDb()
  flushDatabase(database, recorder(database))
  return MessageStore.search(query, database)
}
export async function getChatLoggingSettings(): Promise<ChatLoggingSettings> {
  return structuredClone(recorder().settings)
}
export async function saveChatLoggingSettings(value: ChatLoggingSettings): Promise<void> {
  const settings = validateChatLoggingSettings(value)
  const database = getDb()
  const state = recorder(database)
  await state.logger.flush()
  if (state.settings.directory !== settings.directory) {
    state.logger.relocate(settings.directory)
    await state.logger.flush()
  }
  database.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [SETTINGS_KEY, JSON.stringify(settings)],
  )
  state.settings = settings
  flushDatabase(database, state)
  MessageStore.prune(
    { maxMessages: settings.maxMessages, maxAgeDays: settings.maxAgeDays },
    database,
  )
}
export async function getChatLoggingStatus(): Promise<{ error: string | null; queued: number }> {
  const state = recorder()
  const status = state.logger.status()
  return { error: state.error ?? status.error, queued: state.pending.length + status.queued }
}
export async function flushChatLogs(): Promise<void> {
  const database = getDb()
  const state = recorder(database)
  flushDatabase(database, state)
  await state.logger.flush()
  const status = await getChatLoggingStatus()
  if (status.error) throw new Error(status.error)
}
export async function exportChatHistory({
  query,
  path,
  database = getDb(),
}: {
  query: ChatHistoryQuery
  path: string
  database?: Database
}): Promise<{ path: string; count: number }> {
  if (!isAbsolute(path) || path.includes('\0'))
    throw new Error('Choose an absolute path for the transcript file.')
  if (database === getDb()) flushDatabase(database, recorder(database))
  let cursor: ChatHistoryQuery['cursor']
  let count = 0
  await mkdir(dirname(path), { recursive: true })
  const file = await open(path, 'wx').catch((error: unknown) => {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
      throw new Error('That file already exists. Choose a new transcript filename.')
    throw error
  })
  let complete = false
  try {
    while (true) {
      const page = MessageStore.search({ ...query, cursor, limit: 500 }, database, true)
      if (page.messages.length) {
        await file.writeFile(`${formatChatTranscript(page.messages)}\n`)
        count += page.messages.length
      }
      if (!page.hasMore || !page.nextCursor) break
      cursor = page.nextCursor
    }
    complete = true
    return { path, count }
  } finally {
    await file.close()
    if (!complete) await rm(path, { force: true })
  }
}

declare global {
  var twirChatHistoryExitHook: boolean | undefined
}
const lifecycle = globalThis
if (!lifecycle.twirChatHistoryExitHook) {
  lifecycle.twirChatHistoryExitHook = true
  process.once('beforeExit', () => {
    void flushChatLogs().catch(() => {})
  })
  process.once('exit', () => {
    try {
      const database = getDb()
      const state = recorders.get(database)
      if (state) flushDatabase(database, state)
    } catch {
      /* The database may already have been closed by its owner. */
    }
  })
}
