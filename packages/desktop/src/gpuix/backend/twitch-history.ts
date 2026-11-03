import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { normalizeMessageChannel } from '@twirchat/shared/message-identity'
import type { TwitchHistorySource } from '@twirchat/shared/twitch-history'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import {
  createTwitchHistoryClient,
  TwitchHistoryFailure,
  type TwitchHistoryClient,
} from '../../services/twitch-history'
import type { UserChatHistoryPage } from '../../shared/rpc'
import { getDb, openDatabase } from '../../store/db'
import { MessageStore, type ChatHistoryQuery } from '../../store/message-store'
import { mergeChatMessageSnapshot } from '../../views/main/utils/chat-message-buffer'
import { getChatHistory, getChatLoggingSettings, exportChatHistory } from './chat-history'

export interface TwitchHistoryRuntimeOptions {
  channels(): string[]
  client?: TwitchHistoryClient
  warmChannel?(channel: string): Promise<unknown>
  publish?(channel: string, messages: NormalizedChatMessage[]): void
}

function compareHistoryMessages(a: NormalizedChatMessage, b: NormalizedChatMessage): number {
  const timestamp = a.timestamp.getTime() - b.timestamp.getTime()
  if (timestamp) return timestamp
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  if (a.platform !== b.platform) return a.platform < b.platform ? -1 : 1
  return a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0
}

export function historyMessageMatches(
  message: NormalizedChatMessage,
  query: ChatHistoryQuery,
): boolean {
  if (query.platform && message.platform !== query.platform) return false
  if (
    query.channelId &&
    normalizeMessageChannel(message.platform, query.channelId) !== message.channelId
  )
    return false
  if (query.authorId && message.author.id !== query.authorId) return false
  if (
    query.author &&
    ![message.author.id, message.author.username, message.author.displayName].some(
      (value) => value?.toLowerCase() === query.author?.toLowerCase(),
    )
  )
    return false
  if (query.text && !message.text.toLowerCase().includes(query.text.toLowerCase())) return false
  const timestamp = message.timestamp.getTime()
  if (query.since !== undefined && timestamp < query.since) return false
  if (query.until !== undefined && timestamp > query.until) return false
  const cursor = query.cursor
  if (cursor) {
    if (timestamp > cursor.createdAt) return false
    if (timestamp === cursor.createdAt) {
      const tuple = [message.id, message.platform, message.channelId]
      const boundary = [cursor.id, cursor.platform ?? query.platform ?? '', cursor.channelId ?? '']
      const comparison = tuple.findIndex((value, index) => value !== boundary[index])
      if (comparison === -1 || (tuple[comparison] ?? '') >= (boundary[comparison] ?? ''))
        return false
    }
  }
  return true
}

export function mergeHistoryPage(
  local: UserChatHistoryPage,
  remote: NormalizedChatMessage[],
  query: ChatHistoryQuery,
  history: NonNullable<UserChatHistoryPage['history']>,
): UserChatHistoryPage {
  const limit = Math.max(1, Math.min(500, query.limit ?? 100))
  const merged = mergeChatMessageSnapshot(
    local.messages,
    remote.filter((message) => historyMessageMatches(message, query)),
    0,
  ).toSorted(compareHistoryMessages)
  const messages = merged.slice(-limit)
  const first = messages[0]
  return {
    messages,
    nextCursor: first
      ? {
          createdAt: first.timestamp.getTime(),
          id: first.id,
          platform: first.platform,
          channelId: first.channelId,
        }
      : null,
    hasMore: local.hasMore || merged.length > limit || (history.truncated && messages.length > 0),
    history,
  }
}

export function createTwitchHistoryRuntime(options: TwitchHistoryRuntimeOptions) {
  const client = options.client ?? createTwitchHistoryClient()
  const refreshing = new Map<string, Promise<void>>()
  let disposed = false
  const prepare = async (query: ChatHistoryQuery, username?: string, persist = true) => {
    const settings = await getChatLoggingSettings()
    const history: NonNullable<UserChatHistoryPage['history']> = {
      sources: [],
      partial: false,
      truncated: false,
    }
    if (
      !settings.twitchHistoryEnabled ||
      disposed ||
      (query.platform && query.platform !== 'twitch')
    )
      return { messages: [], history }
    const channels = [
      ...new Set(
        (query.channelId ? [query.channelId] : options.channels())
          .map((channel) => normalizeMessageChannel('twitch', channel))
          .filter((channel) => /^[a-z0-9_]{1,25}$/u.test(channel)),
      ),
    ]
    let remote: NormalizedChatMessage[] = []
    const sources = new Map<string, TwitchHistorySource>()
    const results = await Promise.allSettled(
      channels.map(async (channel) => {
        const cursorPlatform = query.cursor?.platform ?? query.platform ?? ''
        const beforeIdInclusive =
          query.cursor &&
          (cursorPlatform !== 'twitch'
            ? 'twitch' < cursorPlatform
            : channel < normalizeMessageChannel('twitch', query.cursor.channelId ?? ''))
        const [batch] = await Promise.all([
          client.load({
            channel,
            limit: 1000,
            before: query.cursor
              ? query.cursor.createdAt + 1
              : query.until === undefined
                ? undefined
                : query.until + 1,
            beforeId: query.cursor?.id,
            beforeIdInclusive: beforeIdInclusive || undefined,
            text: query.text,
            after: query.since === undefined ? undefined : query.since - 1,
            username:
              username ??
              (query.author &&
              /^[a-z0-9_]{1,25}$/iu.test(query.author) &&
              !/^\d+$/u.test(query.author)
                ? query.author
                : undefined),
            userId:
              query.authorId ??
              (query.author && /^\d+$/u.test(query.author) ? query.author : undefined),
            archive: true,
          }),
          persist ? options.warmChannel?.(channel).catch(() => {}) : undefined,
        ])
        if (disposed) return
        await getChatHistory({ platform: 'twitch', channelId: channel, limit: 1 })
        const resolved = MessageStore.resolveHistory(batch.messages)
        if (disposed || !(await getChatLoggingSettings()).twitchHistoryEnabled) return
        if (persist)
          MessageStore.importHistory(resolved, {
            maxMessages: settings.maxMessages,
            maxAgeDays: settings.maxAgeDays,
          })
        const merged = mergeChatMessageSnapshot(remote, resolved, 0)
        history.truncated ||= merged.length > 1000
        remote = merged.length > 1000 ? merged.slice(-1000) : merged
        history.partial ||= batch.partial
        history.truncated ||= batch.truncated
        for (const source of batch.sources) sources.set(`${channel}:${source.id}`, source)
      }),
    )
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      history.partial = true
      history.error =
        failure.reason instanceof Error ? failure.reason.message : String(failure.reason)
    }
    history.sources = [...sources.values()]
    for (const result of results)
      if (result.status === 'rejected' && result.reason instanceof TwitchHistoryFailure)
        history.sources.push(...result.reason.sources)
    if (disposed || !(await getChatLoggingSettings()).twitchHistoryEnabled)
      return { messages: [], history }
    return { messages: remote, history }
  }
  return {
    async query(query: ChatHistoryQuery, username?: string): Promise<UserChatHistoryPage> {
      await getChatHistory(query)
      const remote = await prepare(query, username)
      const local = await getChatHistory(query)
      return mergeHistoryPage(local, remote.messages, query, remote.history)
    },
    prepare,
    async export(params: { query: ChatHistoryQuery; path: string }) {
      if (!isAbsolute(params.path) || params.path.includes('\0'))
        throw new Error('Choose an absolute path for the transcript file.')
      if (await Bun.file(params.path).exists())
        throw new Error('That file already exists. Choose a new transcript filename.')
      const settings = await getChatLoggingSettings()
      if (
        !settings.twitchHistoryEnabled ||
        (params.query.platform && params.query.platform !== 'twitch')
      )
        return exportChatHistory(params)
      const directory = await mkdtemp(join(tmpdir(), 'twirchat-history-export-'))
      const database = openDatabase(join(directory, 'history.sqlite'))
      const source = getDb()
      const history: NonNullable<UserChatHistoryPage['history']> = {
        sources: [],
        partial: false,
        truncated: false,
      }
      try {
        await getChatHistory({ ...params.query, limit: 1 })
        let cursor: ChatHistoryQuery['cursor']
        while (true) {
          const page = MessageStore.search({ ...params.query, cursor, limit: 500 }, source, true)
          MessageStore.importHistory(page.messages, null, database)
          if (!page.hasMore || !page.nextCursor) break
          cursor = page.nextCursor
        }
        const channels = params.query.channelId
          ? [params.query.channelId]
          : [...new Set(options.channels())]
        for (const channel of channels) {
          let older: ChatHistoryQuery['cursor']
          while (true) {
            const query: ChatHistoryQuery = {
              ...params.query,
              platform: 'twitch',
              channelId: channel,
              cursor: older,
              limit: 1000,
            }
            const batch = await prepare(query, undefined, false)
            history.partial ||= batch.history.partial
            history.sources.push(
              ...batch.history.sources.filter(
                (item) =>
                  !history.sources.some(
                    (existing) =>
                      existing.id === item.id &&
                      existing.kind === item.kind &&
                      existing.status === item.status,
                  ),
              ),
            )
            if (batch.history.error) history.error = batch.history.error
            const messages = batch.messages
              .filter((message) => historyMessageMatches(message, query))
              .toSorted(compareHistoryMessages)
            MessageStore.importHistory(messages, null, database)
            const count =
              database
                .query<{ count: number }, []>('SELECT COUNT(*) count FROM chat_messages')
                .get()?.count ?? 0
            if (count > 1000000)
              throw new Error(
                'Export exceeds one million messages. Narrow the date or channel filter.',
              )
            const first = batch.messages.toSorted(compareHistoryMessages)[0]
            if (!batch.history.truncated || !first) break
            if (older?.id === first.id && older.createdAt === first.timestamp.getTime())
              throw new Error('The history provider could not advance to an older page.')
            older = {
              createdAt: first.timestamp.getTime(),
              id: first.id,
              platform: first.platform,
              channelId: first.channelId,
            }
          }
        }
        return { ...(await exportChatHistory({ ...params, database })), history }
      } finally {
        database.close()
        await rm(directory, { recursive: true, force: true })
      }
    },
    refresh(channel: string): Promise<void> {
      channel = normalizeMessageChannel('twitch', channel)
      const existing = refreshing.get(channel)
      if (existing) return existing
      const refresh = async () => {
        const settings = await getChatLoggingSettings()
        if (disposed || !settings.twitchHistoryEnabled) return
        await getChatHistory({ platform: 'twitch', channelId: channel, limit: 500 })
        const batch = await client.load({ channel, limit: 1000 })
        if (disposed || !(await getChatLoggingSettings()).twitchHistoryEnabled) return
        MessageStore.importHistory(batch.messages, {
          maxMessages: settings.maxMessages,
          maxAgeDays: settings.maxAgeDays,
        })
        const local = await getChatHistory({ platform: 'twitch', channelId: channel, limit: 500 })
        options.publish?.(channel, mergeChatMessageSnapshot(local.messages, batch.messages, 500))
      }
      const result = refresh().finally(() => refreshing.delete(channel))
      refreshing.set(channel, result)
      return result
    },
    dispose() {
      disposed = true
      client.dispose()
      refreshing.clear()
    },
  }
}

export type TwitchHistoryRuntime = ReturnType<typeof createTwitchHistoryRuntime>
