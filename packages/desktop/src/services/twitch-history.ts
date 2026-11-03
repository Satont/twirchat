import type {
  TwitchHistoryRequest,
  TwitchHistoryResponse,
  TwitchHistorySource,
} from '@twirchat/shared/twitch-history'
import type { Badge, NormalizedChatMessage } from '@twirchat/shared/types'
import { ChatMessage, extractMessageText, parseTwitchMessage } from '@twurple/chat'
import { z } from 'zod'

import { parseTwitchBadgeCatalog } from '../platforms/twitch/badge-data'
import { normalizeTwitchChatMessage } from '../platforms/twitch/normalize-message'
import { backendFetch } from '../runtime-config'

const sourcesSchema = z
  .array(
    z.object({
      id: z.string(),
      kind: z.enum(['recent', 'archive']),
      status: z.enum(['ok', 'unavailable', 'error']),
      messages: z.number().int().nonnegative(),
      error: z.string().optional(),
      capabilities: z.array(z.enum(['recent', 'user', 'time'])),
    }),
  )
  .max(32)
const responseSchema: z.ZodType<TwitchHistoryResponse> = z.object({
  messages: z.array(z.string().max(16384)).max(5000),
  sources: sourcesSchema,
  partial: z.boolean(),
  truncated: z.boolean(),
})

export class TwitchHistoryFailure extends Error {
  constructor(
    message: string,
    readonly sources: TwitchHistorySource[] = [],
  ) {
    super(message)
  }
}

export interface TwitchHistoryBatch {
  messages: NormalizedChatMessage[]
  sources: TwitchHistorySource[]
  partial: boolean
  truncated: boolean
}
interface CachedBatch {
  batch: TwitchHistoryBatch
  expiresAt: number
}
interface QueuedRequest {
  start(): void
  reject(error: Error): void
}
export interface TwitchHistoryClientOptions {
  fetch?: typeof backendFetch
  now?: () => number
  loadBadges?: (channel: string) => Promise<ReadonlyMap<string, Badge>>
}

export function parseTwitchHistoryLine(
  line: string,
  channel: string,
  badges: ReadonlyMap<string, Badge> = new Map(),
): NormalizedChatMessage | null {
  try {
    const parsed = parseTwitchMessage(line)
    if (!(parsed instanceof ChatMessage)) return null
    if (!parsed.tags.get('id') || parsed.tags.get('rm-deleted') === '1') return null
    if (parsed.target.replace(/^#/u, '').toLowerCase() !== channel.toLowerCase()) return null
    const timestamp = Number(parsed.tags.get('tmi-sent-ts') ?? parsed.tags.get('rm-received-ts'))
    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp <= 0 ||
      !Number.isFinite(new Date(timestamp).getTime())
    )
      return null
    const message = normalizeTwitchChatMessage(parsed, badges, {
      text: extractMessageText(parsed.text),
      isAction: parsed.text.startsWith('\u0001ACTION '),
    })
    return { ...message, timestamp: new Date(timestamp) }
  } catch {
    return null
  }
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('The history backend returned an empty response.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 6 * 1024 * 1024) throw new Error('The history response is too large.')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function createTwitchHistoryClient(options: TwitchHistoryClientOptions = {}) {
  const request = options.fetch ?? backendFetch
  const now = options.now ?? Date.now
  const cache = new Map<string, CachedBatch>()
  const pending = new Map<string, Promise<TwitchHistoryBatch>>()
  const queue: QueuedRequest[] = []
  const lifetime = new AbortController()
  const badgeCache = new Map<string, { badges: ReadonlyMap<string, Badge>; expiresAt: number }>()
  const loadBadges =
    options.loadBadges ??
    (async (channel: string) => {
      const cached = badgeCache.get(channel)
      if (cached && cached.expiresAt > now()) return cached.badges
      const response = await request(
        `/api/twitch/badges?broadcasterLogin=${encodeURIComponent(channel)}`,
        {
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(3000)]),
        },
      )
      if (!response.ok) throw new Error('Channel badges are unavailable.')
      const badges = parseTwitchBadgeCatalog(await response.json())
      badgeCache.delete(channel)
      badgeCache.set(channel, { badges, expiresAt: now() + 30 * 60 * 1000 })
      while (badgeCache.size > 64) {
        const oldest = badgeCache.keys().next().value
        if (oldest === undefined) break
        badgeCache.delete(oldest)
      }
      return badges
    })
  let active = 0
  let cachedMessages = 0
  const pump = () => {
    while (active < 3 && queue.length) queue.shift()?.start()
  }
  const remember = (key: string, batch: TwitchHistoryBatch) => {
    cache.set(key, { batch, expiresAt: now() + 15000 })
    cachedMessages += batch.messages.length
    while (cache.size > 32 || cachedMessages > 10000) {
      const oldest = cache.entries().next().value
      if (!oldest) break
      cachedMessages -= oldest[1].batch.messages.length
      cache.delete(oldest[0])
    }
  }
  return {
    load(input: TwitchHistoryRequest): Promise<TwitchHistoryBatch> {
      if (lifetime.signal.aborted) return Promise.reject(new Error('History loading stopped.'))
      const query = { ...input, channel: input.channel.trim().replace(/^#/u, '').toLowerCase() }
      const key = JSON.stringify(query)
      const cached = cache.get(key)
      if (cached && cached.expiresAt > now()) return Promise.resolve(cached.batch)
      if (cached) {
        cachedMessages -= cached.batch.messages.length
        cache.delete(key)
      }
      const existing = pending.get(key)
      if (existing) return existing
      if (pending.size >= 128)
        return Promise.reject(new Error('Too many history requests. Retry shortly.'))
      const result = new Promise<TwitchHistoryBatch>((resolve, reject) => {
        queue.push({
          reject,
          start() {
            active++
            const load = async () => {
              const [response, badges] = await Promise.all([
                request('/api/twitch/history', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(query),
                  signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(20000)]),
                }),
                loadBadges(query.channel).catch(() => new Map<string, Badge>()),
              ])
              if (!response.ok) {
                const failure = z
                  .object({ error: z.string(), sources: sourcesSchema.optional() })
                  .safeParse(await readResponse(response).catch(() => null))
                throw new TwitchHistoryFailure(
                  failure.success
                    ? failure.data.error
                    : `Twitch history backend is unavailable (${response.status}).`,
                  failure.success ? failure.data.sources : undefined,
                )
              }
              const body = responseSchema.parse(await readResponse(response))
              const batch: TwitchHistoryBatch = {
                ...body,
                messages: body.messages.flatMap((line) => {
                  const parsed = parseTwitchHistoryLine(line, query.channel, badges)
                  return parsed ? [parsed] : []
                }),
              }
              if (lifetime.signal.aborted) throw new Error('History loading stopped.')
              remember(key, batch)
              return batch
            }
            load()
              .then(resolve, reject)
              .finally(() => {
                active--
                pending.delete(key)
                pump()
              })
              .catch(reject)
          },
        })
      })
      pending.set(key, result)
      pump()
      return result
    },
    dispose() {
      lifetime.abort()
      for (const entry of queue.splice(0)) entry.reject(new Error('History loading stopped.'))
      pending.clear()
      cache.clear()
      badgeCache.clear()
      cachedMessages = 0
    },
  }
}

export type TwitchHistoryClient = ReturnType<typeof createTwitchHistoryClient>
