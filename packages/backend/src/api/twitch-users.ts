import { z } from 'zod'

import { fetchTwitchHelixWithAppToken } from './stream-status.ts'

export interface HelixUser {
  id: string
  login: string
}

export interface HelixUserProfile extends HelixUser {
  display_name?: string
  profile_image_url?: string
}

const TWITCH_LOGIN_RE = /^[a-z0-9_]{1,25}$/
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

export async function resolveTwitchUserId(identifier: string): Promise<string | null> {
  if (isTwitchUserId(identifier)) {
    return identifier
  }

  const normalizedLogin = normalizeTwitchLogin(identifier)
  if (!normalizedLogin) {
    return null
  }

  const resolvedUsers = await resolveTwitchUserIdsByLogin([normalizedLogin])
  return resolvedUsers.get(normalizedLogin) ?? null
}

export async function resolveTwitchUserIdsByLogin(logins: string[]): Promise<Map<string, string>> {
  const normalizedLogins = [
    ...new Set(logins.map(normalizeTwitchLogin).filter((login): login is string => Boolean(login))),
  ]
  const loginToId = new Map<string, string>()

  if (normalizedLogins.length === 0) {
    return loginToId
  }

  const params = normalizedLogins.map((login) => `login=${encodeURIComponent(login)}`).join('&')
  const url = `https://api.twitch.tv/helix/users?${params}`
  const response = await fetchTwitchHelixWithAppToken(url)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Twitch /helix/users failed: ${response.status} ${body}`)
  }

  const payload = z
    .object({ data: z.array(z.object({ id: z.string(), login: z.string() })) })
    .parse(await response.json())
  for (const user of payload.data) {
    loginToId.set(user.login.toLowerCase(), user.id)
  }

  return loginToId
}

export async function fetchTwitchUserById(userId: string): Promise<HelixUserProfile | null> {
  if (!isTwitchUserId(userId)) {
    return null
  }

  return fetchTwitchUserProfile(`id=${encodeURIComponent(userId)}`)
}

export async function fetchTwitchUserByLogin(login: string): Promise<HelixUserProfile | null> {
  const normalized = normalizeTwitchLogin(login)
  if (!normalized) return null
  return fetchTwitchUserProfile(`login=${encodeURIComponent(normalized)}`)
}

async function fetchTwitchUserProfile(query: string): Promise<HelixUserProfile | null> {
  const url = `https://api.twitch.tv/helix/users?${query}`
  const response = await fetchTwitchHelixWithAppToken(url)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Twitch /helix/users failed: ${response.status} ${body}`)
  }

  const payload = z
    .object({
      data: z.array(
        z.object({
          id: z.string(),
          login: z.string(),
          display_name: z.string().optional(),
          profile_image_url: z.string().optional(),
        }),
      ),
    })
    .parse(await response.json())
  return payload.data[0] ?? null
}
