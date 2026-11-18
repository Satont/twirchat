import { expect, test } from 'bun:test'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import sharp from 'sharp'

import { createChatImagePreviewCache } from '../src/services/chat-image-preview-cache'

const URL = 'https://example.com/short'

function image(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#a238df' } })
    .png()
    .toBuffer()
}

test('deduplicates a download and returns a thumbnail and a larger local image', async () => {
  const source = await image(640, 320)
  const pending = Promise.withResolvers<Uint8Array>()
  let requests = 0
  const preview = createChatImagePreviewCache({
    load: () => {
      requests++
      return pending.promise
    },
  })
  const first = new AbortController()
  const second = new AbortController()
  const cancelled = preview(URL, first.signal)
  const shared = preview(URL, second.signal)
  first.abort()
  pending.resolve(source)
  expect(await cancelled).toBeUndefined()
  const result = await shared
  expect(result).toMatchObject({ width: 240, height: 120 })
  expect(result?.thumbnail).toStartWith('data:image/webp;base64,')
  const full = Buffer.from(result?.full.split(',')[1] ?? '', 'base64')
  expect(await sharp(full).metadata()).toMatchObject({ width: 640, height: 320 })
  expect(await preview(URL, second.signal)).toBe(result)
  expect(requests).toBe(1)
})

test('prepares chat previews from a compiled executable with staged Sharp', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twirchat-preview-'))
  try {
    const entry = join(directory, 'preview.ts')
    const executable = join(directory, process.platform === 'win32' ? 'preview.exe' : 'preview')
    const source = await image(24, 12)
    const cacheModule = resolve(import.meta.dir, '../src/services/chat-image-preview-cache.ts')
    await symlink(
      resolve(import.meta.dir, '../../../node_modules'),
      join(directory, 'node_modules'),
      'junction',
    )
    const worker = await Bun.build({
      entrypoints: [resolve(import.meta.dir, '../src/services/paint-worker.ts')],
      target: 'bun',
      outdir: directory,
      naming: 'paint-worker.js',
    })
    expect(worker.success).toBe(true)
    const workerClient = resolve(import.meta.dir, '../src/services/paint-worker-client.ts')
    await Bun.write(
      entry,
      `
      import { createChatImagePreviewCache } from ${JSON.stringify(cacheModule)}
      import { paintWorker } from ${JSON.stringify(workerClient)}
      const load = async () => Buffer.from(${JSON.stringify(source.toString('base64'))}, 'base64')
      try {
        const result = await createChatImagePreviewCache({ load })('${URL}', AbortSignal.timeout(5000))
        if (result?.width !== 24 || result.height !== 12) throw new Error('Packaged preview did not render')
      } finally {
        await paintWorker.close()
      }
    `,
    )
    const build = Bun.spawnSync([
      process.execPath,
      'build',
      '--compile',
      '--external',
      'sharp',
      entry,
      '--outfile',
      executable,
    ])
    expect(build.stderr.toString()).not.toContain('error:')
    expect(build.exitCode).toBe(0)
    const run = Bun.spawnSync([executable], { cwd: tmpdir(), timeout: 8000 })
    expect(run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)

test('drops queued work when the last observer leaves and aborts running work', async () => {
  const controllers = Array.from({ length: 3 }, () => new AbortController())
  const requested: AbortSignal[] = []
  const preview = createChatImagePreviewCache({
    load: (_url, signal) => {
      requested.push(signal)
      return new Promise((resolve) =>
        signal.addEventListener('abort', () => resolve(undefined), { once: true }),
      )
    },
  })
  const requests = controllers.map(({ signal }, index) => preview(`${URL}/${index}`, signal))
  expect(requested).toHaveLength(2)
  controllers[2]?.abort()
  controllers[0]?.abort()
  controllers[1]?.abort()
  expect(await Promise.all(requests)).toEqual([undefined, undefined, undefined])
  expect(requested.map((signal) => signal.aborted)).toEqual([true, true])
})

test('invalid raster data does not leave a broken preview and its result expires', async () => {
  let now = 0
  let requests = 0
  const preview = createChatImagePreviewCache({
    load: async () => {
      requests++
      return new Uint8Array([1, 2, 3])
    },
    now: () => now,
  })
  const { signal } = new AbortController()
  expect(await preview(URL, signal)).toBeUndefined()
  expect(await preview(URL, signal)).toBeUndefined()
  expect(requests).toBe(1)
  now += 5 * 60_000
  expect(await preview(URL, signal)).toBeUndefined()
  expect(requests).toBe(2)
})
