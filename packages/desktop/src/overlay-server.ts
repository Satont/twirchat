/**
 * TwirChat OBS Overlay Server
 *
 * Serves the overlay page (built by Vite into dist/overlay/) and a WebSocket
 * endpoint that pushes chat messages and events to connected OBS browser
 * sources in real time.
 *
 * URL for OBS: http://localhost:45823/?bg=transparent&fontSize=14&maxMessages=20
 *
 * Query parameters (all optional):
 *   bg          — background color / "transparent" (default: transparent)
 *   textColor   — text color hex (default: #ffffff)
 *   fontSize    — font size in px (default: 14)
 *   fontFamily  — CSS font-family (default: sans-serif)
 *   maxMessages — max visible messages (default: 20)
 *   timeout     — auto-remove message after N seconds, 0 = never (default: 0)
 *   showPlatform — show platform icon 1/0 (default: 1)
 *   showAvatar  — show avatar 1/0 (default: 1)
 *   showBadges  — show badges 1/0 (default: 1)
 *   animation   — slide | fade | none (default: slide)
 *   position    — bottom | top (default: bottom)
 *   platforms   — comma-separated filter e.g. "twitch,kick" (default: all)
 */

import { OVERLAY_SERVER_PORT } from '@twirchat/shared/constants'
import type { NormalizedChatMessage, NormalizedEvent } from '@twirchat/shared/types'
import type { ServerWebSocket } from 'bun'
import { join } from 'path'
import { logger } from '@twirchat/shared/logger'

const log = logger('overlay-server')

// ============================================================
// Overlay WS message types (server → browser)
// ============================================================

export type OverlayMessage =
  | { type: 'chat_message'; data: NormalizedChatMessage }
  | { type: 'chat_event'; data: NormalizedEvent }
  | { type: 'clear' }

// ============================================================
// Connected OBS browser-source WebSocket clients
// ============================================================

const clients = new Set<ServerWebSocket<unknown>>()

// ============================================================
// Public API — called from src/bun/index.ts
// ============================================================

/**
 * Push a chat message to all connected overlay clients.
 */
export function pushOverlayMessage(msg: NormalizedChatMessage): void {
  const payload: OverlayMessage = { data: msg, type: 'chat_message' }
  const json = JSON.stringify(payload, replacer)
  for (const ws of clients) {
    ws.send(json)
  }
}

/**
 * Push a chat event (follow, sub, raid…) to all connected overlay clients.
 */
export function pushOverlayEvent(event: NormalizedEvent): void {
  const payload: OverlayMessage = { data: event, type: 'chat_event' }
  const json = JSON.stringify(payload, replacer)
  for (const ws of clients) {
    ws.send(json)
  }
}

/**
 * Clear all messages in connected overlays.
 */
export function clearOverlay(): void {
  const payload: OverlayMessage = { type: 'clear' }
  const json = JSON.stringify(payload)
  for (const ws of clients) {
    ws.send(json)
  }
}

// ============================================================
// Server
// ============================================================

/**
 * Resolve the dist/overlay directory relative to this file.
 * Works both in development (src/overlay-server.ts) and after electrobun
 * copies the built assets.
 */
const OVERLAY_DIST = join(import.meta.dir, '..', 'dist', 'overlay')

export function startOverlayServer(
  port: number = OVERLAY_SERVER_PORT,
): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    fetch(req, server) {
      // WebSocket upgrade (no path restriction — OBS connects to any path)
      if (server.upgrade(req)) {
        return undefined
      }

      const url = new URL(req.url)
      const pathname = url.pathname

      // Serve static assets from dist/overlay/assets/
      if (pathname.startsWith('/assets/')) {
        const file = Bun.file(join(OVERLAY_DIST, pathname))
        return new Response(file)
      }

      // Everything else → index.html (SPA entry, query params passed through)
      const indexFile = Bun.file(join(OVERLAY_DIST, 'index.html'))
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    },
    port,
    websocket: {
      close(ws) {
        clients.delete(ws)
        log.info(`Client disconnected (total: ${clients.size})`)
      },
      message(_ws, _msg) {
        // Overlay is receive-only; ignore any messages from the browser
      },
      open(ws) {
        clients.add(ws)
        log.info(`Client connected (total: ${clients.size})`)
      },
    },
  })

  log.info(`Server running on http://localhost:${port}`)
  log.info(`OBS URL: http://localhost:${port}/?bg=transparent`)

  return server
}

// ============================================================
// Helpers
// ============================================================

/** JSON.stringify replacer that converts Date → ISO string */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }
  return value
}
