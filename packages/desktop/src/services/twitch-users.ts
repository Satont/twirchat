import { z } from 'zod'

export interface TwitchUserCredentials {
  accessToken: string
  clientId: string
}

export async function resolveTwitchUserId(
  identifier: string,
  credentials: TwitchUserCredentials,
  signal?: AbortSignal,
): Promise<string | null> {
  if (/^\d+$/.test(identifier)) return identifier
  const login = identifier
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//, '')
    .replace(/^twitch\.tv\//, '')
    .replace(/\/+$/, '')
  if (!/^[a-z0-9_]{1,25}$/.test(login)) return null

  const response = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
    {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Client-Id': credentials.clientId,
      },
      redirect: 'error',
      signal: signal ?? AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw new Error(`Twitch user lookup failed (HTTP ${response.status}).`)

  const result = z
    .object({ data: z.array(z.object({ id: z.string().regex(/^\d+$/) })) })
    .parse(await response.json())
  return result.data[0]?.id ?? null
}
