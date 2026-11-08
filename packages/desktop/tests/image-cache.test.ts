import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createImageCache } from '../src/gpuix/state/image-cache'
import { required } from './fixture-values'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const cleanup: (() => Promise<void> | void)[] = []

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .reverse()
      .map((fn) => fn()),
  )
})

function fixture(handler: (request: Request) => Response | Promise<Response>) {
  const directory = mkdtempSync(join(tmpdir(), 'twirchat-image-cache-'))
  const server = Bun.serve({ port: 0, fetch: handler })
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  cleanup.push(() => server.stop(true))
  return { directory, url: (path: string) => `http://127.0.0.1:${server.port}/${path}` }
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Image cache did not settle')
    await Bun.sleep(5)
  }
}

function imageResponse(): Response {
  return new Response(png, { headers: { 'Content-Type': 'image/png' } })
}

describe('image cache', () => {
  test('queued image stops loading when its last visible consumer leaves', async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    const requested: string[] = []
    const { directory, url } = fixture(async (request) => {
      requested.push(new URL(request.url).pathname)
      await gate
      return imageResponse()
    })
    const cache = createImageCache({ directory: () => directory })
    for (let index = 0; index < 6; index++) cache.ensureImage(url(String(index)))
    const stop = cache.subscribe(url('queued'), () => {})
    cache.ensureImage(url('queued'))
    stop()
    release()
    await until(() => cache.cachedImagePath(url('5')) !== undefined)
    expect(requested).not.toContain('/queued')
    const stopAgain = cache.subscribe(url('queued'), () => {})
    cache.ensureImage(url('queued'))
    await until(() => cache.cachedImagePath(url('queued')) !== undefined)
    expect(requested).toContain('/queued')
    stopAgain()
  })
  test('coalesces requests, writes a local image and notifies only its subscribers', async () => {
    let requests = 0
    const { directory, url } = fixture(() => {
      requests++
      return imageResponse()
    })
    const cache = createImageCache({ directory: () => directory })
    let notifications = 0
    let unrelated = 0
    const unsubscribe = cache.subscribe(url('avatar'), () => notifications++)
    const unsubscribeOther = cache.subscribe(url('other'), () => unrelated++)
    cleanup.push(unsubscribe, unsubscribeOther)
    for (let index = 0; index < 10; index++) cache.ensureImage(url('avatar'))
    expect(cache.snapshot(url('avatar'))).toBeUndefined()
    expect(notifications).toBe(0)
    await until(() => notifications > 0)
    const path = required(cache.cachedImagePath(url('avatar')))
    expect(path.endsWith('.png')).toBe(true)
    expect(await Bun.file(path).bytes()).toEqual(new Uint8Array(png))
    expect(requests).toBe(1)
    expect(notifications).toBe(1)
    expect(unrelated).toBe(0)
  })

  test('reuses persisted files in a fresh cache without another download', async () => {
    let requests = 0
    const { directory, url } = fixture(() => {
      requests++
      return imageResponse()
    })
    const first = createImageCache({ directory: () => directory })
    first.ensureImage(url('emote'))
    await until(() => first.cachedImagePath(url('emote')) !== undefined)
    const second = createImageCache({ directory: () => directory })
    second.ensureImage(url('emote'))
    await until(() => second.cachedImagePath(url('emote')) !== undefined)
    expect(second.cachedImagePath(url('emote'))).toBe(first.cachedImagePath(url('emote')))
    expect(requests).toBe(1)
  })

  test('writes incoming chunks without publishing an incomplete image', async () => {
    const { promise: remaining, resolve: finish } = Promise.withResolvers<void>()
    const { directory, url } = fixture(() => {
      let first = true
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (first) {
              first = false
              controller.enqueue(png.subarray(0, 16))
              return
            }
            await remaining
            controller.enqueue(png.subarray(16))
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'image/png' } },
      )
    })
    const cache = createImageCache({ directory: () => directory })
    const imageUrl = url('streamed')
    cache.ensureImage(imageUrl)
    try {
      await until(() =>
        readdirSync(directory).some(
          (file) => file.endsWith('.download') && Bun.file(join(directory, file)).size === 16,
        ),
      )
      expect(cache.snapshot(imageUrl)).toBeUndefined()
      expect(readdirSync(directory).some((file) => file.endsWith('.png'))).toBe(false)
    } finally {
      finish()
    }
    await until(() => cache.cachedImagePath(imageUrl) !== undefined)
    const path = required(cache.cachedImagePath(imageUrl))
    expect(await Bun.file(path).bytes()).toEqual(new Uint8Array(png))
    expect(readdirSync(directory)).toHaveLength(1)
  })

  test('cleans abandoned downloads without removing a recent temporary file', async () => {
    const { directory, url } = fixture(imageResponse)
    const hash = '1'.repeat(32)
    const abandoned = `${hash}.00000000-0000-0000-0000-000000000001.download`
    const recent = `${hash}.00000000-0000-0000-0000-000000000002.download`
    await Bun.write(join(directory, abandoned), 'partial')
    await Bun.write(join(directory, recent), 'partial')
    utimesSync(join(directory, abandoned), 1, 1)
    const cache = createImageCache({ directory: () => directory })
    cache.ensureImage(url('emote'))
    await until(() => cache.cachedImagePath(url('emote')) !== undefined)
    expect(readdirSync(directory)).not.toContain(abandoned)
    expect(readdirSync(directory)).toContain(recent)
  })

  test('caps downloads at six and drains the queue', async () => {
    let active = 0
    let peak = 0
    let finished = 0
    const { directory, url } = fixture(async () => {
      active++
      peak = Math.max(peak, active)
      await Bun.sleep(15)
      active--
      finished++
      return imageResponse()
    })
    const cache = createImageCache({ directory: () => directory })
    for (let index = 0; index < 25; index++) cache.ensureImage(url(`emote-${index}`))
    await until(() => cache.cachedImagePath(url('emote-24')) !== undefined)
    expect(finished).toBe(25)
    expect(peak).toBe(6)
  })

  test('negative-caches failures and allows a successful retry after the cooldown', async () => {
    let clock = 100
    let requests = 0
    const { directory, url } = fixture(() => {
      requests++
      return requests === 1 ? new Response(null, { status: 500 }) : imageResponse()
    })
    const cache = createImageCache({ directory: () => directory, now: () => clock })
    cache.ensureImage(url('retry'))
    await until(() => cache.snapshot(url('retry')) === null)
    cache.ensureImage(url('retry'))
    await Bun.sleep(10)
    expect(requests).toBe(1)
    clock += 5 * 60 * 1000
    cache.ensureImage(url('retry'))
    await until(() => cache.cachedImagePath(url('retry')) !== undefined)
    expect(requests).toBe(2)
  })

  test('unsubscribed listeners are not called by a completion', async () => {
    const { directory, url } = fixture(async () => {
      await Bun.sleep(10)
      return imageResponse()
    })
    const cache = createImageCache({ directory: () => directory })
    let notifications = 0
    const unsubscribe = cache.subscribe(url('avatar'), () => notifications++)
    cache.ensureImage(url('avatar'))
    unsubscribe()
    unsubscribe()
    await until(() => cache.cachedImagePath(url('avatar')) !== undefined)
    await Bun.sleep(10)
    expect(notifications).toBe(0)
  })

  test('evicts old unobserved metadata while retaining subscribed images', async () => {
    const { directory, url } = fixture(imageResponse)
    const cache = createImageCache({ directory: () => directory, maxEntries: 2 })
    const unsubscribe = cache.subscribe(url('pinned'), () => {})
    cleanup.push(unsubscribe)
    for (const name of ['pinned', 'old', 'new']) {
      cache.ensureImage(url(name))
      await until(() => cache.cachedImagePath(url(name)) !== undefined)
    }
    expect(cache.snapshot(url('pinned'))).toBeString()
    expect(cache.snapshot(url('old'))).toBeUndefined()
    expect(cache.snapshot(url('new'))).toBeString()
    // Eviction is only metadata: a revisit reads the disk rather than the network.
    cache.ensureImage(url('old'))
    await until(() => cache.cachedImagePath(url('old')) !== undefined)
  })

  test('rejects oversized chunked images and removes the partial file', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const { directory, url } = fixture((request) => {
      if (new URL(request.url).pathname !== '/large') return imageResponse()
      let sent = 0
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (sent++ === 21) controller.close()
            else controller.enqueue(chunk)
          },
        }),
        { headers: { 'Content-Type': 'image/png' } },
      )
    })
    const cache = createImageCache({ directory: () => directory })
    cache.ensureImage(url('large'))
    cache.ensureImage(url('small'))
    await until(() => cache.snapshot(url('large')) === null)
    await until(() => cache.cachedImagePath(url('small')) !== undefined)
    expect(cache.cachedImagePath(url('large'))).toBeUndefined()
    expect(readdirSync(directory)).toHaveLength(1)
  })
})
