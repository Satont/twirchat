import { expect, spyOn, test } from 'bun:test'

import type { DesktopToBackendMessage } from '@twirchat/shared'
import { z } from 'zod'

import { ClientStore } from '../src/db'
import { sevenTVCache, sevenTVEventClient, sevenTVManager } from '../src/seventv'
import type { WsData } from '../src/ws/connection-manager'
import { handleWsClose, handleWsMessage, handleWsOpen } from '../src/ws/handlers'

function send(ws: WebSocket, message: DesktopToBackendMessage) {
  ws.send(JSON.stringify(message))
}

const requestSchema = z.object({ variables: z.object({ platformId: z.string() }) })
const response = (id: string) =>
  Response.json({
    data: {
      users: {
        userByConnection: {
          id: `user-${id}`,
          style: { activeEmoteSet: { id: `set-${id}`, name: id, emotes: { items: [] } } },
        },
      },
    },
  })

for (const overlap of [false, true]) {
  test(`a ${overlap ? 'replaced' : 'closed'} socket cannot commit pending 7TV subscriptions`, async () => {
    const originalFetch = globalThis.fetch
    const touch = spyOn(ClientStore, 'touch').mockResolvedValue(undefined)
    const connect = spyOn(sevenTVEventClient, 'connect').mockResolvedValue(undefined)
    const lookupStarted = Promise.withResolvers<void>()
    const lookup = Promise.withResolvers<Response>()
    const requests: string[] = []
    const requestsDone: Promise<void>[] = []
    const sockets = new Set<WebSocket>()
    const opened = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const closed = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const secret = '7tv-lifetime-fixture'
    const listener = Bun.serve<{ clientSecret: string; index: number }>({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request, server) {
        const index = Number(new URL(request.url).pathname.slice(1))
        if (
          server.upgrade(request, {
            data: { clientSecret: secret, index } satisfies WsData & { index: number },
          })
        )
          return undefined
        return new Response(null, { status: 400 })
      },
      websocket: {
        open(ws) {
          opened[ws.data.index]?.resolve(handleWsOpen(ws))
        },
        close(ws, code, reason) {
          handleWsClose(ws, code, reason)
          closed[ws.data.index]?.resolve()
        },
        message(ws, payload) {
          requestsDone.push(handleWsMessage(ws, payload))
        },
      },
    })
    async function socket(index: number) {
      const ws = new WebSocket(`ws://127.0.0.1:${listener.port}/${index}`)
      sockets.add(ws)
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true })
        ws.addEventListener('error', () => reject(new Error('WebSocket did not open')), {
          once: true,
        })
      })
      await opened[index]?.promise
      return ws
    }
    globalThis.fetch = Object.assign(
      async (_input: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== 'string') throw new Error('Expected a 7TV lookup')
        const id = requestSchema.parse(JSON.parse(init.body)).variables.platformId
        requests.push(id)
        if (id === 'pending') {
          lookupStarted.resolve()
          return lookup.promise
        }
        return response(id)
      },
      { preconnect: originalFetch.preconnect },
    )
    try {
      const old = await socket(0)
      send(old, { type: 'seventv_subscribe', platform: 'kick', channelId: 'committed' })
      await new Promise<void>((resolve) =>
        old.addEventListener('message', () => resolve(), { once: true }),
      )
      send(old, {
        type: 'seventv_resubscribe',
        subscriptions: [
          { platform: 'kick', channelId: 'pending' },
          { platform: 'kick', channelId: 'next' },
        ],
      })
      await lookupStarted.promise
      if (!overlap) {
        old.close()
        await closed[0]?.promise
      }
      const replacement = await socket(1)
      const messages: unknown[] = []
      replacement.addEventListener('message', ({ data }) => {
        if (typeof data === 'string') {
          const message: unknown = JSON.parse(data)
          messages.push(message)
        }
      })
      send(replacement, { type: 'seventv_subscribe', platform: 'kick', channelId: 'replacement' })
      await new Promise<void>((resolve) =>
        replacement.addEventListener('message', () => resolve(), { once: true }),
      )
      if (overlap) expect(old.readyState).toBe(WebSocket.OPEN)
      lookup.resolve(response('pending'))
      await Promise.all(requestsDone)
      if (overlap) {
        old.close()
        await closed[0]?.promise
      }
      send(replacement, { type: 'ping' })
      await new Promise<void>((resolve) => {
        const pong = ({ data }: MessageEvent) => {
          if (data !== '{"type":"pong"}') return
          replacement.removeEventListener('message', pong)
          resolve()
        }
        replacement.addEventListener('message', pong)
      })
      expect(requests).toEqual(['committed', 'pending', 'replacement'])
      expect(sevenTVCache.get('kick', 'pending')).toBeUndefined()
      expect(sevenTVManager.getStats()).toMatchObject({
        connectedClients: 1,
        emoteSetSubscriptions: overlap ? 2 : 1,
      })
      expect(messages).toEqual([
        { type: 'seventv_emote_set', platform: 'kick', channelId: 'replacement', emotes: [] },
        { type: 'pong' },
      ])
    } finally {
      lookup.resolve(response('pending'))
      await Promise.allSettled(requestsDone)
      for (const ws of sockets) ws.close()
      await listener.stop(true)
      sevenTVManager.cleanupClient(secret)
      sevenTVCache.invalidateAll()
      globalThis.fetch = originalFetch
      connect.mockRestore()
      touch.mockRestore()
    }
  })
}
