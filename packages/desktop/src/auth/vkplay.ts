import {
  VKPLAY_AUTH_URL,
  VKPLAY_DEV_API_BASE,
  VKPLAY_REDIRECT_URI,
  VKPLAY_SCOPES,
} from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import type { Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { AccountStore } from '../store/account-store'
import { getVkPlayDesktopClientId } from './client-config'
import { generateState } from './pkce'
import { successPage } from './server'

const log = logger('auth-vkplay')
const SESSION_TTL_MS = 10 * 60 * 1000

const pendingSessions = new Map<string, { expiresAt: number }>()

const currentUserSchema = z.object({
  data: z.object({
    channel: z.object({ url: z.string() }).optional(),
    channels: z.array(z.object({ url: z.string() })).optional(),
    user: z.object({
      avatar_url: z.string().optional(),
      id: z.union([z.number().int(), z.string().min(1)]),
      nick: z.string().min(1),
    }),
  }),
})

function cleanupSessions(): void {
  const now = Date.now()
  for (const [state, session] of pendingSessions) {
    if (session.expiresAt <= now) pendingSessions.delete(state)
  }
}

function currentUserChannel(data: z.infer<typeof currentUserSchema>['data']): string {
  return data.channel?.url ?? data.channels?.[0]?.url ?? data.user.nick
}

export function getVkPlayAuthUrl(): string {
  const clientId = getVkPlayDesktopClientId()
  cleanupSessions()
  const state = generateState()
  pendingSessions.set(state, { expiresAt: Date.now() + SESSION_TTL_MS })
  const url = new URL(VKPLAY_AUTH_URL)
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: VKPLAY_REDIRECT_URI,
    response_type: 'token',
    scope: VKPLAY_SCOPES.join(','),
    state,
  }).toString()
  return url.toString()
}

/** Reads the implicit-flow token from the URL fragment and posts it to the auth server. */
export function vkPlayCallbackPage(): Response {
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

export async function handleVkPlayToken(params: URLSearchParams): Promise<{
  channelSlug: string
  response: Response
  user: { platform: Platform; username: string; displayName: string }
}> {
  const error = params.get('error')
  if (error) {
    throw new Error(`VK Play Live OAuth error: ${error} — ${params.get('error_description') ?? ''}`)
  }
  const state = params.get('state')
  const accessToken = params.get('access_token')
  const tokenType = params.get('token_type')
  const expireTime = Number(params.get('expire_time') ?? Number.NaN)
  if (!state || !accessToken || !tokenType || !Number.isFinite(expireTime)) {
    throw new Error('VK Play Live returned an incomplete token.')
  }
  if (tokenType.toLowerCase() !== 'bearer') {
    throw new Error('VK Play Live returned a non-bearer token.')
  }
  if (expireTime * 1000 <= Date.now()) throw new Error('VK Play Live returned an expired token.')
  const session = pendingSessions.get(state)
  if (!session || session.expiresAt <= Date.now()) {
    pendingSessions.delete(state)
    throw new Error('Unknown or expired VK Play Live OAuth state')
  }
  pendingSessions.delete(state)

  const userRes = await fetch(`${VKPLAY_DEV_API_BASE}/v1/current_user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Origin: 'https://live.vkvideo.ru',
      'User-Agent': 'TwirChat',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!userRes.ok) throw new Error(`VK Play Live user request failed (HTTP ${userRes.status})`)
  const profile = currentUserSchema.parse(await userRes.json()).data
  const channelSlug = currentUserChannel(profile)
  const displayName = profile.user.nick

  AccountStore.upsert({
    accessToken,
    avatarUrl: profile.user.avatar_url,
    displayName,
    expiresAt: expireTime,
    id: `vkplay:${profile.user.id}`,
    platform: 'vkplay',
    platformUserId: String(profile.user.id),
    scopes: [...VKPLAY_SCOPES],
    username: channelSlug,
  })

  log.info('Account signed in', { platform: 'vkplay' })
  return {
    channelSlug,
    response: new Response(successPage('VK Play Live'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
    user: { displayName, platform: 'vkplay', username: channelSlug },
  }
}
