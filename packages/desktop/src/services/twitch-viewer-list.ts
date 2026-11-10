import { z } from 'zod'

import { TwitchTokenValidationError, validateTwitchUserToken } from '../auth/twitch-user-token'
import { getTwitchChatters, TwitchChattersError } from './twitch-chatters'

const COMMUNITY_VIEWER_LIMIT = 1000
const COMMUNITY_RESPONSE_LIMIT = 1024 * 1024
const twitchLoginPattern = /^[a-z0-9_]{1,25}$/
const logins = z.array(z.string()).optional()
const communitySchema = z
  .object({
    broadcasters: logins,
    staff: logins,
    moderators: logins,
    vips: logins,
    chatbots: logins,
    viewers: logins,
  })
  .refine(({ broadcasters, viewers }) => broadcasters !== undefined || viewers !== undefined)

type CommunityChatters = z.infer<typeof communitySchema>
export type TwitchViewerRole = 'broadcaster' | 'moderators' | 'vips' | 'bots' | 'chatters'

const communityRoles: readonly [keyof CommunityChatters, TwitchViewerRole][] = [
  ['broadcasters', 'broadcaster'],
  ['moderators', 'moderators'],
  ['vips', 'vips'],
  ['chatbots', 'bots'],
  ['staff', 'chatters'],
  ['viewers', 'chatters'],
]

interface TwitchViewer {
  userId?: string
  username: string
  displayName: string
  avatarUrl?: string
  role: TwitchViewerRole
}

interface TwitchViewerList {
  source: 'helix' | 'community'
  viewers: TwitchViewer[]
}

async function readCommunityResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Community chatters response is empty')
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of response.body) {
    length += chunk.byteLength
    if (length > COMMUNITY_RESPONSE_LIMIT)
      throw new Error('Community chatters response is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function getCommunityViewers(broadcasterLogin: string): Promise<TwitchViewer[]> {
  const login = broadcasterLogin.trim().toLowerCase()
  if (!twitchLoginPattern.test(login)) throw new TwitchChattersError(404, 'Invalid Twitch login')

  const params = new URLSearchParams({ login, limit: String(COMMUNITY_VIEWER_LIMIT) })
  const response = await fetch(`https://api.tackling.cc/twitch/Chatters?${params}`, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Community chatters request failed: HTTP ${response.status}`)

  const groups = communitySchema.parse(await readCommunityResponse(response))
  const viewers = new Map<string, TwitchViewer>()
  for (const [group, role] of communityRoles) {
    for (const entry of groups[group] ?? []) {
      if (viewers.size === COMMUNITY_VIEWER_LIMIT) return [...viewers.values()]
      const username = entry.trim().toLowerCase()
      if (twitchLoginPattern.test(username) && !viewers.has(username)) {
        viewers.set(username, { username, displayName: username, role })
      }
    }
  }
  return [...viewers.values()]
}

async function getHelixViewers(
  broadcasterLogin: string,
  accessToken: string,
): Promise<TwitchViewer[] | null> {
  try {
    const { clientId, scopes, userId: moderatorId } = await validateTwitchUserToken(accessToken)
    if (!scopes.includes('moderator:read:chatters')) return null

    const { broadcasterId, chatters } = await getTwitchChatters({
      accessToken,
      broadcasterLogin,
      clientId,
      moderatorId,
      scopes,
    })
    return chatters.map(({ userId, userLogin, userName, avatarUrl, role }) => ({
      userId,
      username: userLogin,
      displayName: userName,
      avatarUrl,
      role:
        userId === broadcasterId
          ? 'broadcaster'
          : role === 'moderator'
            ? 'moderators'
            : role === 'vip'
              ? 'vips'
              : 'chatters',
    }))
  } catch (error) {
    if (
      (error instanceof TwitchChattersError || error instanceof TwitchTokenValidationError) &&
      (error.status === 401 || error.status === 403)
    ) {
      return null
    }
    throw error
  }
}

export async function getTwitchViewerList({
  broadcasterLogin,
  accessToken,
}: {
  broadcasterLogin: string
  accessToken?: string | null
}): Promise<TwitchViewerList> {
  const viewers = accessToken ? await getHelixViewers(broadcasterLogin, accessToken) : null
  if (viewers !== null) return { source: 'helix', viewers }
  return { source: 'community', viewers: await getCommunityViewers(broadcasterLogin) }
}
