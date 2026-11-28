import { setTimeout as wait } from 'node:timers/promises'

import { TWITCH_TOKEN_URL } from '@twirchat/shared/constants'
import { z } from 'zod'

import { t } from '../i18n'
import { postOAuthForm } from './oauth-form'
import { oauthTokenSchema } from './response-schemas'

const deviceGrant = 'urn:ietf:params:oauth:grant-type:device_code'

const deviceCodeSchema = z.object({
  device_code: z.string().min(1),
  expires_in: z.number().int().positive().max(7200),
  interval: z.number().int().positive().max(120),
  user_code: z.string().regex(/^[A-Za-z0-9-]{1,32}$/u),
  verification_uri: z.url().refine((value) => {
    const url = new URL(value)
    return url.origin === 'https://www.twitch.tv' || url.origin === 'https://twitch.tv'
  }),
})
const deviceErrorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
})

interface DeviceRequest {
  clientId: string
  scopes: string
  signal: AbortSignal
  fetcher: typeof fetch
}

export async function requestDeviceCode({ clientId, scopes, signal, fetcher }: DeviceRequest) {
  const res = await postOAuthForm(
    'https://id.twitch.tv/oauth2/device',
    { client_id: clientId, scopes },
    signal,
    fetcher,
  )
  if (!res.ok) throw new Error(t('runtime.auth.startTwitchFailed', { status: res.status }))
  const code = deviceCodeSchema.parse(await res.json())
  return { clientId, code, deadline: Date.now() + code.expires_in * 1000 }
}

export type TwitchDeviceAttempt = Awaited<ReturnType<typeof requestDeviceCode>>

interface DevicePoll {
  attempt: TwitchDeviceAttempt
  signal: AbortSignal
  fetcher: typeof fetch
  scopes?: string
}

export async function pollDeviceToken({
  attempt: { clientId, code, deadline },
  signal,
  fetcher,
  scopes,
}: DevicePoll) {
  let interval = code.interval * 1000
  const body = {
    client_id: clientId,
    ...(scopes === undefined ? {} : { scopes }),
    device_code: code.device_code,
    grant_type: deviceGrant,
  }
  while (Date.now() < deadline) {
    // Twitch requires sequential polling with at least the advertised interval.
    // eslint-disable-next-line no-await-in-loop
    await wait(Math.min(interval, deadline - Date.now()), undefined, { signal })
    if (Date.now() >= deadline) break
    // eslint-disable-next-line no-await-in-loop
    const res = await postOAuthForm(TWITCH_TOKEN_URL, body, signal, fetcher)
    // eslint-disable-next-line no-await-in-loop
    const payload: unknown = await res.json().catch(() => null)
    if (res.ok) return oauthTokenSchema.parse(payload)
    const parsed = deviceErrorSchema.safeParse(payload)
    const reason = parsed.success ? (parsed.data.message ?? parsed.data.error) : undefined
    if (reason === 'authorization_pending') continue
    if (reason === 'slow_down' || res.status === 429) {
      interval += 5000
      continue
    }
    if (reason === 'access_denied') throw new Error(t('runtime.auth.twitchDeclined'))
    if (reason === 'expired_token' || reason === 'invalid device code') break
    throw new Error(t('runtime.auth.twitchFailed', { status: res.status }))
  }
  throw new Error(t('runtime.auth.twitchExpired'))
}
