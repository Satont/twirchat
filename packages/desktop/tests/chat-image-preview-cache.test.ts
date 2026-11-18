import { expect, test } from 'bun:test'

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
