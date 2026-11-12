import { logger } from '@twirchat/shared/logger'
import { sql } from 'bun'

import { handleTwitchBadges } from './api/twitch-badges.ts'
import { createTwitchHistoryService } from './api/twitch-history.ts'
import { config, memeAlertsOAuthCredentials } from './config.ts'
import { ClientStore } from './db/index.ts'
import { runMigrations } from './db/migrations.ts'
import { accountRoutes } from './routes/accounts.ts'
import { authRoutes } from './routes/auth.ts'
import { chatToolsRoutes } from './routes/chat-tools.ts'
import { createDonationOAuthRoutes } from './routes/donations.ts'
import { emoteCatalogRoutes } from './routes/emote-catalog.ts'
import { moderationRoutes } from './routes/moderation.ts'
import { providerProxyRoutes } from './routes/provider-proxy.ts'
import { streamRoutes } from './routes/stream.ts'
import { createTwitchHistoryRoutes } from './routes/twitch-history.ts'
import { userCardRoutes } from './routes/user-card.ts'
import { userProfileRoutes } from './routes/user-profile.ts'
import { json } from './routes/utils.ts'
import { webhookRoutes } from './routes/webhooks.ts'
import { youtubeRoutes } from './routes/youtube.ts'
import { handleSevenTVImageProxy } from './seventv/index.ts'
import type { WsData } from './ws/connection-manager.ts'
import { handleWsClose, handleWsMessage, handleWsOpen, youtubeChatRelay } from './ws/handlers.ts'

const log = logger('backend')
const twitchHistoryRoutes = createTwitchHistoryRoutes(
  createTwitchHistoryService({ providers: config.TWITCH_HISTORY_PROVIDERS }),
)

await runMigrations()

// Prefetch global Twitch badges at startup so the first request is instant

handleTwitchBadges(new URL('http://localhost/api/twitch/badges')).catch((error) => {
  log.warn('Failed to prefetch global Twitch badges', { err: String(error) })
})

const server = Bun.serve<WsData>({
  async fetch(req, server) {
    // disable bun 10 seconds timeout
    server.timeout(req, 0)

    const url = new URL(req.url)

    // Handle 7TV image proxy
    if (url.pathname.startsWith('/proxy/7tv/')) {
      return handleSevenTVImageProxy(req)
    }

    if (url.pathname === '/ws') {
      const secret = req.headers.get('X-Client-Secret')
      if (!secret) {
        return json({ error: 'Missing X-Client-Secret' }, 401)
      }
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(secret)) {
        return json({ error: 'Invalid X-Client-Secret' }, 401)
      }
      await ClientStore.upsert(secret)
      const upgraded = server.upgrade(req, { data: { clientSecret: secret } })
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 500 })
      }
      return undefined
    }

    return json({ error: 'Not found' }, 404)
  },
  hostname: '0.0.0.0',

  port: config.PORT,

  routes: {
    ...authRoutes,
    ...createDonationOAuthRoutes(memeAlertsOAuthCredentials),
    ...accountRoutes,
    ...streamRoutes,
    ...moderationRoutes,
    ...userCardRoutes,
    ...userProfileRoutes,
    ...chatToolsRoutes,
    ...emoteCatalogRoutes,
    ...providerProxyRoutes,
    ...twitchHistoryRoutes,
    ...webhookRoutes,
    ...youtubeRoutes,
    '/health': () => json({ ok: true }),
  },

  websocket: {
    close(ws, code, reason) {
      handleWsClose(ws, code, reason)
    },
    message(ws, message) {
      handleWsMessage(ws, message).catch((error: unknown) =>
        log.error('WebSocket message failed', { error: String(error) }),
      )
    },
    open(ws) {
      handleWsOpen(ws).catch((error: unknown) =>
        log.error('WebSocket open failed', { error: String(error) }),
      )
    },
  },
})

log.info('TwirChat backend running', {
  url: `http://localhost:${server.port}`,
})
log.info('WebSocket endpoint', { url: `ws://localhost:${server.port}/ws` })

const SHUTDOWN_TIMEOUT_MS = 5000
let shuttingDown = false

// A signal handler disables the default exit, and the database pool, 7TV socket and cache
// timers keep the event loop alive, so shutdown must exit explicitly. Otherwise every
// restart leaves an orphan process holding its PostgreSQL connections.
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    log.warn('Forced shutdown', { signal })
    process.exit(1)
  }
  shuttingDown = true
  log.info('Shutting down', { signal })
  setTimeout(() => {
    log.error('Shutdown timed out')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS).unref()

  youtubeChatRelay.stop()
  await server
    .stop(true)
    .catch((error: unknown) => log.error('Server shutdown failed', { error: String(error) }))
  await sql
    .close({ timeout: 2 })
    .catch((error: unknown) => log.error('Database shutdown failed', { error: String(error) }))
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] satisfies NodeJS.Signals[]) {
  process.on(signal, () => {
    shutdown(signal).catch((error: unknown) => {
      log.error('Shutdown failed', { error: String(error) })
      process.exit(1)
    })
  })
}
