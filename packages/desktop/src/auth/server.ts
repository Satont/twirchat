import { AUTH_SERVER_PORT } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import { handleYouTubeCallback } from './youtube'
import { handleTwitchCallback } from './twitch'
import { handleKickCallback } from './kick'
import { ChannelStore } from '../store/channel-store'
import { pushEvent } from '../event-bus'
import type { Platform } from '@twirchat/shared/types'

const log = logger('auth-server')

let server: Deno.HttpServer | null = null
let onAuthSuccessCallback: ((platform: Platform, channelSlug?: string) => void) | null = null

export function setOnAuthSuccessCallback(
  callback: (platform: Platform, channelSlug?: string) => void,
): void {
  onAuthSuccessCallback = callback
}

export function setOnAutoJoinChannelCallback(
  _callback: (platform: Platform, channelSlug: string) => void,
): void {}

export function startAuthServer(): void {
  if (server) {
    return
  }

  server = Deno.serve({
    port: AUTH_SERVER_PORT,
    async handler(req) {
      const url = new URL(req.url)

      try {
        if (url.pathname === '/auth/twitch/callback') {
          const result = await handleTwitchCallback(url)

          ChannelStore.save('twitch', result.channelSlug)

          pushEvent('auth_success', result.user)

          if (onAuthSuccessCallback) {
            onAuthSuccessCallback('twitch', result.channelSlug)
          }

          return result.response
        }
        if (url.pathname === '/auth/youtube/callback') {
          const result = await handleYouTubeCallback(url)

          ChannelStore.save('youtube', result.channelSlug)

          pushEvent('auth_success', result.user)

          if (onAuthSuccessCallback) {
            onAuthSuccessCallback('youtube', result.channelSlug)
          }

          return result.response
        }
        if (url.pathname === '/auth/kick/callback') {
          const result = await handleKickCallback(url)

          ChannelStore.save('kick', result.channelSlug)

          pushEvent('auth_success', result.user)

          if (onAuthSuccessCallback) {
            onAuthSuccessCallback('kick', result.channelSlug)
          }

          return result.response
        }
      } catch (err) {
        log.error('Callback error', { error: String(err) })
        return new Response(errorPage(String(err)), {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      return new Response('Not found', { status: 404 })
    },
  })

  log.info(`OAuth server listening on port ${AUTH_SERVER_PORT}`)
}

export function stopAuthServer(): void {
  server?.shutdown()
  server = null
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Auth Error</title></head>
<body style="font-family:sans-serif;padding:2rem;background:#1a1a1a;color:#ff6b6b;">
  <h1>Authentication Error</h1>
  <p>${message}</p>
  <p>You can close this window.</p>
</body>
</html>`
}

export function successPage(platform: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Authentication Successful</title></head>
<body style="font-family:sans-serif;padding:2rem;background:#1a1a1a;color:#4caf50;">
  <h1>Successfully connected to ${platform}!</h1>
  <p>You can close this window and return to TwirChat.</p>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`
}
