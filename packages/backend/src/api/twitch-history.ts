import type {
  TwitchHistoryRequest,
  TwitchHistoryResponse,
  TwitchHistorySource,
} from '@twirchat/shared/twitch-history'
import { z } from 'zod'

const loginSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^#/, '').toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9_]{1,25}$/))
const epochSchema = z.number().int().min(0).max(8640000000000000)
export const twitchHistoryRequestSchema: z.ZodType<TwitchHistoryRequest> = z
  .strictObject({
    channel: loginSchema,
    limit: z.number().int().min(1).max(1000),
    before: epochSchema.optional(),
    beforeId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .optional(),
    after: epochSchema.optional(),
    username: loginSchema.optional(),
    userId: z
      .string()
      .regex(/^[0-9]{1,25}$/)
      .optional(),
    archive: z.boolean().optional(),
    offset: z.number().int().min(0).max(100000).optional(),
    beforeIdInclusive: z.boolean().optional(),
    text: z.string().toLowerCase().max(2000).optional(),
  })
  .refine(
    (query) =>
      query.before === undefined || query.after === undefined || query.after < query.before,
    {
      message: 'after must be earlier than before.',
    },
  )
  .refine((query) => query.beforeId === undefined || query.before !== undefined, {
    message: 'beforeId requires a before timestamp.',
  })
  .refine((query) => query.beforeIdInclusive === undefined || query.beforeId !== undefined, {
    message: 'beforeIdInclusive requires beforeId.',
  })

const providerSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  kind: z.enum(['recent', 'archive']),
  maxMessages: z.number().int().min(1).max(5000).optional(),
  url: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value.replace('{channel}', 'channel'))
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.hash &&
          !/[{}]/.test(value.replace('{channel}', ''))
        )
      } catch {
        return false
      }
    }, 'Provider URLs must use HTTPS without credentials or fragments.'),
})
export type TwitchHistoryProvider = z.infer<typeof providerSchema>

export const defaultTwitchHistoryProviders: TwitchHistoryProvider[] = [
  {
    id: 'lilb',
    kind: 'recent',
    url: 'https://rm.lilb.dev/api/v2/recent-messages/{channel}',
    maxMessages: 500,
  },
  {
    id: 'robotty',
    kind: 'recent',
    url: 'https://recent-messages.robotty.de/api/v2/recent-messages/{channel}',
    maxMessages: 800,
  },
  {
    id: 'zneix',
    kind: 'recent',
    url: 'https://recent-messages.zneix.eu/api/v2/recent-messages/{channel}',
    maxMessages: 800,
  },
  { id: 'zonian', kind: 'recent', url: 'https://logs.zonian.dev/rm/{channel}', maxMessages: 5000 },
  {
    id: 'iore',
    kind: 'recent',
    url: 'https://rm.iore.tv/api/v2/recent-messages/{channel}',
    maxMessages: 5000,
  },
  { id: 'zonian-archive', kind: 'archive', url: 'https://logs.zonian.dev' },
]

export function parseTwitchHistoryProviders(value: string | undefined): TwitchHistoryProvider[] {
  if (value === undefined || !value.trim())
    return defaultTwitchHistoryProviders.map((provider) => ({ ...provider }))
  const parsed: unknown = JSON.parse(value)
  const providers = z.array(providerSchema).max(12).parse(parsed)
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length)
    throw new Error('Twitch history provider IDs must be unique.')
  for (const provider of providers) {
    if (provider.kind === 'recent' && !provider.url.includes('{channel}'))
      throw new Error('Recent-message provider URLs must contain {channel}.')
    if (provider.kind === 'archive' && provider.url.includes('{channel}'))
      throw new Error('Archive provider URLs must be a base URL.')
  }
  return providers
}

const rawSchema = z
  .string()
  .min(1)
  .max(16384)
  .refine((value) => !/[\r\n\0]/.test(value))
const recentResponseSchema = z.object({
  messages: z.array(rawSchema).max(10000).optional(),
  error: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
})
const archiveResponseSchema = z.object({
  messages: z
    .array(
      z.object({
        raw: rawSchema,
        id: z.string().max(200),
        timestamp: z.string().datetime({ offset: true }),
      }),
    )
    .max(1000),
})

interface HistoricalLine {
  raw: string
  id: string
  timestamp: number
  username: string
  userId: string | undefined
  deleted: boolean
  text: string
}

function historyLine(raw: string, channel: string): HistoricalLine | null {
  const match = /^@([^ ]+) :([^ !]+)(?:![^ ]+)? PRIVMSG #([A-Za-z0-9_]+) :/.exec(raw)
  if (!match || match[3]?.toLowerCase() !== channel) return null
  const tags = new Map(
    (match[1] ?? '').split(';').map((tag): [string, string] => {
      const separator = tag.indexOf('=')
      return separator < 0 ? [tag, ''] : [tag.slice(0, separator), tag.slice(separator + 1)]
    }),
  )
  const id = tags.get('id')
  const sentAt = tags.get('tmi-sent-ts')
  const timestamp = Number(sentAt)
  const username = (match[2] ?? '').toLowerCase()
  if (
    !id ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(id) ||
    !sentAt ||
    !/^[0-9]+$/.test(sentAt) ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > 8640000000000000 ||
    !/^[a-z0-9_]{1,25}$/.test(username)
  )
    return null
  const content = raw.slice(match[0].length)
  const text = content.startsWith('\u0001ACTION ')
    ? content.slice(8, content.endsWith('\u0001') ? -1 : undefined)
    : content
  return {
    raw,
    id,
    timestamp,
    username,
    userId: tags.get('user-id'),
    deleted: ['1', 'true'].includes(tags.get('rm-deleted') ?? ''),
    text,
  }
}

function inQuery(line: HistoricalLine, query: TwitchHistoryRequest): boolean {
  if (
    query.beforeId !== undefined &&
    query.before !== undefined &&
    line.timestamp === query.before - 1 &&
    (line.id > query.beforeId || (line.id === query.beforeId && !query.beforeIdInclusive))
  )
    return false
  return (
    (query.before === undefined || line.timestamp < query.before) &&
    (query.after === undefined || line.timestamp > query.after) &&
    (!query.text || line.text.toLowerCase().includes(query.text)) &&
    (query.userId !== undefined
      ? line.userId === query.userId
      : query.username === undefined || line.username === query.username)
  )
}

function compareHistoryLines(left: HistoricalLine, right: HistoricalLine): number {
  return left.timestamp - right.timestamp || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
}

export class TwitchHistoryError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly sources: TwitchHistorySource[] = [],
  ) {
    super(message)
  }
}

interface ProviderResult {
  source: TwitchHistorySource
  messages: HistoricalLine[]
  truncated: boolean
  partial?: boolean
}
interface CacheEntry<T> {
  key: string
  value: T
  bytes: number
  expiresAt: number
}
interface Dependencies {
  fetch(url: string, init?: RequestInit): Promise<Response>
  now(): number
}
interface HistoryOptions {
  providers?: readonly TwitchHistoryProvider[]
  timeoutMs?: number
  responseBytes?: number
  cacheBytes?: number
  cacheEntries?: number
  concurrency?: number
}

interface RequestWaiter {
  start(): void
}

function createHistoryCache<T>(maximumEntries: number, maximumBytes: number, now: () => number) {
  const entries: CacheEntry<T>[] = []
  let cachedBytes = 0
  return {
    get(key: string): T | undefined {
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]
        if (entry && entry.expiresAt <= now()) {
          cachedBytes -= entry.bytes
          entries.splice(index, 1)
        }
      }
      return entries.find((entry) => entry.key === key)?.value
    },
    set(key: string, value: T, ttl: number) {
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
      if (bytes > maximumBytes || maximumEntries <= 0) return
      while (entries.length >= maximumEntries || cachedBytes + bytes > maximumBytes) {
        const entry = entries.shift()
        if (!entry) break
        cachedBytes -= entry.bytes
      }
      entries.push({ key, value, bytes, expiresAt: now() + ttl })
      cachedBytes += bytes
    },
  }
}

function createRequestGate(concurrency: number) {
  const queue: RequestWaiter[] = []
  let active = 0
  return async function run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    if (active < concurrency) active++
    else {
      if (queue.length >= 512) throw new Error('History provider queue is full.')
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          const index = queue.indexOf(waiter)
          if (index >= 0) queue.splice(index, 1)
          reject(new Error('History provider request timed out.'))
        }
        const waiter: RequestWaiter = {
          start() {
            signal.removeEventListener('abort', abort)
            resolve()
          },
        }
        queue.push(waiter)
        signal.addEventListener('abort', abort, { once: true })
      })
    }
    try {
      signal.throwIfAborted()
      return await operation()
    } finally {
      const next = queue.shift()
      if (next) next.start()
      else active--
    }
  }
}

export async function readTwitchHistoryJson(
  response: Pick<Response, 'body' | 'headers'>,
  maximum: number,
  onBytes?: (bytes: number) => void,
): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel().catch(() => {})
    throw new TwitchHistoryError('History payload exceeds the byte limit.', 413)
  }
  if (!response.body) throw new Error('History provider returned an empty response.')
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > maximum) throw new TwitchHistoryError('History payload exceeds the byte limit.', 413)
    chunks.push(chunk)
  }
  onBytes?.(size)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

function providerUrl(
  provider: TwitchHistoryProvider,
  query: TwitchHistoryRequest,
  now: number,
): string {
  const userPath = query.userId
    ? `/userid/${query.userId}`
    : query.username
      ? `/user/${query.username}`
      : ''
  const url = new URL(
    provider.kind === 'recent'
      ? provider.url.replace('{channel}', encodeURIComponent(query.channel))
      : `${provider.url.replace(/\/$/, '')}/channel/${query.channel}${userPath}`,
  )
  url.searchParams.set(
    'limit',
    String(provider.kind === 'recent' ? (provider.maxMessages ?? 5000) : query.limit),
  )
  if (provider.kind === 'recent') {
    // RM cursors use receipt time; filter its complete bounded window by Twitch send time.
    url.searchParams.set('hide_moderation_messages', 'true')
    url.searchParams.set('hide_moderated_messages', 'true')
  } else {
    url.searchParams.set('json', 'true')
    url.searchParams.set('reverse', 'true')
    if (query.offset) url.searchParams.set('offset', String(query.offset))
    // Explicit bounds query the archive instead of its default latest-day/month redirect.
    url.searchParams.set('from', new Date(query.after ?? 0).toISOString())
    url.searchParams.set('to', new Date(query.before ?? now).toISOString())
  }
  return url.href
}

export function createTwitchHistoryService(
  options: HistoryOptions = {},
  dependencies: Dependencies = { fetch: (url, init) => fetch(url, init), now: Date.now },
) {
  const providers = options.providers ?? defaultTwitchHistoryProviders
  const pending = new Map<string, Promise<TwitchHistoryResponse>>()
  const maximumCacheBytes = Math.floor((options.cacheBytes ?? 16 * 1024 * 1024) / 2)
  const maximumCacheEntries = options.cacheEntries ?? 128
  const cache = createHistoryCache<TwitchHistoryResponse>(
    maximumCacheEntries,
    maximumCacheBytes,
    () => dependencies.now(),
  )
  const recentCache = createHistoryCache<ProviderResult>(
    maximumCacheEntries,
    maximumCacheBytes,
    () => dependencies.now(),
  )
  const recentPending = new Map<string, Promise<ProviderResult>>()
  const timeoutMs = options.timeoutMs ?? 5000
  const runRequest = createRequestGate(options.concurrency ?? 16)

  async function requestProvider(
    provider: TwitchHistoryProvider,
    query: TwitchHistoryRequest,
  ): Promise<ProviderResult> {
    const source: TwitchHistorySource = {
      id: provider.id,
      kind: provider.kind,
      status: 'ok',
      messages: 0,
      capabilities: provider.kind === 'recent' ? ['recent', 'time'] : ['user', 'time'],
    }
    try {
      const signal = AbortSignal.timeout(timeoutMs)
      return await runRequest(signal, async () => {
        const messages: HistoricalLine[] = []
        const matching = new Map<string, HistoricalLine>()
        const deleted = new Set<string>()
        const snapshotTime = dependencies.now()
        let offset = query.offset ?? 0
        let remainingBytes = options.responseBytes ?? 4 * 1024 * 1024
        const partial = (error: string): ProviderResult => ({
          source: { ...source, messages: messages.length, error },
          messages,
          truncated: true,
          partial: true,
        })
        for (let page = 0; page < 16; page++) {
          let raw: string[]
          try {
            const pageQuery =
              provider.kind === 'archive' ? { ...query, limit: 1000, offset } : query
            // Archive offsets depend on the preceding page and its timestamp tie.
            // eslint-disable-next-line no-await-in-loop
            const response = await dependencies.fetch(
              providerUrl(provider, pageQuery, snapshotTime),
              {
                headers: { Accept: 'application/json' },
                signal,
                redirect: 'error',
              },
            )
            if (!response.ok) {
              // eslint-disable-next-line no-await-in-loop
              await response.body?.cancel().catch(() => {})
              if (page > 0) return partial(`Archive scan stopped at HTTP ${response.status}.`)
              return {
                source: {
                  ...source,
                  status: [403, 404, 410].includes(response.status) ? 'unavailable' : 'error',
                  error: `Provider returned HTTP ${response.status}.`,
                },
                messages: [],
                truncated: false,
              }
            }
            // eslint-disable-next-line no-await-in-loop
            const body = await readTwitchHistoryJson(response, remainingBytes, (bytes) => {
              remainingBytes -= bytes
            })
            if (provider.kind === 'archive') {
              raw = archiveResponseSchema.parse(body).messages.map((message) => message.raw)
            } else {
              const parsed = recentResponseSchema.parse(body)
              if (parsed.error || parsed.error_code)
                return {
                  source: {
                    ...source,
                    status: 'unavailable',
                    error: (parsed.error ?? parsed.error_code ?? '').slice(0, 200),
                  },
                  messages: [],
                  truncated: false,
                }
              if (!parsed.messages) throw new Error('History provider omitted messages.')
              raw = parsed.messages.slice(-(provider.maxMessages ?? 5000))
            }
          } catch (error) {
            if (page > 0)
              return partial(
                error instanceof Error
                  ? `Archive scan stopped: ${error.message.slice(0, 160)}`
                  : 'Archive scan stopped before completion.',
              )
            throw error
          }
          const pageMessages = raw.flatMap((line) => {
            const parsed = historyLine(line, query.channel)
            return parsed ? [parsed] : []
          })
          messages.push(...pageMessages)
          for (const message of pageMessages) {
            if (message.deleted) {
              deleted.add(message.id)
              matching.delete(message.id)
            } else if (!deleted.has(message.id) && inQuery(message, query))
              matching.set(message.id, message)
          }
          const pageSize = provider.kind === 'archive' ? 1000 : (provider.maxMessages ?? 5000)
          const fullPage = raw.length >= pageSize
          const cutoff = [...matching.values()].toSorted((a, b) => compareHistoryLines(b, a))[
            query.limit - 1
          ]
          const passedTie =
            cutoff && pageMessages.some((message) => message.timestamp < cutoff.timestamp)
          if (provider.kind === 'recent' || !fullPage || passedTie)
            return {
              source: { ...source, messages: messages.length },
              messages,
              truncated: fullPage || matching.size > query.limit,
            }
          if (remainingBytes <= 0)
            return partial(
              'Archive scan reached its byte budget before completing the requested window.',
            )
          offset += raw.length
        }
        return partial(
          'Archive scan reached its page budget before completing the requested window.',
        )
      })
    } catch (error) {
      return {
        source: {
          ...source,
          status: 'error',
          error: error instanceof Error ? error.message.slice(0, 200) : 'History provider failed.',
        },
        messages: [],
        truncated: false,
      }
    }
  }

  async function fetchProvider(
    provider: TwitchHistoryProvider,
    query: TwitchHistoryRequest,
  ): Promise<ProviderResult> {
    if (provider.kind === 'archive') return requestProvider(provider, query)
    const key = `${provider.id}:${query.channel}`
    const cached = recentCache.get(key)
    if (cached) return cached
    const inflight = recentPending.get(key)
    if (inflight) return inflight
    const request = requestProvider(provider, query)
      .then((result) => {
        recentCache.set(key, result, result.source.status === 'ok' ? 15000 : 3000)
        return result
      })
      .finally(() => recentPending.delete(key))
    recentPending.set(key, request)
    return request
  }

  async function load(query: TwitchHistoryRequest): Promise<TwitchHistoryResponse> {
    const selected = providers.filter(
      (provider) =>
        provider.kind === 'recent' ||
        query.archive === true ||
        (query.archive !== false && (query.username !== undefined || query.userId !== undefined)),
    )
    if (selected.length === 0)
      return { messages: [], sources: [], partial: false, truncated: false }
    const unique = new Map<string, HistoricalLine>()
    const priority = new Map<string, number>()
    const deleted = new Set<string>()
    let trimmed = false
    const results = await Promise.all(
      selected.map(async (provider, index) => {
        const result = await fetchProvider(provider, query)
        for (const message of result.messages) {
          if (message.deleted) {
            deleted.add(message.id)
            unique.delete(message.id)
            priority.delete(message.id)
          } else if (
            inQuery(message, query) &&
            !deleted.has(message.id) &&
            index < (priority.get(message.id) ?? Infinity)
          ) {
            unique.set(message.id, message)
            priority.set(message.id, index)
          }
        }
        const ordered = [...unique.values()].toSorted((a, b) => compareHistoryLines(b, a))
        let bytes = 0
        for (let position = 0; position < ordered.length; position++) {
          const message = ordered[position]
          if (!message) continue
          bytes += message.raw.length * 2
          if (position >= query.limit || bytes > 4 * 1024 * 1024) {
            unique.delete(message.id)
            priority.delete(message.id)
            trimmed = true
          }
        }
        return {
          source: result.source,
          truncated: result.truncated,
          partial: result.partial ?? false,
        }
      }),
    )
    const sources = results.map((result) => result.source)
    if (sources.every((source) => source.status !== 'ok'))
      throw new TwitchHistoryError('No Twitch history provider is available.', 502, sources)
    const merged = [...unique.values()].toSorted(compareHistoryLines)
    return {
      messages: merged.slice(-query.limit).map((message) => message.raw),
      sources,
      partial:
        sources.some((source) => source.status !== 'ok') ||
        results.some((result) => result.partial),
      truncated: trimmed || results.some((result) => result.truncated),
    }
  }

  return {
    async getHistory(input: unknown): Promise<TwitchHistoryResponse> {
      const query = twitchHistoryRequestSchema.parse(input)
      const key = JSON.stringify(query)
      const cached = cache.get(key)
      if (cached) return cached
      const inflight = pending.get(key)
      if (inflight) return inflight
      if (pending.size >= 64)
        throw new TwitchHistoryError('Twitch history is busy. Please retry.', 429)
      const request = load(query)
        .then((response) => {
          cache.set(
            key,
            response,
            response.partial
              ? 3000
              : query.archive || query.username || query.userId
                ? 60000
                : 15000,
          )
          return response
        })
        .finally(() => pending.delete(key))
      pending.set(key, request)
      return request
    },
  }
}
