/**
 * Remote image cache.
 *
 * GPUI's Linux build does not fetch http(s) images at all (its asset cache
 * tries to open the URL as a file and fails with NotFound), so every remote
 * image must be downloaded by us first and handed to `<img>` as a local path.
 * Files land in `<profile>/image-cache/<sha256(url)>.<ext>`; a revision store
 * re-renders consumers when a download finishes.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { getDbPath } from '../../runtime-config'
import { createStore } from './create-store'

const resolved = new Map<string, string>()
const failed = new Map<string, number>() // url → timestamp of last failure
const inflight = new Set<string>()

export const imageCacheRevisionStore = createStore(0)

const FAILURE_RETRY_MS = 5 * 60 * 1000

let cacheDir: string | null = null
let swept = false

const MAX_CACHED_FILES = 4000
const PRUNE_DOWN_TO = 3000

function getCacheDir(): string {
  if (!cacheDir) {
    cacheDir = join(dirname(getDbPath()), 'image-cache')
    mkdirSync(cacheDir, { recursive: true })
  }
  if (!swept) {
    swept = true
    pruneCacheDir(cacheDir)
  }
  return cacheDir
}

/** Unbounded growth guard: keep the newest files by mtime. */
function pruneCacheDir(dir: string): void {
  try {
    const entries = [...new Bun.Glob('*').scanSync({ cwd: dir })]
    if (entries.length <= MAX_CACHED_FILES) return
    const withMtime = entries
      .map((name) => {
        try {
          return { name, mtime: Bun.file(join(dir, name)).lastModified }
        } catch {
          return { name, mtime: 0 }
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
    for (const entry of withMtime.slice(PRUNE_DOWN_TO)) {
      try {
        rmSync(join(dir, entry.name))
      } catch {
        // best-effort sweep
      }
    }
  } catch {
    // best-effort sweep
  }
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
  return match ? `.${match[1]!.toLowerCase()}` : '.png'
}

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32)
}

/** Synchronous read: local path if the image is already on disk. */
export function cachedImagePath(url: string | undefined): string | undefined {
  if (!url) return undefined
  return resolved.get(url)
}

/** Kick off the download if needed. No-op for cached/failed/in-flight URLs. */
export function ensureImage(url: string | undefined): void {
  if (!url || resolved.has(url) || inflight.has(url)) return
  const lastFailure = failed.get(url)
  if (lastFailure !== undefined && Date.now() - lastFailure < FAILURE_RETRY_MS) return

  inflight.add(url)
  void (async () => {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'TwirChat/0.1 (image cache)' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength === 0) throw new Error('empty body')
      const path = join(
        getCacheDir(),
        `${hashUrl(url)}${extensionFor(url, response.headers.get('content-type'))}`,
      )
      await Bun.file(path).write(bytes)
      resolved.set(url, path)
      imageCacheRevisionStore.set((v) => v + 1)
    } catch {
      failed.set(url, Date.now())
    } finally {
      inflight.delete(url)
    }
  })()
}
