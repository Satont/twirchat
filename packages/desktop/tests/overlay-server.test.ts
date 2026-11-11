import { describe, expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import {
  clearOverlay,
  pushOverlayMessage,
  pushOverlayPluginMessage,
  resolveOverlayRuntimePaths,
  startOverlayServer,
} from '../src/overlay-server'
import type { PluginTransportMessage } from '../src/plugins/api'
import { getBackendUrl } from '../src/runtime-config'
import { normalizedChatMessageSchema } from '../src/services/persisted-schemas'
import { overlayEventSchema } from '../src/views/overlay/protocol'
import type { PluginWatchedChannel } from '../src/watched-channels/plugin-channel-types'

describe('resolveOverlayRuntimePaths', () => {
  test('prefers packaged views paths when present', () => {
    const existingPaths = new Set([
      '/app/Resources/app/views/overlay',
      '/app/Resources/app/views/fonts',
    ])

    const result = resolveOverlayRuntimePaths('/app/Resources/app/bun', (path) =>
      existingPaths.has(path),
    )

    expect(result).toEqual({
      overlayDir: '/app/Resources/app/views/overlay',
      fontsDir: '/app/Resources/app/views/fonts',
    })
  })

  test('falls back to development paths when packaged views are absent', () => {
    const existingPaths = new Set([
      '/workspace/packages/desktop/dist/overlay',
      '/workspace/packages/desktop/public/fonts',
    ])

    const result = resolveOverlayRuntimePaths('/workspace/packages/desktop/src', (path) =>
      existingPaths.has(path),
    )

    expect(result).toEqual({
      overlayDir: '/workspace/packages/desktop/dist/overlay',
      fontsDir: '/workspace/packages/desktop/public/fonts',
    })
  })
})

test('broadcasts built-in and live plugin chat on the overlay socket', async () => {
  const timestamp = new Date('2026-11-05T09:00:00Z')
  const builtIn: NormalizedChatMessage = {
    id: 'chat-1',
    platform: 'kick',
    channelId: 'broadcaster',
    author: { id: 'kick-user', displayName: 'Kick viewer', badges: [] },
    text: 'Hello from Kick',
    emotes: [],
    timestamp,
    type: 'message',
  }
  const channel: PluginWatchedChannel = {
    id: '25cb9baa-4677-4ffc-91f6-73ffce569409',
    platform: 'plugin:streamx:chat',
    kind: 'plugin',
    channelSlug: 'example',
    displayName: 'Example',
    transportName: 'StreamX',
    createdAt: 0,
  }
  const plugin: PluginTransportMessage = {
    id: 'chat-1',
    author: { id: 'streamx-user', name: 'StreamX viewer', username: 'viewer', color: '#6da2fb' },
    text: 'Привет KEKW <b>hello</b>',
    timestamp: timestamp.getTime(),
  }
  const emote = {
    id: '7tv-emote',
    name: 'KEKW',
    imageUrl: 'https://cdn.7tv.app/emote/7tv-emote/1x.webp',
    positions: [{ start: 7, end: 10 }],
    aspectRatio: 2,
  }
  const server = startOverlayServer(0)
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`)
  const opened = Promise.withResolvers<void>()
  const cleared = Promise.withResolvers<void>()
  const frames: unknown[] = []
  socket.addEventListener('open', () => opened.resolve(), { once: true })
  socket.addEventListener('error', () => opened.reject(new Error('Overlay socket failed')), {
    once: true,
  })
  socket.addEventListener('message', ({ data }) => {
    try {
      if (typeof data !== 'string') throw new Error('Expected an overlay JSON frame')
      const decoded = overlayEventSchema.parse(JSON.parse(data))
      frames.push(decoded)
      if (decoded.type === 'clear') cleared.resolve()
    } catch (error) {
      cleared.reject(error)
    }
  })
  try {
    await opened.promise
    pushOverlayMessage(builtIn)
    pushOverlayPluginMessage(channel, {
      ...plugin,
      id: 'history-1',
      historical: true,
      emotes: [emote],
    })
    pushOverlayPluginMessage(channel, plugin)
    pushOverlayPluginMessage(channel, { ...plugin, id: 'chat-2', emotes: [emote] })
    clearOverlay()
    await cleared.promise

    const pluginMessage = {
      ...builtIn,
      id: `${channel.id}:${plugin.id}`,
      platform: channel.platform,
      channelId: channel.channelSlug,
      author: {
        id: plugin.author.id,
        username: plugin.author.username,
        displayName: plugin.author.name,
        color: plugin.author.color,
        badges: [],
      },
      text: plugin.text,
    }
    const overlayEmote = {
      ...emote,
      imageUrl: `${getBackendUrl().replace(/\/$/u, '')}/proxy/provider-image?url=${encodeURIComponent(emote.imageUrl)}`,
    }
    expect(frames).toEqual([
      {
        type: 'chat_message',
        data: { message: builtIn, parts: [{ type: 'text', content: builtIn.text }] },
      },
      {
        type: 'chat_message',
        data: { message: pluginMessage, parts: [{ type: 'text', content: plugin.text }] },
      },
      {
        type: 'chat_message',
        data: {
          message: { ...pluginMessage, id: `${channel.id}:chat-2`, emotes: [overlayEmote] },
          parts: [
            { type: 'text', content: 'Привет ' },
            { type: 'emote', emote: overlayEmote },
            { type: 'text', content: ' <b>hello</b>' },
          ],
        },
      },
      { type: 'clear' },
    ])
    expect(normalizedChatMessageSchema.safeParse(pluginMessage).success).toBe(false)
  } finally {
    socket.close()
    await server.stop(true)
  }
})
