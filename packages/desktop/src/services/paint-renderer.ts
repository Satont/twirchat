import { createHash } from 'node:crypto'
import { mkdir, rename } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { resolveOverlayRuntimePaths } from '../overlay-server'
import { getBackendUrl, getDbPath } from '../runtime-config'
import { sanitizeDisplayText, truncateGraphemes } from '../views/shared/utils/display-text'
import { timelineValue } from './animation-timeline'
import { deleteOldestEntry } from './bounded-cache'
import type { CosmeticPaint } from './cosmetics'
import type { ProviderFetch } from './emote-providers'
import { type ImageSweepLimits, sweepImageDirectoryOnce } from './image-cache-sweep'
import { PACKAGED_PAINT_WORKER, paintWorker } from './paint-worker-client'
import { fetchProviderImage } from './provider-relay'

interface Mask {
  imageUrl: string
  width: number
  height: number
}
type SvgRenderer = (
  name: string,
  paint: CosmeticPaint,
  fontSize: number,
  fontFamily: string,
  mask: Mask,
) => { svg: string; width: number; height: number }
interface RenderedPaint {
  path: string
  width: number
  height: number
}
interface ImageData {
  bytes: Buffer
  pages: number
  delay: number[]
  duration: number
  loop: number
}
const escapeMarkup = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ??
      character,
  )

let sharpFactory: typeof import('sharp').default | null = null
const DISK_LIMITS: ImageSweepLimits = {
  pattern: /^[a-f0-9]{32}\.webp$/,
  maxFiles: 512,
  keepFiles: 450,
}

const isStandalone = (): boolean =>
  import.meta.dir.includes('$bunfs') || import.meta.dir.includes('~BUN')
export function loadSharp(): typeof import('sharp').default {
  if (sharpFactory) return sharpFactory
  // Standalone Bun executables resolve external native dependencies beside the exe.
  const standalone = isStandalone()
  const require: (specifier: string) => typeof import('sharp').default = createRequire(
    standalone ? join(dirname(process.execPath), 'package.json') : import.meta.url,
  )
  sharpFactory = require(
    standalone ? join(dirname(process.execPath), 'node_modules/sharp/dist/index.cjs') : 'sharp',
  )
  return sharpFactory
}

export function createPaintRenderer(
  options: { fetch?: ProviderFetch; directory?: () => string } = {},
) {
  const fetcher = options.fetch ?? fetchProviderImage
  const images = new Map<string, Promise<ImageData>>()
  const renders = new Map<string, Promise<RenderedPaint>>()
  const waiting: Array<() => void> = []
  let active = 0

  const loadImage = (url: string): Promise<ImageData> => {
    const pending = images.get(url)
    if (pending) return pending
    const promise = (async () => {
      if (!/^https:\/\/cdn\.7tv\.(?:app|io)\//i.test(url))
        throw new Error('Untrusted paint image host.')
      const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`Paint image HTTP ${response.status}`)
      if (Number(response.headers.get('content-length')) > 4_000_000)
        throw new Error('Paint image is too large.')
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.byteLength > 4_000_000) throw new Error('Paint image is too large.')
      const sharp = loadSharp()
      const metadata = await sharp(bytes, { limitInputPixels: 4_000_000 }).metadata()
      const pages = metadata.pages ?? 1
      if (pages > 1000) throw new Error('Paint image has too many animation frames.')
      if (
        (metadata.width ?? 0) * (metadata.pageHeight ?? metadata.height ?? 0) * pages >
        16_000_000
      )
        throw new Error('Paint animation exceeds the decoded pixel budget.')
      const delay = Array.from({ length: pages }, (_, index) =>
        Math.max(20, Math.min(10_000, metadata.delay?.[index] ?? 100)),
      )
      return {
        bytes,
        pages,
        delay,
        duration: delay.reduce((sum, duration) => sum + duration, 0),
        loop: metadata.loop ?? 0,
      }
    })().catch((error: unknown) => {
      images.delete(url)
      throw error
    })
    images.set(url, promise)
    while (images.size > 48) deleteOldestEntry(images)
    return promise
  }

  const render = (
    name: string,
    paint: CosmeticPaint,
    fontSize: number,
    fontFamily: string,
    svgRenderer: SvgRenderer,
  ): Promise<RenderedPaint> => {
    const size = Math.max(8, Math.min(48, Number.isFinite(fontSize) ? fontSize : 14))
    const text = truncateGraphemes(sanitizeDisplayText(name).trim(), 120)
    if (!text.trim() || paint.layers.length > 16)
      return Promise.reject(new Error('Invalid paint name or layers.'))
    const family = /manrope/i.test(fontFamily) ? 'Manrope' : 'Inter'
    const key = createHash('sha256')
      .update(JSON.stringify({ version: 3, text, paint, size, family }))
      .digest('hex')
      .slice(0, 32)
    const pending = renders.get(key)
    if (pending) return pending
    if (waiting.length >= 100) return Promise.reject(new Error('Paint rendering queue is full.'))
    const task = (async () => {
      if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
      else active++
      try {
        const directory =
          options.directory?.() ?? join(dirname(getDbPath()), 'image-cache', 'paints')
        await sweepImageDirectoryOnce(directory, DISK_LIMITS)
        if (isStandalone()) {
          const workerPath = join(dirname(process.execPath), PACKAGED_PAINT_WORKER)
          if (!(await Bun.file(workerPath).exists()))
            throw new Error('The paint renderer asset is missing.')
          const result = z
            .object({ path: z.string(), width: z.number(), height: z.number() })
            .parse(
              await paintWorker.run({
                kind: 'paint',
                name,
                paint,
                fontSize,
                fontFamily,
                dbPath: getDbPath(),
                backendUrl: getBackendUrl(),
              }),
            )
          if (
            typeof result.path !== 'string' ||
            !Number.isFinite(result.width) ||
            !Number.isFinite(result.height)
          )
            throw new Error('Invalid paint renderer result.')
          return result
        }
        const sharp = loadSharp()
        const path = join(directory, `${key}.webp`)
        if (await Bun.file(path).exists()) {
          const metadata = await sharp(path).metadata()
          return { path, width: metadata.width, height: metadata.pageHeight ?? metadata.height }
        }
        const { fontsDir } = resolveOverlayRuntimePaths(join(import.meta.dir, '..'))
        const fontFile = fontsDir
          ? join(
              fontsDir,
              family === 'Manrope' ? 'manrope/Manrope-VariableFont_wght.ttf' : 'InterVariable.ttf',
            )
          : undefined
        if (!fontFile || !(await Bun.file(fontFile).exists()))
          throw new Error('Bundled font is missing for paint rendering.')
        const glyph = await sharp({
          text: {
            text: `<span foreground="white" weight="bold">${escapeMarkup(text)}</span>`,
            font: `${family} ${size}`,
            fontfile: fontFile,
            rgba: true,
          },
          limitInputPixels: 2_000_000,
        })
          .png()
          .toBuffer({ resolveWithObject: true })
        const width = glyph.info.width + 16,
          height = glyph.info.height + 8
        if (width > 2048 || height > 128) throw new Error('Paint name dimensions are too large.')
        const mask = await sharp({
          create: { width, height, channels: 4, background: '#00000000' },
        })
          .composite([{ input: glyph.data, left: 8, top: 4 }])
          .png()
          .toBuffer()
        const glyphMask: Mask = {
          width,
          height,
          imageUrl: `data:image/png;base64,${mask.toString('base64')}`,
        }
        const layerImages = await Promise.all(
          paint.layers.map((layer) =>
            layer.type === 'image' ? loadImage(layer.imageUrl) : Promise.resolve(null),
          ),
        )
        const animated = layerImages.filter(
          (image): image is ImageData => image !== null && image.pages > 1,
        )
        const master = [...animated].sort((a, b) => b.duration - a.duration || b.pages - a.pages)[0]
        const frameCount = master
          ? Math.max(1, Math.min(64, master.pages, Math.floor(8_000_000 / (width * height))))
          : 1
        const boundaries = [0]
        for (const delay of master?.delay ?? [100])
          boundaries.push(timelineValue(boundaries, boundaries.length - 1) + delay)
        const indices = Array.from({ length: frameCount + 1 }, (_, index) =>
          Math.floor((index * (master?.pages ?? 1)) / frameCount),
        )
        const timestamps = indices.slice(0, -1).map((index) => timelineValue(boundaries, index))
        const frameDelays = indices
          .slice(0, -1)
          .map((index, position) =>
            Math.min(
              65535,
              Math.max(
                20,
                timelineValue(boundaries, timelineValue(indices, position + 1)) -
                  timelineValue(boundaries, index),
              ),
            ),
          )
        const frames: Buffer[] = []
        const decoded = new Map<string, string>()
        for (let frame = 0; frame < frameCount; frame++) {
          const timestamp = timelineValue(timestamps, frame)
          // Decode at most 64 bounded output frames, preserving the animation duration.
          // eslint-disable-next-line no-await-in-loop
          const layers = await Promise.all(
            paint.layers.map(async (layer, index) => {
              const image = layerImages[index]
              if (layer.type !== 'image' || !image) return layer
              let page = 0,
                elapsed = 0
              const time = timestamp % image.duration
              while (page < image.pages - 1 && elapsed + timelineValue(image.delay, page) <= time) {
                elapsed += timelineValue(image.delay, page)
                page++
              }
              const frameKey = `${index}:${page}`
              let imageUrl = decoded.get(frameKey)
              if (!imageUrl) {
                const pixels = await sharp(image.bytes, {
                  page,
                  pages: 1,
                  limitInputPixels: 4_000_000,
                })
                  .resize(width, height, { fit: 'cover' })
                  .png()
                  .toBuffer()
                imageUrl = `data:image/png;base64,${pixels.toString('base64')}`
                decoded.set(frameKey, imageUrl)
              }
              return { ...layer, imageUrl }
            }),
          )
          const output = svgRenderer(text, { ...paint, layers }, size, family, glyphMask)
          frames.push(
            await sharp(Buffer.from(output.svg), { limitInputPixels: 2_000_000 })
              .ensureAlpha()
              .raw()
              .toBuffer(),
          )
        }
        const output = await sharp(Buffer.concat(frames), {
          raw: { width, height: height * frameCount, channels: 4, pageHeight: height },
          limitInputPixels: 8_000_000,
        })
          .webp({
            quality: 90,
            alphaQuality: 100,
            effort: 2,
            loop: master?.loop ?? 0,
            delay: frameDelays,
          })
          .toBuffer()
        await mkdir(directory, { recursive: true })
        const temporary = `${path}.${crypto.randomUUID()}.tmp`
        await Bun.write(temporary, output)
        await rename(temporary, path)
        return { path, width, height }
      } finally {
        const next = waiting.shift()
        if (next) next()
        else active--
      }
    })().catch((error: unknown) => {
      renders.delete(key)
      throw error
    })
    renders.set(key, task)
    while (renders.size > 256) deleteOldestEntry(renders)
    return task
  }
  return { render }
}
