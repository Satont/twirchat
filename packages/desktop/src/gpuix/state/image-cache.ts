import { createHash } from 'node:crypto'
/**
 * Remote image cache.
 *
 * GPUI's Linux build does not fetch http(s) images at all (its asset cache
 * tries to open the URL as a file and fails with NotFound), so every remote
 * image must be downloaded by us first and handed to `<img>` as a local path.
 * Files land in `<profile>/image-cache/<sha256(url)>.<ext>`. Downloads share a
 * bounded queue, and each image has its own deferred store notification.
 */
import { createWriteStream, mkdirSync, readdirSync } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { getDbPath } from '../../runtime-config'
import { runInBackground } from '../../services/background-task'
import { deleteOldestEntry } from '../../services/bounded-cache'
import { type ImageSweepLimits, sweepImageDirectoryOnce } from '../../services/image-cache-sweep'
import { fetchProviderImage } from '../../services/provider-relay'
import { createStore, type Store } from './create-store'
import { persistentResource } from './persistent-resources'

export const imageCacheRevisionStore = persistentResource('imageCacheRevision', () =>
  createStore<number>(0),
)

const MAX_CACHED_FILES = 4000
const FAILURE_RETRY_MS = 5 * 60 * 1000
const MAX_DOWNLOADS = 6
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const IMAGE_FILE = /^([a-f0-9]{32})\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)$/i
const DISK_LIMITS: ImageSweepLimits = {
  pattern: IMAGE_FILE,
  temporaryPattern: /^[a-f0-9]{32}\.[a-f0-9-]{36}\.download$/i,
  maxFiles: MAX_CACHED_FILES,
  keepFiles: 3000,
}

const EXTENSIONS_BY_CONTENT_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/tiff': '.tiff',
  'image/avif': '.avif',
}

function extensionFor(url: string, contentType: string | null): string {
  if (contentType) {
    const base = contentType.split(';')[0]?.trim().toLowerCase()
    const ext = base ? EXTENSIONS_BY_CONTENT_TYPE[base] : undefined
    if (ext) return ext
  }
  const path = new URL(url, 'https://placeholder.invalid').pathname
  const match = path.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)$/i)
  return match?.[1] ? `.${match[1].toLowerCase()}` : '.png'
}

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32)
}

async function* limitImageBody(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  let size = 0
  try {
    while (true) {
      // Read only when the file stream is ready for another chunk.
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_IMAGE_BYTES) throw new Error('image is too large')
      yield chunk.value
    }
    if (size === 0) throw new Error('empty body')
  } finally {
    reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Synchronous read: local path if the image is already on disk. */
export function cachedImagePath(url: string | undefined): string | undefined {
  return imageCache.cachedImagePath(url)
}

/** null means a failed request; undefined means not loaded yet. */
export type ImageSnapshot = string | null | undefined

interface ImageEntry {
  state: Store<ImageSnapshot>
  failedAt?: number
  subscribers: number
  pending: boolean
}

/** Separate instances keep profiles and tests independent. */
export function createImageCache(options: {
  directory: () => string
  now?: () => number
  maxEntries?: number
  onUpdate?: () => void
}) {
  const entries = new Map<string, ImageEntry>()
  const queue: { url: string; entry: ImageEntry }[] = []
  const now = options.now ?? Date.now
  const maxEntries = options.maxEntries ?? MAX_CACHED_FILES
  let downloads = 0
  let directoryPath: string | undefined
  let directory: string | undefined
  let diskFiles: Map<string, string> | undefined

  function getDirectoryPath(): string {
    directoryPath ??= options.directory()
    return directoryPath
  }

  /** Lists files after the process-wide sweep, so every listed file stays on disk. */
  function getDirectory(): string {
    if (directory) return directory
    directory = getDirectoryPath()
    mkdirSync(directory, { recursive: true })
    diskFiles = new Map()
    for (const file of readdirSync(directory)) {
      const hash = file.match(IMAGE_FILE)?.[1]
      if (hash) diskFiles.set(hash, join(directory, file))
    }
    return directory
  }

  function trimEntries(): void {
    if (entries.size <= maxEntries) return
    for (const [url, entry] of entries) {
      if (!entry.pending && entry.subscribers === 0) entries.delete(url)
      if (entries.size <= maxEntries) break
    }
  }

  function getEntry(url: string): ImageEntry {
    const existing = entries.get(url)
    if (existing) {
      entries.delete(url)
      entries.set(url, existing)
      return existing
    }
    const entry: ImageEntry = {
      state: createStore<ImageSnapshot>(undefined),
      subscribers: 0,
      pending: false,
    }
    entries.set(url, entry)
    return entry
  }

  async function load(url: string): Promise<string> {
    await sweepImageDirectoryOnce(getDirectoryPath(), DISK_LIMITS)
    const dir = getDirectory()
    const hash = hashUrl(url)
    const savedPath = diskFiles?.get(hash)
    if (savedPath) {
      const saved = Bun.file(savedPath)
      if ((await saved.exists()) && saved.size > 0 && saved.size <= MAX_IMAGE_BYTES)
        return savedPath
      diskFiles?.delete(hash)
    }
    const response = await fetchProviderImage(url, {
      headers: { 'User-Agent': 'TwirChat/0.1 (image cache)' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    }
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
      await response.body?.cancel()
      throw new Error('image is too large')
    }
    if (!response.body) throw new Error('empty body')
    const path = join(dir, `${hash}${extensionFor(url, response.headers.get('content-type'))}`)
    const temporary = join(dir, `${hash}.${crypto.randomUUID()}.download`)
    try {
      await pipeline(limitImageBody(response.body), createWriteStream(temporary, { flags: 'wx' }))
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
    diskFiles?.set(hash, path)
    if (diskFiles && diskFiles.size > MAX_CACHED_FILES) {
      deleteOldestEntry(diskFiles)
    }
    return path
  }

  function drainQueue(): void {
    while (downloads < MAX_DOWNLOADS && queue.length > 0) {
      const job = queue.shift()
      if (!job) break
      downloads++
      runInBackground(
        load(job.url)
          .then((path) => {
            job.entry.failedAt = undefined
            job.entry.state.set(path)
          })
          .catch(() => {
            job.entry.failedAt = now()
            job.entry.state.set(null)
          })
          .finally(() => {
            job.entry.pending = false
            downloads--
            options.onUpdate?.()
            trimEntries()
            drainQueue()
          }),
        'image-cache background operation failed',
      )
    }
  }

  return {
    snapshot(url: string | undefined): ImageSnapshot {
      return url ? entries.get(url)?.state.get() : undefined
    },
    cachedImagePath(url: string | undefined): string | undefined {
      const snapshot = url ? entries.get(url)?.state.get() : undefined
      return typeof snapshot === 'string' ? snapshot : undefined
    },
    subscribe(url: string | undefined, listener: () => void): () => void {
      if (!url) return () => {}
      const entry = getEntry(url)
      entry.subscribers++
      let subscribed = true
      const unsubscribe = entry.state.subscribe(() => {
        if (subscribed) listener()
      })
      return () => {
        if (!subscribed) return
        subscribed = false
        unsubscribe()
        entry.subscribers--
        if (entry.subscribers === 0) {
          const queued = queue.findIndex((job) => job.entry === entry)
          if (queued >= 0) {
            queue.splice(queued, 1)
            entry.pending = false
          }
        }
        trimEntries()
      }
    },
    ensureImage(url: string | undefined): void {
      if (!url) return
      const entry = getEntry(url)
      if (entry.pending || typeof entry.state.get() === 'string') return
      if (entry.failedAt !== undefined && now() - entry.failedAt < FAILURE_RETRY_MS) return
      entry.pending = true
      entry.state.set(undefined)
      queue.push({ url, entry })
      trimEntries()
      drainQueue()
    },
  }
}

const imageCache = createImageCache({
  directory: () => join(dirname(getDbPath()), 'image-cache'),
  onUpdate: () => imageCacheRevisionStore.modify((v) => v + 1),
})

export const imageSnapshot = imageCache.snapshot
export const subscribeImage = imageCache.subscribe
export const ensureImage = imageCache.ensureImage

/** True while the last download attempt failed. */
export function imageFailed(url: string | undefined): boolean {
  return imageSnapshot(url) === null
}

declare module './persistent-resources' {
  interface PersistentResources {
    imageCacheRevision: Store<number>
  }
}
