import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { getDbPath } from '../runtime-config'
import { timelineValue } from './animation-timeline'
import { deleteOldestEntry } from './bounded-cache'
import { loadSharp } from './paint-renderer'
import { paintWorker } from './paint-worker-client'

const renders = new Map<string, Promise<string>>()
const waiting: Array<() => void> = []
let active = 0

export function modifiedEmoteImage(
  path: string,
  width: number,
  height: number,
  modifiers: string[],
): Promise<string> {
  width = Math.round(width)
  height = Math.round(height)
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > 512 ||
    height > 512 ||
    modifiers.length > 16
  )
    return Promise.reject(new Error('Invalid modified emote dimensions.'))
  const key = createHash('sha256')
    .update(JSON.stringify([3, path, width, height, modifiers]))
    .digest('hex')
    .slice(0, 32)
  const previous = renders.get(key)
  if (previous) return previous
  if (waiting.length >= 100) return Promise.reject(new Error('Emote rendering queue is full.'))
  const task = (async () => {
    if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try {
      const directory = join(dirname(getDbPath()), 'image-cache', 'modifiers')
      const outputPath = join(directory, `${key}.webp`)
      if (await Bun.file(outputPath).exists()) return outputPath
      if (import.meta.dir.includes('$bunfs') || import.meta.dir.includes('~BUN')) {
        const result = z.object({ path: z.string() }).parse(
          await paintWorker.run({
            kind: 'emote',
            path,
            width,
            height,
            modifiers,
            dbPath: getDbPath(),
          }),
        )
        if (typeof result.path !== 'string' || !(await Bun.file(result.path).exists()))
          throw new Error('Invalid emote renderer result.')
        return result.path
      }
      const file = Bun.file(path)
      if (file.size > 2_000_000) throw new Error('Emote is too large for image modifiers.')
      const bytes = Buffer.from(await file.arrayBuffer())
      const sharp = loadSharp()
      const metadata = await sharp(bytes, { limitInputPixels: 4_000_000 }).metadata()
      const pages = metadata.pages ?? 1
      if (
        pages > 1000 ||
        (metadata.width ?? 0) * (metadata.pageHeight ?? metadata.height ?? 0) * pages > 16_000_000
      )
        throw new Error('Emote animation exceeds the decoded pixel budget.')
      const delays = Array.from({ length: pages }, (_, index) =>
        Math.max(20, Math.min(10000, metadata.delay?.[index] ?? 100)),
      )
      const boundaries = [0]
      for (const delay of delays)
        boundaries.push(timelineValue(boundaries, boundaries.length - 1) + delay)
      const effects = modifiers.includes('party') || modifiers.includes('shake')
      const sourceDuration = timelineValue(boundaries, boundaries.length - 1)
      // Repeat short base animations until the effect completes a full cycle.
      // Cap timeline length, output frames and decoded pixels independently.
      const duration = effects ? Math.max(sourceDuration, 1500) : sourceDuration
      const timeline = new Set<number>([0, duration])
      if (effects) {
        for (let time = 125; time < duration && timeline.size < 2048; time += 125)
          timeline.add(time)
      }
      for (let cycle = 0; cycle < duration && timeline.size < 4096; cycle += sourceDuration) {
        for (const time of boundaries) if (cycle + time < duration) timeline.add(cycle + time)
      }
      const allTimes = [...timeline].sort((a, b) => a - b)
      const frameCount = Math.min(64, Math.floor(8_000_000 / (width * height)), allTimes.length - 1)
      const timestamps = Array.from({ length: frameCount + 1 }, (_, i) =>
        timelineValue(allTimes, Math.floor((i * (allTimes.length - 1)) / frameCount)),
      )
      const frames: Buffer[] = []
      const decoded = new Map<number, string>()
      for (let frame = 0; frame < frameCount; frame++) {
        const time = timelineValue(timestamps, frame)
        let page = 0
        while (
          page < pages - 1 &&
          timelineValue(boundaries, page + 1) <=
            time % timelineValue(boundaries, boundaries.length - 1)
        )
          page++
        let image = decoded.get(page)
        if (!image) {
          // eslint-disable-next-line no-await-in-loop
          const png = await sharp(bytes, { page, pages: 1, limitInputPixels: 4_000_000 })
            .resize(width, height, { fit: 'fill' })
            .png()
            .toBuffer()
          image = `data:image/png;base64,${png.toString('base64')}`
          decoded.set(page, image)
        }
        const transforms: string[] = []
        if (modifiers.includes('flip-horizontal'))
          transforms.push(`translate(${width} 0) scale(-1 1)`)
        if (modifiers.includes('flip-vertical'))
          transforms.push(`translate(0 ${height}) scale(1 -1)`)
        if (modifiers.includes('rotate-left'))
          transforms.push(`rotate(-90 ${width / 2} ${height / 2})`)
        if (modifiers.includes('rotate-right'))
          transforms.push(`rotate(90 ${width / 2} ${height / 2})`)
        if (modifiers.includes('shake')) {
          const phase = Math.floor(time / 125) % 6
          transforms.unshift(
            `translate(${[0, 2, 1, -2, -1, 2][phase]} ${[1, 0, -2, 1, -1, 2][phase]})`,
          )
        }
        const filters: string[] = []
        if (modifiers.includes('cursed'))
          filters.push(
            '<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="1.75" intercept="-0.525"/><feFuncG type="linear" slope="1.75" intercept="-0.525"/><feFuncB type="linear" slope="1.75" intercept="-0.525"/></feComponentTransfer>',
          )
        if (modifiers.includes('party'))
          filters.push(
            `<feColorMatrix type="hueRotate" values="${(time * 360) / 1500}"/><feColorMatrix type="saturate" values="2.5"/>`,
          )
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><filter id="f">${filters.join('')}</filter></defs><image href="${image}" width="${width}" height="${height}" transform="${transforms.join(' ')}" ${filters.length ? 'filter="url(#f)"' : ''}/></svg>`
        // eslint-disable-next-line no-await-in-loop
        frames.push(await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer())
      }
      const output = await sharp(Buffer.concat(frames), {
        raw: { width, height: height * frameCount, pageHeight: height, channels: 4 },
        limitInputPixels: 8_000_000,
      })
        .webp({
          lossless: true,
          effort: 2,
          loop: metadata.loop ?? 0,
          delay: timestamps
            .slice(0, -1)
            .map((time, i) =>
              Math.max(20, Math.min(65535, timelineValue(timestamps, i + 1) - time)),
            ),
        })
        .toBuffer()
      await mkdir(directory, { recursive: true })
      const temporary = `${outputPath}.${crypto.randomUUID()}.tmp`
      await Bun.write(temporary, output)
      await rename(temporary, outputPath)
      const files = (await readdir(directory)).filter((name) => /\.(?:svg|webp)$/.test(name))
      if (files.length > 512) {
        const oldest = files
          .map((name) => ({ name, time: Bun.file(join(directory, name)).lastModified }))
          .sort((a, b) => a.time - b.time)
          .slice(0, files.length - 450)
        await Promise.all(
          oldest.map((entry) => unlink(join(directory, entry.name)).catch(() => {})),
        )
      }
      return outputPath
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
