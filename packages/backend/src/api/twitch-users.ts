import { config } from '../config.ts'
import { fetchTwitchHelixWithAppToken } from './stream-status.ts'

export interface HelixUser {
  id: string
  login: string
}

const TWITCH_LOGIN_RE = /^[a-z0-9_]{4,25}$/
const TWITCH_USER_ID_RE = /^\d+$/

export function normalizeTwitchLogin(login: string): string | null {
  const normalized = login
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/www\.twitch\.tv\//, '')
    .replace(/^https?:\/\/twitch\.tv\//, '')
    .replace(/^twitch\.tv\//, '')
    .replace(/\/+$/, '')

  if (!TWITCH_LOGIN_RE.test(normalized)) {
    return null
  }

  return normalized
}

export function isTwitchUserId(id: string | undefined | null): id is string {
  return Boolean(id && TWITCH_USER_ID_RE.test(id))
}

export async function resolveTwitchUserId(
  identifier: string,
  userAccessToken?: string,
): Promise<string | null> {
  if (isTwitchUserId(identifier)) {
    return identifier
  }

  const normalizedLogin = normalizeTwitchLogin(identifier)
  if (!normalizedLogin) {
    return null
  }

  const resolvedUsers = await resolveTwitchUserIdsByLogin([normalizedLogin], userAccessToken)
  return resolvedUsers.get(normalizedLogin) ?? null
}

export async function resolveTwitchUserIdsByLogin(
  logins: string[],
  userAccessToken?: string,
): Promise<Map<string, string>> {
  const normalizedLogins = [
    ...new Set(logins.map(normalizeTwitchLogin).filter((login): login is string => Boolean(login))),
  ]
  const loginToId = new Map<string, string>()

  if (normalizedLogins.length === 0) {
    return loginToId
  }

  const params = normalizedLogins.map((login) => `login=${encodeURIComponent(login)}`).join('&')
  const url = `https://api.twitch.tv/helix/users?${params}`
  const response = userAccessToken
    ? await fetch(url, {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          'Client-Id': config.TWITCH_CLIENT_ID,
        },
      })
    : await fetchTwitchHelixWithAppToken(url)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Twitch /helix/users failed: ${response.status} ${body}`)
  }

  const payload = (await response.json()) as { data: HelixUser[] }
  for (const user of payload.data) {
    loginToId.set(user.login.toLowerCase(), user.id)
  }

  return loginToId
}
