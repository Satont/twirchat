import { z } from 'zod'

import { resolveTwitchUserId, type TwitchUserCredentials } from './twitch-users.ts'

const MAX_USER_IDS_PER_REQUEST = 100
const rolePageSchema = z.object({
  data: z.array(z.object({ user_id: z.string().min(1) })),
  pagination: z.object({ cursor: z.string().optional() }),
})

export interface TwitchChatter {
  avatarUrl?: string
  role?: 'moderator' | 'vip'
  userId: string
  userLogin: string
  userName: string
}

export interface TwitchChattersResult {
  broadcasterId: string
  total: number
  chatters: TwitchChatter[]
}

export class TwitchChattersError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'TwitchChattersError'
  }
}

interface TwitchChattersInput extends TwitchUserCredentials {
  broadcasterLogin: string
  moderatorId: string
  scopes?: readonly string[]
}

interface TwitchChattersPage {
  chatters: TwitchChatter[]
  cursor?: string
}

interface FetchChattersPageInput extends TwitchUserCredentials {
  broadcasterId: string
  cursor?: string
  moderatorId: string
  signal: AbortSignal
}

interface FetchTwitchUserAvatarsInput extends TwitchUserCredentials {
  ids: string[]
  signal: AbortSignal
}

interface FetchTwitchRoleIdsInput extends TwitchUserCredentials {
  broadcasterId: string
  path: 'moderation/moderators' | 'channels/vips'
  signal: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function helixString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TwitchChattersError(502, `Twitch chatters response has invalid ${field}`)
  }
  return value
}

function parsePage(payload: unknown): TwitchChattersPage {
  if (!isRecord(payload) || !Array.isArray(payload.data) || !isRecord(payload.pagination)) {
    throw new TwitchChattersError(502, 'Twitch chatters response is malformed')
  }

  const chatters = payload.data.map((value) => {
    if (!isRecord(value)) {
      throw new TwitchChattersError(502, 'Twitch chatters response has malformed chatter data')
    }

    return {
      userId: helixString(value.user_id, 'user_id'),
      userLogin: helixString(value.user_login, 'user_login'),
      userName: helixString(value.user_name, 'user_name'),
    }
  })

  const cursorValue = payload.pagination.cursor
  if (cursorValue !== undefined && typeof cursorValue !== 'string') {
    throw new TwitchChattersError(502, 'Twitch chatters response has an invalid pagination cursor')
  }

  if (typeof payload.total !== 'number' || !Number.isInteger(payload.total) || payload.total < 0) {
    throw new TwitchChattersError(502, 'Twitch chatters response has an invalid total')
  }

  return { chatters, cursor: cursorValue || undefined }
}

async function fetchChattersPage(input: FetchChattersPageInput): Promise<TwitchChattersPage> {
  const params = new URLSearchParams({
    broadcaster_id: input.broadcasterId,
    first: '1000',
    moderator_id: input.moderatorId,
  })
  if (input.cursor) {
    params.set('after', input.cursor)
  }

  let response: Response
  try {
    response = await fetch(`https://api.twitch.tv/helix/chat/chatters?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Client-Id': input.clientId,
      },
      method: 'GET',
      redirect: 'error',
      signal: input.signal,
    })
  } catch {
    throw new TwitchChattersError(502, 'Twitch chatters request failed')
  }

  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? response.status : 502
    throw new TwitchChattersError(status, `Twitch chatters request failed: HTTP ${response.status}`)
  }

  try {
    return parsePage(await response.json())
  } catch (error) {
    if (error instanceof TwitchChattersError) {
      throw error
    }
    throw new TwitchChattersError(502, 'Twitch chatters response is malformed')
  }
}

async function fetchTwitchUserAvatars(
  input: FetchTwitchUserAvatarsInput,
): Promise<Map<string, string>> {
  const avatars = new Map<string, string>()

  for (let offset = 0; offset < input.ids.length; offset += MAX_USER_IDS_PER_REQUEST) {
    const params = new URLSearchParams()
    for (const id of input.ids.slice(offset, offset + MAX_USER_IDS_PER_REQUEST)) {
      params.append('id', id)
    }

    let response: Response
    try {
      response = await fetch(`https://api.twitch.tv/helix/users?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Client-Id': input.clientId,
        },
        method: 'GET',
        redirect: 'error',
        signal: input.signal,
      })
    } catch {
      return new Map()
    }

    if (!response.ok) {
      return new Map()
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return new Map()
    }

    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      return new Map()
    }

    for (const value of payload.data) {
      if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.profile_image_url !== 'string' ||
        !value.profile_image_url
      ) {
        continue
      }
      avatars.set(value.id, value.profile_image_url)
    }
  }

  return avatars
}

async function fetchTwitchRoleIds(input: FetchTwitchRoleIdsInput): Promise<Set<string>> {
  const ids = new Set<string>()
  const seenCursors = new Set<string>()
  const params = new URLSearchParams({ broadcaster_id: input.broadcasterId, first: '100' })
  const collectPage = async (): Promise<void> => {
    const response = await fetch(`https://api.twitch.tv/helix/${input.path}?${params}`, {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Client-Id': input.clientId,
      },
      redirect: 'error',
      signal: input.signal,
    })
    if (!response.ok) throw new Error(`Twitch role lookup failed (HTTP ${response.status}).`)
    const page = rolePageSchema.parse(await response.json())
    for (const user of page.data) ids.add(user.user_id)

    const cursor = page.pagination.cursor
    if (!cursor) return
    if (seenCursors.has(cursor)) throw new Error('Twitch repeated a role pagination cursor.')
    seenCursors.add(cursor)
    params.set('after', cursor)
    return collectPage()
  }

  try {
    await collectPage()
    return ids
  } catch {
    return new Set()
  }
}

export async function getTwitchChatters(
  input: TwitchChattersInput,
  signal = AbortSignal.timeout(30000),
): Promise<TwitchChattersResult> {
  let broadcasterId: string | null
  try {
    broadcasterId = await resolveTwitchUserId(input.broadcasterLogin, input, signal)
  } catch {
    throw new TwitchChattersError(502, 'Twitch broadcaster lookup failed')
  }

  if (!broadcasterId) {
    throw new TwitchChattersError(404, `Twitch channel ${input.broadcasterLogin} was not found`)
  }

  const chatters = new Map<string, TwitchChatter>()
  const seenCursors = new Set<string>()
  const collectPage = async (cursor?: string): Promise<void> => {
    const page = await fetchChattersPage({
      ...input,
      broadcasterId,
      cursor,
      signal,
    })
    for (const chatter of page.chatters) {
      chatters.set(chatter.userId, chatter)
    }

    if (!page.cursor) {
      return
    }
    if (seenCursors.has(page.cursor)) {
      throw new TwitchChattersError(502, 'Twitch chatters response repeated a pagination cursor')
    }

    seenCursors.add(page.cursor)
    return collectPage(page.cursor)
  }

  const ownerScopes = input.moderatorId === broadcasterId ? input.scopes : undefined
  const roleInput = {
    ...input,
    broadcasterId,
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
  }
  const [avatarUrls, moderators, vips] = await Promise.all([
    collectPage().then(() =>
      fetchTwitchUserAvatars({ ...input, ids: [...chatters.keys()], signal }),
    ),
    ownerScopes?.some(
      (scope) => scope === 'moderation:read' || scope === 'channel:manage:moderators',
    )
      ? fetchTwitchRoleIds({ ...roleInput, path: 'moderation/moderators' })
      : undefined,
    ownerScopes?.some((scope) => scope === 'channel:read:vips' || scope === 'channel:manage:vips')
      ? fetchTwitchRoleIds({ ...roleInput, path: 'channels/vips' })
      : undefined,
  ])
  const enrichedChatters = [...chatters.values()]
  for (const chatter of enrichedChatters) {
    const avatarUrl = avatarUrls.get(chatter.userId)
    if (avatarUrl) {
      chatter.avatarUrl = avatarUrl
    }
    if (chatter.userId === broadcasterId) continue
    if (moderators?.has(chatter.userId)) chatter.role = 'moderator'
    else if (vips?.has(chatter.userId)) chatter.role = 'vip'
  }

  return {
    broadcasterId,
    chatters: enrichedChatters,
    total: chatters.size,
  }
}
