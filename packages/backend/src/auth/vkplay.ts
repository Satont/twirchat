import { VKPLAY_AUTH_URL, VKPLAY_SCOPES, VKPLAY_TOKEN_URL } from '@twirchat/shared/constants'
import { z } from 'zod'

import { config } from '../config'

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
})

export class VkPlayOAuthUnavailableError extends Error {}

function credentials(): { clientId: string; clientSecret: string } {
  const { VKPLAY_CLIENT_ID, VKPLAY_CLIENT_SECRET } = config
  if (!VKPLAY_CLIENT_ID || !VKPLAY_CLIENT_SECRET) {
    throw new VkPlayOAuthUnavailableError('VK Play Live OAuth is not configured on this backend.')
  }
  return { clientId: VKPLAY_CLIENT_ID, clientSecret: VKPLAY_CLIENT_SECRET }
}

async function tokenRequest(body: URLSearchParams): Promise<z.infer<typeof tokenSchema>> {
  const { clientId, clientSecret } = credentials()
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(VKPLAY_TOKEN_URL, {
    body: body.toString(),
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `VK Play Live token request failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`,
    )
  }
  return tokenSchema.parse(await response.json())
}

export function isVkPlayOAuthConfigured(): boolean {
  return Boolean(config.VKPLAY_CLIENT_ID && config.VKPLAY_CLIENT_SECRET)
}

export function buildVkPlayAuthUrl(state: string, redirectUri: string): string {
  const { clientId } = credentials()
  const url = new URL(VKPLAY_AUTH_URL)
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: VKPLAY_SCOPES.join(','),
    state,
  }).toString()
  return url.toString()
}

export async function exchangeVkPlayCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; scope?: string[] }> {
  const tokens = await tokenRequest(
    new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  )
  return {
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope?.split(/[\s,]+/u).filter(Boolean),
  }
}

export async function refreshVkPlayToken(
  refreshToken: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      redirect_uri: redirectUri,
      refresh_token: refreshToken,
    }),
  )
  return {
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    refreshToken: tokens.refresh_token,
  }
}
