import { logger } from '@twirchat/shared/logger'

import { handleTwitchBadges } from './api/twitch-badges.ts'
import { createTwitchHistoryService } from './api/twitch-history.ts'
import { config } from './config.ts'
import { ClientStore } from './db/index.ts'
import { runMigrations } from './db/migrations.ts'
import { accountRoutes } from './routes/accounts.ts'
import { authRoutes } from './routes/auth.ts'
import { chatToolsRoutes } from './routes/chat-tools.ts'
import { emoteCatalogRoutes } from './routes/emote-catalog.ts'
import { moderationRoutes } from './routes/moderation.ts'
import { providerProxyRoutes } from './routes/provider-proxy.ts'
import { streamRoutes } from './routes/stream.ts'
import { twitchActivitiesRoutes } from './routes/twitch-activities.ts'
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
    ...accountRoutes,
    ...streamRoutes,
    ...moderationRoutes,
    ...userCardRoutes,
    ...userProfileRoutes,
    ...chatToolsRoutes,
    ...twitchActivitiesRoutes,
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

for (const signal of ['SIGINT', 'SIGTERM'] satisfies NodeJS.Signals[]) {
  process.once(signal, () => {
    youtubeChatRelay.stop()
    server
      .stop(true)
      .catch((error: unknown) => log.error('Server shutdown failed', { error: String(error) }))
  })
}
