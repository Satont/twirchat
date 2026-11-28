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

function nextMessage(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.addEventListener('message', () => resolve(), { once: true }))
}

function ping(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    const pong = ({ data }: MessageEvent) => {
      if (data !== '{"type":"pong"}') return
      ws.removeEventListener('message', pong)
      resolve()
    }
    ws.addEventListener('message', pong)
    send(ws, { type: 'ping' })
  })
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

for (const scenario of ['close', 'replace', 'unsubscribe', 'resubscribe', 'supersede']) {
  test(`7TV pending subscriptions respect ${scenario} ordering`, async () => {
    const originalFetch = globalThis.fetch
    const touch = spyOn(ClientStore, 'touch').mockResolvedValue(undefined)
    const connect = spyOn(sevenTVEventClient, 'connect').mockResolvedValue(undefined)
    const lookupStarted = Promise.withResolvers<void>()
    const lookup = Promise.withResolvers<Response>()
    const latestLookup = Promise.withResolvers<Response>()
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
        if (id === 'pending' && requests.includes('pending')) {
          requests.push('latest')
          return scenario === 'supersede' ? latestLookup.promise : response('latest')
        }
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
          { platform: 'kick', channelId: 'unrelated' },
        ],
      })
      await lookupStarted.promise
      if (scenario === 'unsubscribe' || scenario === 'resubscribe' || scenario === 'supersede') {
        const olderCommands = Promise.all(requestsDone)
        const subscribeAgain = scenario !== 'unsubscribe'
        const messages: unknown[] = []
        old.addEventListener('message', ({ data }) => {
          if (typeof data !== 'string') return
          const message: unknown = JSON.parse(data)
          messages.push(message)
        })
        if (scenario !== 'supersede')
          send(old, { type: 'seventv_unsubscribe', platform: 'kick', channelId: 'pending' })
        send(old, { type: 'seventv_unsubscribe', platform: 'kick', channelId: 'next' })
        if (subscribeAgain)
          send(old, { type: 'seventv_subscribe', platform: 'kick', channelId: 'pending' })
        if (scenario === 'resubscribe') await nextMessage(old)
        else await ping(old)
        lookup.resolve(response('obsolete'))
        if (scenario === 'supersede') {
          await olderCommands
          expect(sevenTVCache.get('kick', 'pending')).toBeUndefined()
          latestLookup.resolve(response('latest'))
        }
        await Promise.all(requestsDone)
        await ping(old)
        expect(requests).toEqual(
          subscribeAgain
            ? ['committed', 'pending', 'latest', 'unrelated']
            : ['committed', 'pending', 'unrelated'],
        )
        expect(sevenTVCache.get('kick', 'pending')?.id).toBe(
          subscribeAgain ? 'set-latest' : undefined,
        )
        expect(sevenTVCache.get('kick', 'next')).toBeUndefined()
        const expectedChannels =
          scenario === 'supersede'
            ? ['unrelated', 'pending']
            : subscribeAgain
              ? ['pending', 'unrelated']
              : ['unrelated']
        expect(
          messages.filter(
            (message) => typeof message === 'object' && message !== null && 'channelId' in message,
          ),
        ).toEqual(
          expectedChannels.map((channelId) => ({
            type: 'seventv_emote_set',
            platform: 'kick',
            channelId,
            emotes: [],
          })),
        )
        if (subscribeAgain) {
          send(old, { type: 'seventv_unsubscribe', platform: 'kick', channelId: 'pending' })
          await ping(old)
        }
        expect(sevenTVManager.getStats()).toMatchObject({
          connectedClients: 1,
          emoteSetSubscriptions: 2,
        })
        return
      }
      const overlap = scenario === 'replace'
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
      await ping(replacement)
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
      latestLookup.resolve(response('latest'))
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
