import { AUTH_SERVER_PORT } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import type { Platform } from '@twirchat/shared/types'

import type { WebviewSender } from '../shared/rpc'
import { AccountStore } from '../store/account-store'
import { ChannelStore } from '../store/channel-store'
import { handleKickCallback } from './kick'
import { handleVkPlayToken } from './vkplay'
import { handleYouTubeCallback } from './youtube'

const log = logger('auth-server')

const AUTH_SHUTDOWN_GRACE_MS = 2000
let sendToView: WebviewSender | null = null
type AuthSuccessCallback = (
  platform: Platform,
  channelSlug: string,
  accountId?: string,
  signal?: AbortSignal,
) => void | Promise<void>

let onAuthSuccessCallback: AuthSuccessCallback | null = null

export function setAuthServerRpcSender(sender: WebviewSender): void {
  sendToView = sender
}

export function setOnAuthSuccessCallback(callback: AuthSuccessCallback | null): void {
  onAuthSuccessCallback = callback
}

export async function finishDesktopSignIn(
  platform: Platform,
  {
    channelSlug,
    username,
    displayName,
  }: { channelSlug: string; username: string; displayName: string },
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  ChannelStore.save(platform, channelSlug)
  await onAuthSuccessCallback?.(
    platform,
    channelSlug,
    AccountStore.findByPlatform(platform)?.id,
    signal,
  )
  signal?.throwIfAborted()
  sendToView?.auth_success({ platform, username, displayName })
}

export async function handleAuthCallback(req: Request, signal?: AbortSignal): Promise<Response> {
  const url = new URL(req.url)

  try {
    signal?.throwIfAborted()
    if (req.method === 'GET' && url.pathname === '/auth/youtube/callback') {
      const result = await handleYouTubeCallback(url, signal)
      await finishDesktopSignIn(
        'youtube',
        { ...result.user, channelSlug: result.channelSlug },
        signal,
      )
      return successResponse('YouTube')
    }
    if (req.method === 'GET' && url.pathname === '/auth/kick/callback') {
      const result = await handleKickCallback(url, signal)
      await finishDesktopSignIn('kick', { ...result.user, channelSlug: result.channelSlug }, signal)
      return successResponse('Kick')
    }
    if (url.pathname === '/auth/vkplay/callback' && req.method === 'GET') {
      return vkPlayCallbackPage()
    }
    if (url.pathname === '/auth/vkplay/callback' && req.method === 'POST') {
      const result = await handleVkPlayToken(new URLSearchParams(await req.text()), signal)
      await finishDesktopSignIn(
        'vkplay',
        { ...result.user, channelSlug: result.channelSlug },
        signal,
      )
      return successResponse('VK Play Live')
    }
  } catch (err) {
    if (signal?.aborted) return new Response(null, { status: 503 })
    log.error('Callback error', { error: String(err) })
    return new Response(errorPage(String(err)), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  return new Response('Not found', { status: 404 })
}

export function startAuthServer({
  port = AUTH_SERVER_PORT,
  graceMs = AUTH_SHUTDOWN_GRACE_MS,
} = {}) {
  const cancellation = new AbortController()
  const callbacks = new Set<Promise<Response>>()
  let stopping: Promise<void> | undefined
  const server = Bun.serve({
    async fetch(req) {
      if (stopping) return new Response(null, { status: 503 })
      const callback = handleAuthCallback(req, cancellation.signal)
      callbacks.add(callback)
      try {
        return await callback
      } finally {
        callbacks.delete(callback)
      }
    },
    hostname: '127.0.0.1',
    port,
  })

  async function drain(): Promise<void> {
    // A browser disconnect can release Bun's request while its callback is still working.
    const done = Promise.all([server.stop(), Promise.allSettled(callbacks)])
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const expired = new Promise<true>((resolve) => {
        timer = setTimeout(() => resolve(true), graceMs)
      })
      if (await Promise.race([done.then(() => false), expired])) {
        cancellation.abort()
        await server.stop(true)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  log.info(`OAuth server listening on port ${server.port}`)
  return { port: server.port, stop: () => (stopping ??= drain()) }
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
