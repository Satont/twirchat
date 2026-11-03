import { createHash } from 'node:crypto'

import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import { z } from 'zod'

import { fetchTwitchHelixWithAppToken } from './stream-status'

export class EmoteCatalogError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

interface Dependencies {
  fetch(url: string, init?: RequestInit): Promise<Response>
  appFetch(url: string): Promise<Response>
}
const rowSchema = z.record(z.string(), z.unknown())
type Row = z.infer<typeof rowSchema>
const row = (value: unknown): Row => rowSchema.safeParse(value).data ?? {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const string = (value: unknown): string => (typeof value === 'string' ? value : '')

export function parseTwitchEmoteCatalog(
  value: unknown,
  source: EmoteCatalogEntry['source'],
  channelId?: string,
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
      },
    ]
  })
}

export function createEmoteCatalogService(
  dependencies: Dependencies = {
    fetch: (url, init) => fetch(url, init),
    appFetch: fetchTwitchHelixWithAppToken,
  },
) {
  const catalogs = new Map<string, { expires: number; emotes: EmoteCatalogEntry[] }>()
  const pending = new Map<string, Promise<EmoteCatalogEntry[]>>()
  const forcedPending = new Set<string>()
  const identities = new Map<
    string,
    { expires: number; clientId: string; userId: string; scopes: string[] }
  >()
  const parse = async (response: Response): Promise<Row> => {
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
  const get = (input: {
    channelSlug: string
    userAccessToken?: string
    force?: boolean
  }): Promise<EmoteCatalogEntry[]> => {
    const channel = input.channelSlug.trim().replace(/^#/, '').toLowerCase()
    if (channel && !/^[a-z0-9_]{1,30}$/.test(channel))
      return Promise.reject(new EmoteCatalogError('Enter a valid Twitch channel name or ID.'))
    const token = input.userAccessToken?.trim() ?? ''
    if (token.length > 4096)
      return Promise.reject(new EmoteCatalogError('Invalid Twitch access token.'))
    const tokenKey = token ? createHash('sha256').update(token).digest('hex') : 'anonymous'
    const cacheKey = `${tokenKey}:${channel}`
    const cached = catalogs.get(cacheKey)
    if (!input.force && cached && cached.expires > Date.now()) return Promise.resolve(cached.emotes)
    const inflight = pending.get(cacheKey)
    if (inflight)
      return input.force && !forcedPending.has(cacheKey)
        ? inflight.then(() => get(input))
        : inflight
    if (input.force) forcedPending.add(cacheKey)
    const task = (async () => {
      let identity = identities.get(tokenKey)
      if (token && (!identity || identity.expires <= Date.now())) {
        const validated = await parse(
          await dependencies.fetch('https://id.twitch.tv/oauth2/validate', {
            headers: { Authorization: `OAuth ${token}` },
            signal: AbortSignal.timeout(10_000),
          }),
        )
        const clientId = string(validated.client_id),
          userId = string(validated.user_id)
        if (!clientId || !userId)
          throw new EmoteCatalogError('A valid Twitch user token is required.', 401)
        identity = {
          clientId,
          userId,
          scopes: list(validated.scopes).filter(
            (scope): scope is string => typeof scope === 'string',
          ),
          expires: Date.now() + 120_000,
        }
        identities.set(tokenKey, identity)
        while (identities.size > 100) {
          const oldest = identities.keys().next()
          if (oldest.done) break
          identities.delete(oldest.value)
        }
      }
      const request = async (path: string, params?: Record<string, string>): Promise<Row> => {
        const url = new URL(`https://api.twitch.tv/helix/${path}`)
        for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
        const response =
          token && identity
            ? await dependencies.fetch(url.toString(), {
                headers: { Authorization: `Bearer ${token}`, 'Client-Id': identity.clientId },
                signal: AbortSignal.timeout(12_000),
              })
            : await dependencies.appFetch(url.toString())
        return parse(response)
      }
      let channelId = /^\d+$/.test(channel) ? channel : ''
      if (channel && !channelId)
        channelId = string(row(list((await request('users', { login: channel })).data)[0]).id)
      if (channel && !channelId) throw new EmoteCatalogError('Twitch channel was not found.', 404)
      const userEmotes = async (): Promise<EmoteCatalogEntry[]> => {
        if (!identity?.scopes.includes('user:read:emotes')) return []
        const emotes: EmoteCatalogEntry[] = [],
          cursors = new Set<string>()
        let after = ''
        for (let page = 0; page < 100; page++) {
          // Twitch cursors must be traversed serially.
          // eslint-disable-next-line no-await-in-loop
          const body = await request('chat/emotes/user', {
            user_id: identity.userId,
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
      const [globals, local, user] = await Promise.all([
        request('chat/emotes/global').then((body) => parseTwitchEmoteCatalog(body, 'global')),
        channelId
          ? request('chat/emotes', { broadcaster_id: channelId }).then((body) =>
              parseTwitchEmoteCatalog(body, 'channel'),
            )
          : Promise.resolve([]),
        userEmotes(),
      ])
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
  const channelIdentities = new Map<
    string,
    { value: { platformUserId: string; login: string }; expires: number }
  >()
  const identityPending = new Map<string, Promise<{ platformUserId: string; login: string }>>()
  const resolveChannel = (channel: string): Promise<{ platformUserId: string; login: string }> => {
    const slug = channel.trim().replace(/^#/, '').toLowerCase()
    if (!/^[a-z0-9_]{1,25}$/.test(slug))
      return Promise.reject(new EmoteCatalogError('Invalid Twitch channel.'))
    const cached = channelIdentities.get(slug)
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value)
    const inflight = identityPending.get(slug)
    if (inflight) return inflight
    if (identityPending.size >= 100)
      return Promise.reject(new EmoteCatalogError('Too many pending Twitch channel lookups.', 429))
    const task = (async () => {
      const body = await parse(
        await dependencies.appFetch(
          `https://api.twitch.tv/helix/users?${/^\d+$/.test(slug) ? 'id' : 'login'}=${encodeURIComponent(slug)}`,
        ),
      )
      const user = row(list(body.data)[0])
      const value = { platformUserId: string(user.id), login: string(user.login) }
      if (!value.platformUserId || !value.login)
        throw new EmoteCatalogError('Twitch channel not found.', 404)
      const entry = { value, expires: Date.now() + 3600000 }
      channelIdentities.set(slug, entry)
      channelIdentities.set(value.platformUserId, entry)
      channelIdentities.set(value.login, entry)
      while (channelIdentities.size > 500) {
        const oldest = channelIdentities.keys().next()
        if (oldest.done) break
        channelIdentities.delete(oldest.value)
      }
      return value
    })().finally(() => identityPending.delete(slug))
    identityPending.set(slug, task)
    return task
  }
  return { getTwitchEmotes: get, resolveTwitchChannel: resolveChannel }
}
