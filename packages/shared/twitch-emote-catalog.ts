import type { EmoteCatalogEntry } from './protocol'

export class EmoteCatalogError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

type CatalogSource =
  | { kind: 'app'; fetch(path: string): Promise<Response> }
  | { kind: 'user'; fetch(path: string): Promise<Response>; cacheKey: string; userId: string }

type Row = Record<string, unknown>
function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function row(value: unknown): Row {
  return isRow(value) ? value : {}
}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const string = (value: unknown): string => (typeof value === 'string' ? value : '')

export function parseTwitchEmoteCatalog(
  value: unknown,
  source: EmoteCatalogEntry['source'],
  channelId?: string,
  /**
   * Emote IDs the signed-in user can use. When provided, restricted channel
   * emotes outside the set are marked locked; omit while access is unknown.
   */
  availableEmoteIds?: ReadonlySet<string>,
): EmoteCatalogEntry[] {
  const body = row(value),
    template = string(body.template)
  return list(body.data).flatMap((item) => {
    const emote = row(item),
      id = string(emote.id),
      name = string(emote.name)
    if (!id || !name) return []
    const formats = list(emote.format),
      scales = list(emote.scale),
      themes = list(emote.theme_mode)
    const animated = formats.includes('animated')
    const locked =
      source === 'channel' &&
      string(emote.emote_type) === 'subscriptions' &&
      availableEmoteIds !== undefined &&
      !availableEmoteIds.has(id)
    const replacements: Record<string, string> = {
      id,
      format: animated ? 'animated' : 'static',
      scale: scales.includes('3.0') ? '3.0' : string(scales.at(-1)) || '1.0',
      theme_mode: themes.includes('dark') ? 'dark' : string(themes[0]) || 'dark',
    }
    const images = row(emote.images)
    const imageUrl = template
      ? template.replace(/\{\{(id|format|scale|theme_mode)\}\}/g, (_match, key: string) =>
          encodeURIComponent(replacements[key] ?? ''),
        )
      : string(images.image_url_4x ?? images.image_url_2x ?? images.image_url_1x)
    if (!/^https:\/\//i.test(imageUrl)) return []
    let group = source
    if (source === 'collectibles') {
      if (['globals', 'smilies'].includes(string(emote.emote_type))) group = 'global'
      else if (channelId && emote.owner_id === channelId) group = 'channel'
    }
    return [
      {
        id,
        alias: name,
        name,
        imageUrl,
        provider: 'twitch',
        source: group,
        animated,
        zeroWidth: false,
        aspectRatio: 1,
        ...(locked ? { locked: true } : {}),
      },
    ]
  })
}

export async function parseTwitchEmoteResponse(response: Response): Promise<Row> {
  if (!response.ok)
    throw new EmoteCatalogError(
      `Twitch emotes: HTTP ${response.status}.`,
      response.status === 401 || response.status === 403 ? response.status : 502,
    )
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 4_000_000)
    throw new EmoteCatalogError('Twitch emote response is too large.', 502)
  try {
    return row(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    throw new EmoteCatalogError('Twitch returned an invalid emote response.', 502)
  }
}

export function createTwitchEmoteCatalog() {
  const catalogs = new Map<string, { expires: number; emotes: EmoteCatalogEntry[] }>()
  const pending = new Map<string, Promise<EmoteCatalogEntry[]>>()
  const forcedPending = new Set<string>()
  const get = (input: {
    channelSlug: string
    source: CatalogSource
    force?: boolean
  }): Promise<EmoteCatalogEntry[]> => {
    const channel = input.channelSlug.trim().replace(/^#/, '').toLowerCase()
    if (channel && !/^[a-z0-9_]{1,30}$/.test(channel))
      return Promise.reject(new EmoteCatalogError('Enter a valid Twitch channel name or ID.'))
    const { source } = input
    const cacheKey = `${source.kind === 'user' ? source.cacheKey : 'anonymous'}:${channel}`
    const cached = catalogs.get(cacheKey)
    if (!input.force && cached && cached.expires > Date.now()) return Promise.resolve(cached.emotes)
    const inflight = pending.get(cacheKey)
    if (inflight)
      return input.force && !forcedPending.has(cacheKey)
        ? inflight.then(() => get(input))
        : inflight
    if (input.force) forcedPending.add(cacheKey)
    const request = async (path: string, params?: Record<string, string>): Promise<Row> => {
      const query = params ? `?${new URLSearchParams(params)}` : ''
      const response = await source.fetch(`${path}${query}`)
      return parseTwitchEmoteResponse(response)
    }
    const task = (async () => {
      let channelId = /^\d+$/.test(channel) ? channel : ''
      if (channel && !channelId)
        channelId = string(row(list((await request('users', { login: channel })).data)[0]).id)
      if (channel && !channelId) throw new EmoteCatalogError('Twitch channel was not found.', 404)
      const userEmotes = async (): Promise<EmoteCatalogEntry[]> => {
        if (source.kind !== 'user') return []
        const emotes: EmoteCatalogEntry[] = [],
          cursors = new Set<string>()
        let after = ''
        for (let page = 0; page < 100; page++) {
          // Twitch cursors must be traversed serially.
          // eslint-disable-next-line no-await-in-loop
          const body = await request('chat/emotes/user', {
            user_id: source.userId,
            ...(channelId ? { broadcaster_id: channelId } : {}),
            ...(after ? { after } : {}),
          })
          emotes.push(...parseTwitchEmoteCatalog(body, 'collectibles', channelId))
          after = string(row(body.pagination).cursor)
          if (!after) return emotes
          if (cursors.has(after))
            throw new EmoteCatalogError('Twitch repeated an emote page cursor.', 502)
          cursors.add(after)
          if (emotes.length > 20_000)
            throw new EmoteCatalogError('Twitch user emote catalog is too large.', 502)
        }
        throw new EmoteCatalogError('Twitch emote pagination did not finish.', 502)
      }
      const [globalBody, localBody, user] = await Promise.all([
        request('chat/emotes/global'),
        channelId
          ? request('chat/emotes', { broadcaster_id: channelId })
          : Promise.resolve(undefined),
        userEmotes(),
      ])
      const availableEmoteIds =
        source.kind === 'user' && source.userId !== channelId
          ? new Set(user.map((emote) => emote.id))
          : undefined
      const local = localBody
        ? parseTwitchEmoteCatalog(localBody, 'channel', channelId, availableEmoteIds)
        : []
      const globals = parseTwitchEmoteCatalog(globalBody, 'global')
      const aliases = new Map<string, EmoteCatalogEntry>()
      for (const emote of [...user, ...local, ...globals])
        if (!aliases.has(emote.alias)) aliases.set(emote.alias, emote)
      const emotes = [...aliases.values()]
      catalogs.set(cacheKey, { emotes, expires: Date.now() + 300_000 })
      while (catalogs.size > 100) {
        const oldest = catalogs.keys().next()
        if (oldest.done) break
        catalogs.delete(oldest.value)
      }
      return emotes
    })().finally(() => {
      pending.delete(cacheKey)
      forcedPending.delete(cacheKey)
    })
    pending.set(cacheKey, task)
    return task
  }
  return get
}
