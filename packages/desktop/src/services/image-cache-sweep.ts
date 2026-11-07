/**
 * Size limits for on-disk image caches whose paths are handed to native `<img>`.
 *
 * GPUI re-reads a path whenever its decoded entry is evicted and keeps a failed read for
 * as long as the image stays mounted. Deleting a file during a session therefore breaks
 * every row that still shows it, while the JS caches keep returning the same path. Each
 * directory is swept once per app process (surviving HMR), before any of its paths is
 * handed out; within a session these caches only grow, like the browser disk cache.
 */
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export interface ImageSweepLimits {
  /** Generated file names. Temporary files and subdirectories must not match. */
  pattern: RegExp
  maxFiles: number
  keepFiles: number
  maxBytes?: number
  keepBytes?: number
}

declare global {
  var __twirchatImageSweeps: Map<string, Promise<void>> | undefined
}

let sweepsEnabled = true

/** Image workers are short-lived children of an app process that has already swept. */
export function disableImageSweeps(): void {
  sweepsEnabled = false
}

async function sweep(directory: string, limits: ImageSweepLimits): Promise<void> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    // A missing directory has nothing to sweep; the cache creates it on first write.
    return
  }
  const files = names
    .filter((name) => limits.pattern.test(name))
    .map((name) => {
      const file = Bun.file(join(directory, name))
      return { name, time: file.lastModified, bytes: file.size }
    })
  const maxBytes = limits.maxBytes ?? Number.POSITIVE_INFINITY
  const keepBytes = limits.keepBytes ?? maxBytes
  let count = files.length
  let bytes = files.reduce((total, file) => total + file.bytes, 0)
  if (count <= limits.maxFiles && bytes <= maxBytes) return
  const removed: string[] = []
  for (const file of files.toSorted((a, b) => a.time - b.time)) {
    if (count <= limits.keepFiles && bytes <= keepBytes) break
    removed.push(file.name)
    count--
    bytes -= file.bytes
  }
  await Promise.all(
    removed.map((name) =>
      unlink(join(directory, name)).catch(() => {
        // Already gone or locked by another process; the next app start retries.
      }),
    ),
  )
}

/** Resolves once `directory` has been swept by this process; never rejects. */
export function sweepImageDirectoryOnce(
  directory: string,
  limits: ImageSweepLimits,
): Promise<void> {
  if (!sweepsEnabled) return Promise.resolve()
  const sweeps = (globalThis.__twirchatImageSweeps ??= new Map())
  const existing = sweeps.get(directory)
  if (existing) return existing
  const pending = sweep(directory, limits).catch((error: unknown) => {
    console.warn('[image-cache] Sweep failed:', directory, error)
  })
  sweeps.set(directory, pending)
  return pending
}
