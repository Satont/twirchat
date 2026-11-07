import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import { avatarRasterSize, createAvatarThumbnailer } from '../src/services/avatar-image'
import { loadSharp } from '../src/services/paint-renderer'
import { createPaintWorkerClient } from '../src/services/paint-worker-client'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'twirchat-avatar-'))
  directories.push(directory)
  return {
    directory,
    source: join(directory, 'source.png'),
    cache: createAvatarThumbnailer({ directory: () => join(directory, 'thumbnails') }),
  }
}

describe('avatar thumbnails', () => {
  test('prefilters large detailed avatars into lossless PNG at 1× and 2× without changing the original', async () => {
    const f = fixture()
    const sharp = loadSharp()
    const pixels = Buffer.alloc(300 * 300 * 3)
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 300; x++) {
        const value = (x + y) % 2 ? 255 : 0
        pixels.fill(value, (y * 300 + x) * 3, (y * 300 + x) * 3 + 3)
      }
    }
    const original = await sharp(pixels, { raw: { width: 300, height: 300, channels: 3 } })
      .png()
      .toBuffer()
    await Bun.write(f.source, original)
    const [one, two] = await Promise.all([
      f.cache.render(f.source, 18, 1),
      f.cache.render(f.source, 18, 2),
    ])
    expect(one).not.toBe(two)
    const [metadataOne, metadataTwo, filtered] = await Promise.all([
      sharp(one).metadata(),
      sharp(two).metadata(),
      sharp(two).removeAlpha().raw().toBuffer(),
    ])
    expect(metadataOne).toMatchObject({ width: 18, height: 18, format: 'png' })
    expect(metadataTwo).toMatchObject({ width: 36, height: 36, format: 'png' })
    // A one-pixel checkerboard must average to grey rather than alias into black/white moiré.
    expect([...filtered].every((value) => value >= 120 && value <= 136)).toBe(true)
    expect(await Bun.file(f.source).bytes()).toEqual(new Uint8Array(original))
  })

  test('coalesces concurrent requests and reuses thumbnails after a fresh cache instance', async () => {
    const f = fixture()
    const sharp = loadSharp()
    await Bun.write(
      f.source,
      await sharp({ create: { width: 100, height: 120, channels: 4, background: '#aabbcc' } })
        .png()
        .toBuffer(),
    )
    const first = f.cache.render(f.source, 32)
    expect(f.cache.render(f.source, 32)).toBe(first)
    const path = await first
    const oldMtime = Bun.file(path).lastModified
    const next = createAvatarThumbnailer({ directory: () => join(f.directory, 'thumbnails') })
    expect(await next.render(f.source, 32)).toBe(path)
    expect(Bun.file(path).lastModified).toBe(oldMtime)
    expect(await sharp(path).metadata()).toMatchObject({ width: 64, height: 64 })
  })

  test('never deletes a thumbnail it has handed out, even past the disk limit', async () => {
    // Native <img> keeps a failed read for every row that shows the path, so a thumbnail
    // deleted mid-session draws a broken avatar for that user until restart. Packaged
    // builds render in a separate worker with its own instance, so a second instance on
    // the same directory must not sweep either.
    const f = fixture()
    await Bun.write(
      f.source,
      await loadSharp()({ create: { width: 64, height: 64, channels: 3, background: '#345678' } })
        .png()
        .toBuffer(),
    )
    const handedOut = await f.cache.render(f.source, 18)
    const thumbnails = join(f.directory, 'thumbnails')
    for (let index = 0; index < 2100; index++)
      writeFileSync(join(thumbnails, `${index.toString(16).padStart(32, '0')}.png`), 'x')
    const next = createAvatarThumbnailer({ directory: () => thumbnails })
    await next.render(f.source, 20)
    expect(await Bun.file(handedOut).exists()).toBe(true)
    expect(readdirSync(thumbnails).length).toBe(2102)
  })

  test('rejects invalid dimensions, excessive encoded bytes and excessive decoded pixels', async () => {
    const f = fixture()
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 513])
      expect(() => f.cache.render(f.source, size)).toThrow('Invalid avatar dimensions')
    for (const scale of [0, -1, Number.NaN, 5])
      expect(() => avatarRasterSize(18, scale)).toThrow('Invalid avatar dimensions')
    await Bun.write(f.source, Buffer.alloc(20 * 1024 * 1024 + 1))
    await expect(f.cache.render(f.source, 18)).rejects.toThrow('byte budget')
    await Bun.write(
      f.source,
      await loadSharp()({ create: { width: 4100, height: 4100, channels: 3, background: '#fff' } })
        .png()
        .toBuffer(),
    )
    await expect(f.cache.render(f.source, 18)).rejects.toThrow('pixel limit')
  })

  test('bounds the rendering backlog while concurrent consumers still share one job', async () => {
    const f = fixture()
    await Bun.write(
      f.source,
      await loadSharp()({ create: { width: 210, height: 210, channels: 3, background: '#123456' } })
        .png()
        .toBuffer(),
    )
    const first = f.cache.render(f.source, 1)
    const jobs = [
      first,
      ...Array.from({ length: 101 }, (_, index) => f.cache.render(f.source, index + 2)),
    ]
    const shared = f.cache.render(f.source, 1)
    expect(shared).toBe(first)
    await expect(f.cache.render(f.source, 103)).rejects.toThrow('queue is full')
    expect(await Promise.all(jobs)).toHaveLength(102)
  })

  test('keeps animated avatar sources intact rather than freezing their first frame', async () => {
    const f = fixture()
    const pixels = Buffer.alloc(10 * 20 * 4, 128)
    pixels.fill(255, 10 * 10 * 4)
    const gif = await loadSharp()(pixels, {
      raw: { width: 10, height: 20, pageHeight: 10, channels: 4 },
    })
      .gif({ delay: [100, 100], loop: 0 })
      .toBuffer()
    await Bun.write(f.source, gif)
    expect(await f.cache.render(f.source, 18)).toBe(f.source)
    expect(await Bun.file(f.source).bytes()).toEqual(new Uint8Array(gif))
  })

  test('the packaged image worker accepts the avatar job boundary', async () => {
    const f = fixture()
    await Bun.write(
      f.source,
      await loadSharp()({ create: { width: 100, height: 100, channels: 3, background: '#123456' } })
        .png()
        .toBuffer(),
    )
    const worker = createPaintWorkerClient({
      command: () => [process.execPath, join(import.meta.dir, '../src/services/paint-worker.ts')],
    })
    try {
      const dbPath = join(f.directory, 'test.db')
      // Both jobs share one long-lived process.
      const outputs = await Promise.all(
        [28, 14].map((size) =>
          worker.run({ kind: 'avatar', path: f.source, size, scale: 2, dbPath }),
        ),
      )
      const sizes = await Promise.all(
        outputs.map(async (output) => {
          const { path } = z.object({ path: z.string() }).parse(output)
          return loadSharp()(path).metadata()
        }),
      )
      expect(sizes).toMatchObject([
        { width: 56, height: 56, format: 'png' },
        { width: 28, height: 28, format: 'png' },
      ])
    } finally {
      await worker.close()
    }
  })
})
