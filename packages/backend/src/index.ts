import { runMigrations } from './db/migrations.ts'
import { ClientStore } from './db/index.ts'
import { handleWsClose, handleWsMessage, handleWsOpen } from './ws/handlers.ts'
import { authRoutes } from './routes/auth.ts'
import { accountRoutes } from './routes/accounts.ts'
import { streamRoutes } from './routes/stream.ts'
import { webhookRoutes } from './routes/webhooks.ts'
import { youtubeRoutes } from './routes/youtube.ts'
import { json } from './routes/utils.ts'
import type { WsData } from './ws/connection-manager.ts'
import { config } from './config.ts'
import { logger } from '@twirchat/shared/logger'
import { handleTwitchBadges } from './api/twitch-badges.ts'
import { handleSevenTVImageProxy } from './seventv/index.ts'

const log = logger('backend')

runMigrations()

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
    ...webhookRoutes,
    ...youtubeRoutes,
    '/health': () => json({ ok: true }),
  },

  websocket: {
    close(ws) {
      handleWsClose(ws)
    },
    message(ws, message) {
      void handleWsMessage(ws, message)
    },
    open(ws) {
      void handleWsOpen(ws)
    },
  },
})

log.info('TwirChat backend running', {
  url: `http://localhost:${server.port}`,
})
log.info('WebSocket endpoint', { url: `ws://localhost:${server.port}/ws` })
