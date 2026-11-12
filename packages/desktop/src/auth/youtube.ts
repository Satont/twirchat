import {
  YOUTUBE_AUTH_URL,
  YOUTUBE_REDIRECT_URI,
  YOUTUBE_TOKEN_URL,
} from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { AccountStore } from '../store/account-store'
import { getYouTubeDesktopCredentials } from './client-config'
import { postOAuthForm } from './oauth-form'
import { createPkceSessions } from './pkce'
import { createOAuthRefresher } from './refresh-token'
import { expiresAt, oauthTokenSchema } from './response-schemas'
import { successPage } from './server'

const log = logger('auth-youtube')
const sessions = createPkceSessions()
const scopes = [
  'openid',
  'profile',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
]

export function getYouTubeAuthUrl(): string {
  return sessions.authorize(
    YOUTUBE_AUTH_URL,
    getYouTubeDesktopCredentials().client_id,
    YOUTUBE_REDIRECT_URI,
    scopes,
    { access_type: 'offline', prompt: 'consent select_account' },
  )
}

export async function handleYouTubeCallback(url: URL) {
  const { code, codeVerifier } = sessions.consume(url)
  const exchangeRes = await postOAuthForm(YOUTUBE_TOKEN_URL, {
    ...getYouTubeDesktopCredentials(),
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: YOUTUBE_REDIRECT_URI,
  })
  if (!exchangeRes.ok)
    throw new Error(t('runtime.auth.youtubeExchangeFailed', { status: exchangeRes.status }))
  const tokens = oauthTokenSchema.parse(await exchangeRes.json())
  // Fetch user info from YouTube Data API
  const userRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    },
  )

  let userId: string
  let displayName: string
  let customUrl: string | undefined
  let avatarUrl: string | undefined

  if (userRes.ok) {
    const userData = z
      .object({
        items: z
          .array(
            z.object({
              id: z.string(),
              snippet: z.object({
                title: z.string(),
                customUrl: z.string().optional(),
                thumbnails: z
                  .object({ default: z.object({ url: z.string() }).optional() })
                  .optional(),
              }),
            }),
          )
          .optional(),
      })
      .parse(await userRes.json())

    const channel = userData.items?.[0]
    if (!channel) throw new Error(t('runtime.auth.youtubeChannelRequired'))
    userId = channel.id
    displayName = channel.snippet.title
    ;({ customUrl } = channel.snippet)
    avatarUrl = channel.snippet.thumbnails?.default?.url
  } else {
    log.warn(`YouTube channels API returned ${userRes.status}, falling back to Google userinfo`)

    // Fall back to Google OpenID Connect userinfo endpoint (always available with openid + profile scopes)
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })

    if (!infoRes.ok) {
      throw new Error(
        `YouTube user info request failed: ${userRes.status} (channels API); ${infoRes.status} (userinfo)`,
      )
    }

    const info = z
      .object({
        sub: z.string(),
        name: z.string().optional(),
        given_name: z.string().optional(),
        picture: z.string().optional(),
      })
      .parse(await infoRes.json())

    userId = info.sub
    displayName = info.name ?? info.given_name ?? info.sub
    avatarUrl = info.picture
  }

  const username = customUrl ?? userId

  AccountStore.upsert({
    accessToken: tokens.access_token,
    avatarUrl,
    displayName,
    expiresAt: expiresAt(tokens.expires_in),
    id: `youtube:${userId}`,
    platform: 'youtube',
    platformUserId: userId,
    refreshToken: tokens.refresh_token,
    scopes: tokens.scope,
    username,
  })

  log.info('Account signed in', { platform: 'youtube' })

  return {
    channelSlug: username,
    response: new Response(successPage('YouTube'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
    user: {
      displayName,
      username,
    },
  }
}

export const refreshYouTubeToken = createOAuthRefresher(
  'YouTube',
  YOUTUBE_TOKEN_URL,
  getYouTubeDesktopCredentials,
)
