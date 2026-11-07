import { createHash } from 'node:crypto'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { getDbPath } from '../runtime-config'
import { type ImageSweepLimits, sweepImageDirectoryOnce } from './image-cache-sweep'
import { loadSharp } from './paint-renderer'
import { paintWorker } from './paint-worker-client'

const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_INPUT_PIXELS = 16_000_000
const DISK_LIMITS: ImageSweepLimits = {
  pattern: /^[a-f0-9]{32}\.png$/,
  maxFiles: 2000,
  keepFiles: 1600,
  maxBytes: 64 * 1024 * 1024,
  keepBytes: 48 * 1024 * 1024,
}

// GPUIX exposes no display scale; a 2× raster preserves detail on both 1× and 2× displays.
export function avatarRasterSize(size: number, scale = 2): number {
  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    size > 512 ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    scale > 4
  )
    throw new Error('Invalid avatar dimensions.')
  return Math.min(1024, Math.ceil(size * scale))
}

export function createAvatarThumbnailer(options: { directory: () => string }) {
  const pending = new Map<string, Promise<string>>()
  const waiting: Array<() => void> = []
  let active = 0

  function render(path: string, size: number, scale = 2): Promise<string> {
    const pixels = avatarRasterSize(size, scale)
    const file = Bun.file(path)
    const directory = options.directory()
    const key = createHash('sha256')
      .update(JSON.stringify([1, path, file.size, file.lastModified, pixels]))
      .digest('hex')
      .slice(0, 32)
    const previous = pending.get(key)
    if (previous) return previous
    if (waiting.length >= 100) return Promise.reject(new Error('Avatar rendering queue is full.'))
    const task = (async () => {
      if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
      else active++
      try {
        if (file.size === 0 || file.size > MAX_INPUT_BYTES)
          throw new Error('Avatar exceeds the image byte budget.')
        await sweepImageDirectoryOnce(directory, DISK_LIMITS)
        const outputPath = join(directory, `${key}.png`)
        if (await Bun.file(outputPath).exists()) return outputPath
        if (import.meta.dir.includes('$bunfs') || import.meta.dir.includes('~BUN')) {
          const result = z
            .object({ path: z.string() })
            .parse(
              await paintWorker.run({ kind: 'avatar', path, size, scale, dbPath: getDbPath() }),
            )
          if (!(await Bun.file(result.path).exists()))
            throw new Error('Invalid avatar renderer result.')
          return result.path
        }
        const bytes = Buffer.from(await file.arrayBuffer())
        const sharp = loadSharp()
        const metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
        if ((metadata.pages ?? 1) > 1) return path
        const output = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate()
          .resize(pixels, pixels, { fit: 'cover', kernel: 'lanczos3', withoutEnlargement: true })
          .png()
          .toBuffer()
        await mkdir(directory, { recursive: true })
        const temporary = `${outputPath}.${crypto.randomUUID()}.tmp`
        try {
          await Bun.write(temporary, output)
          await rename(temporary, outputPath)
        } finally {
          await unlink(temporary).catch(() => {})
        }
        return outputPath
      } finally {
        const next = waiting.shift()
        if (next) next()
        else active--
      }
    })().finally(() => pending.delete(key))
    pending.set(key, task)
    return task
  }
  return { render }
}

export const avatarThumbnailer = createAvatarThumbnailer({
  directory: () => join(dirname(getDbPath()), 'image-cache', 'avatars'),
})
