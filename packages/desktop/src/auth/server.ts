import { AUTH_SERVER_PORT } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import { handleYouTubeCallback } from './youtube'
import { handleTwitchCallback } from './twitch'
import { handleKickCallback } from './kick'
import { ChannelStore } from '../store/channel-store'
import type { WebviewSender } from '../shared/rpc'
import type { Platform } from '@twirchat/shared/types'

const log = logger('auth-server')

let server: ReturnType<typeof Bun.serve> | null = null
let sendToView: WebviewSender | null = null
let onAuthSuccessCallback: ((platform: Platform, channelSlug?: string) => void) | null = null

export function setAuthServerRpcSender(sender: WebviewSender): void {
  sendToView = sender
}

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

  server = Bun.serve({
    async fetch(req) {
      const url = new URL(req.url)

      try {
        if (url.pathname === '/auth/twitch/callback') {
          const result = await handleTwitchCallback(url)

          // Save the channel to automatically join it
          ChannelStore.save('twitch', result.channelSlug)

          // Notify the webview of successful authentication
          if (sendToView) {
            sendToView.auth_success(result.user)
          }

          // Trigger reconnection and auto-join the channel
          if (onAuthSuccessCallback) {
            onAuthSuccessCallback('twitch', result.channelSlug)
          }

          return result.response
        }
        if (url.pathname === '/auth/youtube/callback') {
          const result = await handleYouTubeCallback(url)

          // Save the channel to automatically join it
          ChannelStore.save('youtube', result.channelSlug)

          // Notify the webview of successful authentication
          if (sendToView) {
            sendToView.auth_success(result.user)
          }

          // Trigger reconnection and auto-join the channel
          if (onAuthSuccessCallback) {
            onAuthSuccessCallback('youtube', result.channelSlug)
          }

          return result.response
        }
        if (url.pathname === '/auth/kick/callback') {
          const result = await handleKickCallback(url)

          // Save the channel to automatically join it
          ChannelStore.save('kick', result.channelSlug)

          // Notify the webview of successful authentication
          if (sendToView) {
            sendToView.auth_success(result.user)
          }

          // Trigger reconnection and auto-join the channel
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
    port: AUTH_SERVER_PORT,
  })

  log.info(`OAuth server listening on port ${AUTH_SERVER_PORT}`)
}

export function stopAuthServer(): void {
  server?.stop()
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
