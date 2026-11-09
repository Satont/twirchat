import { z } from 'zod'

const tokenSchema = z.object({
  client_id: z.string().min(1),
  user_id: z.string().min(1),
  login: z.string().min(1),
  scopes: z.array(z.string()).nullable(),
  expires_in: z.number().nonnegative(),
})

interface TwitchUserToken {
  clientId: string
  userId: string
  login: string
  scopes: string[]
  expiresIn: number
}

export class TwitchTokenValidationError extends Error {
  constructor(readonly status: number) {
    super(`Twitch token validation failed (HTTP ${status}).`)
  }
}

const validations = new Map<string, { expiresAt: number; result: Promise<TwitchUserToken> }>()
const validationTtl = 120_000
const maxValidations = 100

export function validateTwitchUserToken(
  accessToken: string,
  force = false,
): Promise<TwitchUserToken> {
  const now = Date.now()
  const cached = validations.get(accessToken)
  if (!force && cached && cached.expiresAt > now) return cached.result

  const entry = {
    expiresAt: now + validationTtl,
    result: fetch('https://id.twitch.tv/oauth2/validate', {
      redirect: 'error',
      headers: { Authorization: `OAuth ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (response) => {
        if (!response.ok) throw new TwitchTokenValidationError(response.status)
        const token = tokenSchema.parse(await response.json())
        entry.expiresAt = now + Math.min(validationTtl, token.expires_in * 1000)
        return {
          clientId: token.client_id,
          userId: token.user_id,
          login: token.login,
          scopes: token.scopes ?? [],
          expiresIn: token.expires_in,
        }
      })
      .catch((error: unknown) => {
        if (validations.get(accessToken) === entry) validations.delete(accessToken)
        throw error
      }),
  }
  validations.delete(accessToken)
  validations.set(accessToken, entry)
  if (validations.size > maxValidations) {
    const oldest = validations.keys().next()
    if (!oldest.done) validations.delete(oldest.value)
  }
  return entry.result
}

export async function createTwitchUserHelix(accessToken: string) {
  const token = await validateTwitchUserToken(accessToken)
  return {
    ...token,
    fetch(path: string): Promise<Response> {
      return fetch(`https://api.twitch.tv/helix/${path}`, {
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Client-Id': token.clientId,
        },
        signal: AbortSignal.timeout(12_000),
      })
    },
  }
}

export type TwitchUserHelix = Awaited<ReturnType<typeof createTwitchUserHelix>>
