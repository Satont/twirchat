import { AUTH_SERVER_PORT } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import type { Platform } from '@twirchat/shared/types'

import { runInBackground } from '../services/background-task'
import type { WebviewSender } from '../shared/rpc'
import { AccountStore } from '../store/account-store'
import { ChannelStore } from '../store/channel-store'
import { handleKickCallback } from './kick'
import { handleTwitchCallback } from './twitch'
import { handleYouTubeCallback } from './youtube'

const log = logger('auth-server')

let server: ReturnType<typeof Bun.serve> | null = null
let sendToView: WebviewSender | null = null
let onAuthSuccessCallback:
  | ((platform: Platform, channelSlug?: string, accountId?: string) => void | Promise<void>)
  | null = null

export function setAuthServerRpcSender(sender: WebviewSender): void {
  sendToView = sender
}

export function setOnAuthSuccessCallback(
  callback: (platform: Platform, channelSlug?: string, accountId?: string) => void | Promise<void>,
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

          await onAuthSuccessCallback?.(
            'twitch',
            result.channelSlug,
            AccountStore.findByPlatform('twitch')?.id,
          )
          sendToView?.auth_success(result.user)

          return result.response
        }
        if (url.pathname === '/auth/youtube/callback') {
          const result = await handleYouTubeCallback(url)

          // Save the channel to automatically join it
          ChannelStore.save('youtube', result.channelSlug)

          await onAuthSuccessCallback?.(
            'youtube',
            result.channelSlug,
            AccountStore.findByPlatform('youtube')?.id,
          )
          sendToView?.auth_success(result.user)

          return result.response
        }
        if (url.pathname === '/auth/kick/callback') {
          const result = await handleKickCallback(url)

          // Save the channel to automatically join it
          ChannelStore.save('kick', result.channelSlug)

          await onAuthSuccessCallback?.(
            'kick',
            result.channelSlug,
            AccountStore.findByPlatform('kick')?.id,
          )
          sendToView?.auth_success(result.user)

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
  if (server) runInBackground(server.stop(), 'OAuth server shutdown failed')
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
