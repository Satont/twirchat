import {
  providerImageSource,
  providerMetadataTarget,
  SEVENTV_COSMETICS_INVENTORY_QUERY,
  SEVENTV_COSMETICS_QUERY,
} from '@twirchat/shared/emote-proxy'
import { z } from 'zod'

export class ProviderRelayError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

interface CachedResponse {
  key: string
  version: number
  bytes: Buffer
  contentType: string
  status: number
  expires: number
}
interface Waiter {
  start(): void
}
interface ProviderRelayOptions {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  now?: () => number
  maxBytes?: number
  maxEntries?: number
  imageBytes?: number
  metadataBytes?: number
  timeoutMs?: number
  maxConcurrent?: number
  maxPending?: number
}
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
const cosmeticsSchema = z.strictObject({
  query: z.union([
    z.literal(SEVENTV_COSMETICS_QUERY),
    z.literal(SEVENTV_COSMETICS_INVENTORY_QUERY),
  ]),
  variables: z.strictObject({
    platform: z.enum(['TWITCH', 'KICK']),
    platformId: identifier,
  }),
})
const presenceSchema = z.strictObject({
  kind: z.literal(1),
  data: z.strictObject({ id: identifier, platform: z.enum(['TWITCH', 'KICK']) }),
})

export async function readRelayBody(
  request: Pick<Request, 'body' | 'headers'>,
  limit: number,
): Promise<Buffer> {
  if (Number(request.headers.get('content-length')) > limit)
    throw new ProviderRelayError('Provider request is too large.', 413)
  const reader = request.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      // Enforce the byte limit while reading, including chunked bodies.
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) throw new ProviderRelayError('Provider response is too large.', 413)
      chunks.push(chunk.value)
    }
    return Buffer.concat(chunks, size)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function createProviderRelay(options: ProviderRelayOptions = {}) {
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init))
  const now = options.now ?? Date.now
  const cache = new Map<string, CachedResponse>()
  let order: Array<{ key: string; version: number }> = []
  const pending = new Map<string, Promise<CachedResponse>>()
  const waiting: Waiter[] = []
  const maxBytes = options.maxBytes ?? 96 * 1024 * 1024
  const maxEntries = options.maxEntries ?? 512
  const maxConcurrent = options.maxConcurrent ?? 8
  const maxPending = options.maxPending ?? 128
  let bytes = 0
  let version = 0
  let active = 0

  const remember = (entry: CachedResponse) => {
    if (entry.bytes.byteLength > maxBytes) return
    const previous = cache.get(entry.key)
    if (previous) bytes -= previous.bytes.byteLength
    cache.set(entry.key, entry)
    bytes += entry.bytes.byteLength
    order.push({ key: entry.key, version: entry.version })
    while (cache.size > maxEntries || bytes > maxBytes) {
      const oldest = order.shift()
      if (!oldest) break
      const existing = cache.get(oldest.key)
      if (existing?.version === oldest.version) {
        cache.delete(oldest.key)
        bytes -= existing.bytes.byteLength
      }
    }
    if (order.length > maxEntries * 2)
      order = order.filter((item) => cache.get(item.key)?.version === item.version)
  }
  const acquire = (signal: AbortSignal): Promise<void> => {
    if (signal.aborted)
      return Promise.reject(new ProviderRelayError('Provider request timed out.', 504))
    if (active < maxConcurrent) {
      active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        const index = waiting.indexOf(waiter)
        if (index >= 0) waiting.splice(index, 1)
        reject(new ProviderRelayError('Provider request timed out.', 504))
      }
      const waiter: Waiter = {
        start() {
          signal.removeEventListener('abort', abort)
          resolve()
        },
      }
      signal.addEventListener('abort', abort, { once: true })
      waiting.push(waiter)
    })
  }
  const release = () => {
    const next = waiting.shift()
    if (next) next.start()
    else active--
  }
  const request = (
    key: string,
    url: string,
    kind: 'image' | 'catalog' | 'cosmetics' | 'presence',
    body?: string,
  ): Promise<CachedResponse> => {
    const existing = cache.get(key)
    if (existing && existing.expires > now()) return Promise.resolve(existing)
    const inflight = pending.get(key)
    if (inflight) return inflight
    if (pending.size >= maxPending)
      return Promise.reject(new ProviderRelayError('Provider relay is busy.', 503))
    const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000)
    const task = (async () => {
      await acquire(signal)
      try {
        const upstream = await fetcher(url, {
          method: body === undefined ? 'GET' : 'POST',
          redirect: 'error',
          headers:
            body === undefined
              ? { Accept: kind === 'image' ? 'image/avif,image/webp,image/*' : 'application/json' }
              : { Accept: 'application/json', 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body }),
          signal,
        })
        if (!upstream.ok && upstream.status !== 404) {
          await upstream.body?.cancel()
          throw new ProviderRelayError('Provider returned HTTP ' + upstream.status + '.', 502)
        }
        const limit =
          kind === 'image'
            ? (options.imageBytes ?? 20 * 1024 * 1024)
            : (options.metadataBytes ?? 8 * 1024 * 1024)
        const contentType = upstream.headers.get('content-type') ?? ''
        if (upstream.ok && kind === 'image' && !/^image\//i.test(contentType)) {
          await upstream.body?.cancel()
          throw new ProviderRelayError('Provider returned an unsupported image.', 502)
        }
        const data = await readRelayBody(upstream, limit)
        if (kind !== 'image' && upstream.ok && data.length) {
          try {
            JSON.parse(data.toString('utf8'))
          } catch {
            throw new ProviderRelayError('Provider returned invalid JSON.', 502)
          }
        }
        const result: CachedResponse = {
          key,
          version: ++version,
          bytes: data,
          status: upstream.status,
          contentType: upstream.status === 404 ? 'text/plain; charset=utf-8' : contentType,
          expires:
            now() +
            (upstream.status === 404
              ? 30_000
              : kind === 'image'
                ? 86_400_000
                : kind === 'catalog'
                  ? 300_000
                  : 60_000),
        }
        if (kind !== 'presence') remember(result)
        return result
      } catch (error) {
        if (signal.aborted) throw new ProviderRelayError('Provider request timed out.', 504)
        throw error
      } finally {
        release()
      }
    })().finally(() => pending.delete(key))
    pending.set(key, task)
    return task
  }
  const response = (entry: CachedResponse, image = false): Response =>
    new Response(entry.status === 204 ? null : entry.bytes, {
      status: entry.status,
      headers: {
        'Content-Type': entry.contentType || 'application/json',
        'Cache-Control':
          entry.status === 404
            ? 'public, max-age=30'
            : image
              ? 'public, max-age=86400'
              : 'private, max-age=60',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
        'X-Proxy-By': 'twirchat',
      },
    })
  return {
    async image(source: string): Promise<Response> {
      const target = providerImageSource(source)
      if (!target) throw new ProviderRelayError('Unsupported provider image URL.')
      return response(await request(target.href, target.href, 'image'), true)
    },
    async metadata(source: string, body?: unknown): Promise<Response> {
      const target = providerMetadataTarget(source)
      if (!target) throw new ProviderRelayError('Unsupported provider metadata URL.')
      if (target.kind === 'catalog') {
        if (body !== undefined) throw new ProviderRelayError('Catalog requests must use GET.')
        return response(await request(target.url.href, target.url.href, 'catalog'))
      }
      const parsed =
        target.kind === 'cosmetics'
          ? cosmeticsSchema.safeParse(body)
          : presenceSchema.safeParse(body)
      if (!parsed.success) throw new ProviderRelayError('Invalid provider request.')
      const serialized = JSON.stringify(parsed.data)
      return response(
        await request(target.url.href + ':' + serialized, target.url.href, target.kind, serialized),
      )
    },
  }
}

export const providerRelay = createProviderRelay()
