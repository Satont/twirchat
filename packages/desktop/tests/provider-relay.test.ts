import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SEVENTV_COSMETICS_QUERY } from '@twirchat/shared/emote-proxy'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { createImageCache } from '../src/gpuix/state/image-cache'
import { buildOverlayChatMessage } from '../src/overlay-server'
import { getRuntimeConfig, setRuntimeConfig } from '../src/runtime-config'
import { createCosmeticsService, updateSevenTvPresence } from '../src/services/cosmetics'
import { createEmoteProviderService } from '../src/services/emote-providers'
import { createPaintWorkerClient } from '../src/services/paint-worker-client'
import { fetchProviderImage, fetchProviderMetadata } from '../src/services/provider-relay'

const gif = new Uint8Array([71, 73, 70, 56, 57, 97])

async function until(check: () => boolean) {
  const deadline = Date.now() + 3000
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Image did not finish loading.')
    await Bun.sleep(5)
  }
}

test('default provider catalogs, cosmetics and opted-in presence reach backend only', async () => {
  const previous = { ...getRuntimeConfig() }
  const requests: Array<{
    path: string
    source: string | null
    body: string
    secret: string | null
  }> = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      requests.push({
        path: url.pathname,
        source: url.searchParams.get('url'),
        body: await request.text(),
        secret: request.headers.get('x-client-secret'),
      })
      return Response.json({})
    },
  })
  try {
    setRuntimeConfig({ backendUrl: server.url.origin, clientSecret: 'local-client-secret' })
    const provider = createEmoteProviderService()
    await provider.getProviderEmotes('twitch', 'satont', {
      twitchUserId: '123',
      personalUserId: '456',
    })
    await provider.getProviderBadges('twitch', '123')
    await provider.getPersonalEmoteSet('personal-set')
    await createCosmeticsService(undefined, async () => []).getUserCosmetics('kick', '123')
    await updateSevenTvPresence('seventv-id', 'twitch', '123')
    expect(requests.length).toBeGreaterThan(8)
    expect(requests.every((request) => request.path === '/api/provider-metadata')).toBe(true)
    expect(requests.every((request) => request.secret === 'local-client-secret')).toBe(true)
    expect(requests.some((request) => request.source?.includes('api.betterttv.net'))).toBe(true)
    expect(requests.some((request) => request.source?.includes('api.frankerfacez.com'))).toBe(true)
    const cosmetics = requests.find((request) => request.source === 'https://7tv.io/v4/gql')
    expect(JSON.parse(cosmetics?.body ?? '{}')).toEqual({
      query: SEVENTV_COSMETICS_QUERY,
      variables: { platform: 'KICK', platformId: '123' },
    })
    expect(requests.some((request) => request.source?.endsWith('/presences'))).toBe(true)
    await expect(fetchProviderMetadata('https://untrusted.invalid/private')).rejects.toThrow(
      'Unsupported provider endpoint',
    )
  } finally {
    setRuntimeConfig(previous)
    await server.stop(true)
  }
})

test('cold native image caches proxy provider images while retaining original persisted cache identity', async () => {
  const previous = { ...getRuntimeConfig() }
  const directory = await mkdtemp(join(tmpdir(), 'twirchat-provider-relay-'))
  const sources: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      expect(url.pathname).toBe('/proxy/provider-image')
      sources.push(url.searchParams.get('url') ?? '')
      return new Response(gif, { headers: { 'Content-Type': 'image/gif' } })
    },
  })
  const imageUrl = 'https://cdn.7tv.app/emote/01GBFAYKGR000FWWN7MDZZ8XQN/4x.gif'
  try {
    setRuntimeConfig({ backendUrl: server.url.origin, clientSecret: 'test-secret' })
    const cache = createImageCache({ directory: () => directory })
    cache.ensureImage(imageUrl)
    await until(() => typeof cache.snapshot(imageUrl) === 'string')
    const path = cache.cachedImagePath(imageUrl)
    expect(path).toBe(
      join(directory, createHash('sha256').update(imageUrl).digest('hex').slice(0, 32) + '.gif'),
    )
    if (!path) throw new Error('Missing image.')
    expect(await Bun.file(path).bytes()).toEqual(gif)
    const second = createImageCache({ directory: () => directory })
    second.ensureImage(imageUrl)
    await until(() => typeof second.snapshot(imageUrl) === 'string')
    expect(sources).toEqual([imageUrl])
    const ffz = 'https://cdn.frankerfacez.com/animated/123/4'
    await fetchProviderImage(ffz)
    expect(sources).toEqual([imageUrl, ffz])
  } finally {
    setRuntimeConfig(previous)
    await server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})

test('overlay emotes, badges and message parts use backend URLs without mutating live/history objects', () => {
  const previous = { ...getRuntimeConfig() }
  const message: NormalizedChatMessage = {
    id: 'twitch-message-id',
    platform: 'twitch',
    channelId: 'satont',
    type: 'message',
    timestamp: new Date(0),
    text: 'RAGEY',
    author: {
      id: '123',
      displayName: 'Viewer',
      badges: [
        {
          id: 'badge',
          type: 'seventv',
          text: 'Badge',
          imageUrl: 'https://cdn.7tv.app/badge/abc/2x.webp',
        },
      ],
    },
    emotes: [
      {
        id: 'ragey',
        name: 'RAGEY',
        imageUrl: 'https://cdn.7tv.app/emote/ragey/4x.gif',
        animated: true,
        aspectRatio: 1.4,
        zeroWidth: true,
        positions: [{ start: 0, end: 4 }],
      },
    ],
  }
  try {
    setRuntimeConfig({ backendUrl: 'https://backend.invalid' })
    const payload = buildOverlayChatMessage(message)
    expect(payload.message.id).toBe(message.id)
    expect(payload.message.emotes[0]).toMatchObject({
      animated: true,
      aspectRatio: 1.4,
      zeroWidth: true,
    })
    expect(payload.message.emotes[0]?.imageUrl).toContain(
      'https://backend.invalid/proxy/provider-image?url=',
    )
    expect(payload.message.author.badges[0]?.imageUrl).toContain(
      'https://backend.invalid/proxy/provider-image?url=',
    )
    expect(payload.parts[0]?.emote?.imageUrl).toBe(payload.message.emotes[0]?.imageUrl)
    expect(message.emotes[0]?.imageUrl).toBe('https://cdn.7tv.app/emote/ragey/4x.gif')
    expect(message.author.badges[0]?.imageUrl).toBe('https://cdn.7tv.app/badge/abc/2x.webp')
  } finally {
    setRuntimeConfig(previous)
  }
})

test('paint worker inherits the configured backend for image layers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twirchat-proxied-paint-'))
  const sharp = (await import('sharp')).default
  const png = await sharp({
    create: { width: 8, height: 8, channels: 4, background: '#40a060' },
  })
    .png()
    .toBuffer()
  const sources: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      expect(url.pathname).toBe('/proxy/provider-image')
      sources.push(url.searchParams.get('url') ?? '')
      return new Response(png, { headers: { 'Content-Type': 'image/png' } })
    },
  })
  const imageUrl = 'https://cdn.7tv.app/paint/qa/1x.png'
  const worker = createPaintWorkerClient({
    command: () => [process.execPath, 'src/services/paint-worker.ts'],
    cwd: join(import.meta.dir, '..'),
    jobTimeoutMs: 15_000,
  })
  try {
    const output = await worker.run({
      kind: 'paint',
      name: 'Proxy',
      paint: {
        id: 'proxy',
        name: 'Proxy',
        layers: [{ type: 'image', imageUrl, opacity: 1 }],
        shadows: [],
      },
      fontSize: 14,
      fontFamily: 'Inter',
      dbPath: join(directory, 'db.sqlite'),
      backendUrl: server.url.origin,
    })
    expect(sources).toEqual([imageUrl])
    const { z } = await import('zod')
    const rendered = z
      .object({ path: z.string(), width: z.number(), height: z.number() })
      .parse(output)
    expect(rendered.width).toBeGreaterThan(0)
    expect((await sharp(rendered.path).metadata()).format).toBe('webp')
  } finally {
    await worker.close()
    await server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})
