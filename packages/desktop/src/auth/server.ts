import { AUTH_SERVER_PORT } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import type { Platform } from '@twirchat/shared/types'

import { runInBackground } from '../services/background-task'
import type { WebviewSender } from '../shared/rpc'
import { AccountStore } from '../store/account-store'
import { ChannelStore } from '../store/channel-store'
import { handleKickCallback } from './kick'
import { handleVkPlayToken } from './vkplay'
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

export async function finishDesktopSignIn(
  platform: Platform,
  {
    channelSlug,
    username,
    displayName,
  }: { channelSlug: string; username: string; displayName: string },
): Promise<void> {
  ChannelStore.save(platform, channelSlug)
  await onAuthSuccessCallback?.(platform, channelSlug, AccountStore.findByPlatform(platform)?.id)
  sendToView?.auth_success({ platform, username, displayName })
}

export async function handleAuthCallback(req: Request): Promise<Response> {
  const url = new URL(req.url)

  try {
    if (req.method === 'GET' && url.pathname === '/auth/youtube/callback') {
      const result = await handleYouTubeCallback(url)
      await finishDesktopSignIn('youtube', { ...result.user, channelSlug: result.channelSlug })
      return successResponse('YouTube')
    }
    if (req.method === 'GET' && url.pathname === '/auth/kick/callback') {
      const result = await handleKickCallback(url)
      await finishDesktopSignIn('kick', { ...result.user, channelSlug: result.channelSlug })
      return successResponse('Kick')
    }
    if (url.pathname === '/auth/vkplay/callback' && req.method === 'GET') {
      return vkPlayCallbackPage()
    }
    if (url.pathname === '/auth/vkplay/callback' && req.method === 'POST') {
      const result = await handleVkPlayToken(new URLSearchParams(await req.text()))
      await finishDesktopSignIn('vkplay', { ...result.user, channelSlug: result.channelSlug })
      return successResponse('VK Play Live')
    }
  } catch (err) {
    log.error('Callback error', { error: String(err) })
    return new Response(errorPage(String(err)), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  return new Response('Not found', { status: 404 })
}

export function startAuthServer(): void {
  if (server) {
    return
  }

  server = Bun.serve({
    fetch: handleAuthCallback,
    hostname: '127.0.0.1',
    port: AUTH_SERVER_PORT,
  })

  log.info(`OAuth server listening on port ${AUTH_SERVER_PORT}`)
}

export function stopAuthServer(): void {
  if (server) runInBackground(server.stop(), 'OAuth server shutdown failed')
  server = null
}

function errorPage(message: string): string {
  const escaped = message.replace(/[&<>]/gu, (character) =>
    character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;',
  )
  return `<!DOCTYPE html>
<html>
<head><title>Auth Error</title></head>
<body style="font-family:sans-serif;padding:2rem;background:#1a1a1a;color:#ff6b6b;">
  <h1>Authentication Error</h1>
  <p>${escaped}</p>
  <p>You can close this window.</p>
</body>
</html>`
}

function successResponse(platform: string): Response {
  return new Response(
    `<!DOCTYPE html>
<html>
<head><title>Authentication Successful</title></head>
<body style="font-family:sans-serif;padding:2rem;background:#1a1a1a;color:#4caf50;">
  <h1>Successfully connected to ${platform}!</h1>
  <p>You can close this window and return to TwirChat.</p>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

/** Reads the implicit-flow token from the URL fragment and posts it to the auth server. */
function vkPlayCallbackPage(): Response {
  return new Response(
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>VK Play Live</title></head>
<body style="font-family:sans-serif;padding:2rem;background:#1a1a1a;color:#e5e7eb;">
  <p id="status">Completing VK Play Live sign-in…</p>
  <script>
    const fragment = new URLSearchParams(location.hash.slice(1))
    history.replaceState(null, '', location.pathname)
    if (!fragment.toString()) {
      document.getElementById('status').textContent = 'VK Play Live returned no token.'
    } else {
      fetch(location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fragment.toString(),
      }).then(async (response) => {
        document.open()
        document.write(await response.text())
        document.close()
      }).catch(() => {
        document.getElementById('status').textContent = 'VK Play Live sign-in failed.'
      })
    }
  </script>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
