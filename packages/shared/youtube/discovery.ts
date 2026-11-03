import type { YouTubeChatCredentials } from '../youtube-chat'

interface DiscoveryItem {
  id?: string | { videoId?: string }
  liveStreamingDetails?: { activeLiveChatId?: string }
  snippet?: { channelId?: string }
}

function optionalObject(value: unknown): object | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid YouTube discovery response.')
  return value
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error('Invalid YouTube discovery response.')
  return value
}

function parseDiscoveryItem(value: unknown): DiscoveryItem {
  const item = optionalObject(value)
  if (!item) throw new Error('Invalid YouTube discovery response.')
  const rawId: unknown = Reflect.get(item, 'id')
  const idObject = typeof rawId === 'string' ? undefined : optionalObject(rawId)
  const live = optionalObject(Reflect.get(item, 'liveStreamingDetails'))
  const snippet = optionalObject(Reflect.get(item, 'snippet'))
  return {
    id:
      typeof rawId === 'string'
        ? rawId
        : idObject
          ? { videoId: optionalString(Reflect.get(idObject, 'videoId')) }
          : undefined,
    liveStreamingDetails: live
      ? { activeLiveChatId: optionalString(Reflect.get(live, 'activeLiveChatId')) }
      : undefined,
    snippet: snippet ? { channelId: optionalString(Reflect.get(snippet, 'channelId')) } : undefined,
  }
}

function parseDiscoveryResponse(value: unknown): { items: DiscoveryItem[] } {
  const object = optionalObject(value)
  if (!object) throw new Error('Invalid YouTube discovery response.')
  const items: unknown = Reflect.get(object, 'items')
  if (items === undefined || items === null) return { items: [] }
  if (!Array.isArray(items)) throw new Error('Invalid YouTube discovery response.')
  const entries: readonly unknown[] = items
  return { items: entries.map(parseDiscoveryItem) }
}

export class YouTubeDiscoveryError extends Error {
  constructor(readonly status: number) {
    super(
      `YouTube discovery failed (${status}). Check credentials and quota, then reconnect manually.`,
    )
  }
}

export async function resolveYouTubeLiveChat(options: {
  channelId: string
  videoId?: string
  credentials: YouTubeChatCredentials
  fetcher?: typeof fetch
}): Promise<{ channelId: string; videoId: string; liveChatId: string }> {
  const request = async (resource: string, parameters: Record<string, string>) => {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`)
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
    const headers: Record<string, string> = {}
    if ('apiKey' in options.credentials) url.searchParams.set('key', options.credentials.apiKey)
    else headers.Authorization = `Bearer ${options.credentials.accessToken}`
    const response = await (options.fetcher ?? fetch)(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new YouTubeDiscoveryError(response.status)
    return parseDiscoveryResponse(await response.json())
  }
  let channelId = options.channelId.trim()
  if (!channelId) throw new Error('A YouTube channel is required.')
  if (/^uc[A-Za-z0-9_-]{22}$/i.test(channelId) && !channelId.startsWith('UC')) {
    throw new Error(
      'YouTube channel IDs are case-sensitive. Re-add this channel using its original UC… ID or @handle.',
    )
  }
  if (!channelId.startsWith('UC')) {
    const channels = await request('channels', {
      part: 'id',
      forHandle: channelId.replace(/^@/, ''),
    })
    const id = channels.items?.[0]?.id
    if (typeof id !== 'string')
      throw new Error('YouTube channel not found. Check the handle and reconnect manually.')
    channelId = id
  }
  let videoId = options.videoId
  if (!videoId) {
    const search = await request('search', {
      part: 'id',
      channelId,
      eventType: 'live',
      type: 'video',
      maxResults: '1',
    })
    const result = search.items?.[0]?.id
    videoId = typeof result === 'object' ? result.videoId : undefined
  }
  if (!videoId)
    throw new Error('No active YouTube broadcast. Reconnect manually when the stream starts.')
  const videos = await request('videos', { part: 'liveStreamingDetails,snippet', id: videoId })
  const video = videos.items?.[0]
  if (video?.snippet?.channelId && video.snippet.channelId !== channelId)
    throw new Error('YouTube video belongs to another channel.')
  const liveChatId = video?.liveStreamingDetails?.activeLiveChatId
  if (!liveChatId)
    throw new Error(
      'YouTube live chat has ended or is disabled. Reconnect manually for a new broadcast.',
    )
  return { channelId, videoId, liveChatId }
}
