import { resolveTwitchUserId, type TwitchUserCredentials } from './twitch-users.ts'

const MAX_USER_IDS_PER_REQUEST = 100

export interface TwitchChatter {
  avatarUrl?: string
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

  await collectPage()
  const avatarUrls = await fetchTwitchUserAvatars({
    ...input,
    ids: [...chatters.keys()],
    signal,
  })
  const enrichedChatters = [...chatters.values()]
  for (const chatter of enrichedChatters) {
    const avatarUrl = avatarUrls.get(chatter.userId)
    if (avatarUrl) {
      chatter.avatarUrl = avatarUrl
    }
  }

  return {
    broadcasterId,
    chatters: enrichedChatters,
    total: chatters.size,
  }
}
