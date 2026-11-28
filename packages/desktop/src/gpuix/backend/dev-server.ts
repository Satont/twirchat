import { DEV_SERVER_PORT } from '@twirchat/shared/constants'
import { z } from 'zod'

import { normalizedChatMessageSchema } from '../../services/persisted-schemas'
import type { DesktopEvents } from './events'

const debugActionSchema = z.object({ action: z.string(), payload: z.unknown().optional() })

type DebugHook = (action: string, payload?: unknown) => Promise<unknown>

export function startDesktopDevServer({
  events,
  getDebugHook,
  port = DEV_SERVER_PORT,
  hostname,
}: {
  events: Pick<DesktopEvents, 'emit'>
  getDebugHook: () => DebugHook | undefined
  port?: number
  hostname?: string
}) {
  let stopping: Promise<void> | undefined
  const server = Bun.serve({
    port,
    hostname,
    async fetch(req) {
      if (stopping) return new Response(null, { status: 503 })
      const { pathname } = new URL(req.url)
      if (pathname === '/dev/inject-chat' && req.method === 'POST') {
        const parsed = normalizedChatMessageSchema.safeParse(await req.json().catch(() => null))
        if (stopping) return new Response(null, { status: 503 })
        if (!parsed.success) return new Response('Invalid chat message', { status: 400 })
        events.emit('chat_message', parsed.data)
        return new Response('ok')
      }
      if (pathname === '/dev/hook' && req.method === 'POST') {
        const parsed = debugActionSchema.safeParse(await req.json().catch(() => null))
        if (stopping) return new Response(null, { status: 503 })
        if (!parsed.success) return new Response('Invalid debug action', { status: 400 })
        const hook = getDebugHook()
        if (!hook) return new Response('no hook', { status: 404 })
        const { action, payload } = parsed.data
        const result = await hook(action, payload)
        return new Response(JSON.stringify(result ?? null), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    },
  })
  return {
    port: server.port,
    stop: () => (stopping ??= server.stop(true)),
  }
}
