import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { buildMessageTokens } from '../src/gpuix/message-tokens'
import { createStore } from '../src/gpuix/state/create-store'
import { setRuntimeConfig } from '../src/runtime-config'

function makeMessage(partial: Partial<NormalizedChatMessage>): NormalizedChatMessage {
  return {
    id: 'm1',
    platform: 'twitch',
    channelId: 'chan',
    author: { id: 'u1', displayName: 'User', badges: [] },
    text: '',
    emotes: [],
    timestamp: new Date(0),
    type: 'message',
    ...partial,
  }
}

describe('buildMessageTokens', () => {
  test('plain text becomes word tokens with trailing spaces preserved', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'hello world' }))
    expect(tokens).toEqual([
      { kind: 'text', text: 'hello ' },
      { kind: 'text', text: 'world' },
    ])
  })

  test('emote positions become emote tokens', () => {
    const tokens = buildMessageTokens(
      makeMessage({
        text: 'hi Kappa there',
        emotes: [
          {
            id: 'e1',
            name: 'Kappa',
            imageUrl: 'https://example.com/kappa.png',
            positions: [{ start: 3, end: 7 }],
          },
        ],
      }),
    )
    expect(tokens).toEqual([
      { kind: 'text', text: 'hi ' },
      {
        kind: 'emote',
        emote: expect.objectContaining({ id: 'e1' }),
      },
      { kind: 'text', text: 'there' },
    ])
  })

  test('links are detected and keep their url', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'see https://example.com/x now' }))
    expect(tokens[1]).toEqual({
      kind: 'link',
      text: 'https://example.com/x ',
      url: 'https://example.com/x',
    })
  })

  test('mentions become mention tokens', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'hey @someone nice' }))
    expect(tokens[1]).toEqual({ kind: 'mention', text: '@someone ', color: null })
  })

  test('whitespace-only tokens after emotes are dropped (emote has its own margin)', () => {
    const tokens = buildMessageTokens(
      makeMessage({
        text: 'Kappa Kappa',
        emotes: [
          { id: 'e1', name: 'Kappa', imageUrl: 'x', positions: [{ start: 0, end: 4 }] },
          { id: 'e1', name: 'Kappa', imageUrl: 'x', positions: [{ start: 6, end: 10 }] },
        ],
      }),
    )
    expect(tokens.filter((t) => t.kind === 'text')).toEqual([])
    expect(tokens.filter((t) => t.kind === 'emote')).toHaveLength(2)
  })

  test('very long words are chunked so flex rows can wrap them', () => {
    const long = 'a'.repeat(70)
    const tokens = buildMessageTokens(makeMessage({ text: long }))
    expect(tokens.length).toBeGreaterThan(1)
    for (const token of tokens) {
      expect(token.kind).toBe('text')
      if (token.kind === 'text') expect(token.text.length).toBeLessThanOrEqual(28)
    }
  })
})

describe('createStore', () => {
  test('set/get/update semantics', () => {
    const store = createStore({ count: 0 })
    expect(store.get().count).toBe(0)
    store.set({ count: 5 })
    expect(store.get().count).toBe(5)
    store.set((prev) => ({ count: prev.count + 1 }))
    expect(store.get().count).toBe(6)
    store.update({ count: 10 })
    expect(store.get().count).toBe(10)
  })

  test('identical values do not notify', async () => {
    const store = createStore(1)
    let calls = 0
    store.subscribe(() => calls++)
    store.set(1)
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toBe(0)
  })

  test('notifications are coalesced into one macrotask (GPUI reentrancy guard)', async () => {
    const store = createStore(0)
    let calls = 0
    store.subscribe(() => calls++)
    store.set(1)
    store.set(2)
    store.set(3)
    // Not synchronous: the whole point is escaping the current dispatch.
    expect(calls).toBe(0)
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toBe(1)
    expect(store.get()).toBe(3)
  })
})

describe('image cache (GPUI cannot load http(s) on Linux)', () => {
  test('ensureImage downloads to a local file and cachedImagePath resolves it', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(png, { headers: { 'Content-Type': 'image/png' } }),
    })
    const dir = mkdtempSync(join(tmpdir(), 'twirchat-imgcache-'))
    setRuntimeConfig({ dbPath: join(dir, 'db.sqlite') })

    const { cachedImagePath, ensureImage, imageCacheRevisionStore } = await import(
      '../src/gpuix/state/image-cache'
    )
    const url = `http://127.0.0.1:${server.port}/avatar.png`

    expect(cachedImagePath(url)).toBeUndefined()
    const revisions: number[] = []
    imageCacheRevisionStore.subscribe(() => revisions.push(1))
    ensureImage(url)

    await new Promise((resolve) => setTimeout(resolve, 300))
    const localPath = cachedImagePath(url)
    expect(localPath).toBeDefined()
    expect(localPath!.endsWith('.png')).toBe(true)
    expect(await Bun.file(localPath!).exists()).toBe(true)
    expect(revisions.length).toBeGreaterThan(0)

    server.stop()
    rmSync(dir, { recursive: true, force: true })
  })
})
