import { z } from 'zod'

import { deleteOldestEntry } from './bounded-cache'
import {
  DEFAULT_EMOTE_PREFERENCES,
  mergeProviderEmotes,
  type EmotePreferences,
} from './provider-emotes'
import { fetchProviderMetadata } from './provider-relay'
export {
  DEFAULT_EMOTE_PREFERENCES,
  emoteProvider,
  mergeProviderEmotes,
  enrichProviderEmotes,
  createProviderEmoteEnricher,
  type EmotePreferences,
  type EmoteProvider,
} from './provider-emotes'
import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import type { Badge, Platform } from '@twirchat/shared/types'

export type ProviderFetch = (url: string, init?: RequestInit) => Promise<Response>
const EMPTY_CACHED_CATALOG: EmoteCatalogEntry[] = []
const rowSchema = z.record(z.string(), z.unknown())
type Row = z.infer<typeof rowSchema>
const row = (value: unknown): Row => rowSchema.safeParse(value).data ?? {}
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const string = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
const https = (value: unknown): string => {
  const url = string(value)
  return url.startsWith('//') ? `https:${url}` : /^https?:\/\//i.test(url) ? url : ''
}
const ratio = (width: unknown, height: unknown): number =>
  typeof width === 'number' && typeof height === 'number' && height > 0
    ? Math.min(10, Math.max(0.1, width / height))
    : 1
const BTTV_OVERLAYS = new Set([
  'SoSnowy',
  'IceCold',
  'SantaHat',
  'TopHat',
  'ReinDeer',
  'CandyCane',
  'cvMask',
  'cvHazmat',
])

export function parseBttvEmotes(value: unknown, global = false): EmoteCatalogEntry[] {
  const root = row(value)
  return (
    Array.isArray(value) ? value : [...array(root.channelEmotes), ...array(root.sharedEmotes)]
  ).flatMap((item) => {
    const emote = row(item),
      id = string(emote.id),
      name = string(emote.code)
    return id && name
      ? [
          {
            id,
            alias: name,
            name,
            provider: 'bttv' satisfies NonNullable<EmoteCatalogEntry['provider']>,
            source: global
              ? ('global' satisfies EmoteCatalogEntry['source'])
              : ('bttv' satisfies NonNullable<EmoteCatalogEntry['provider']>),
            imageUrl: `https://cdn.betterttv.net/emote/${encodeURIComponent(id)}/3x.webp`,
            animated: emote.animated === true || emote.imageType === 'gif',
            zeroWidth: BTTV_OVERLAYS.has(name),
            modifier: emote.modifier === true,
            aspectRatio: ratio(emote.width, emote.height),
          },
        ]
      : []
  })
}

export function parseFfzEmotes(value: unknown, global = false): EmoteCatalogEntry[] {
  const root = row(value),
    defaults = new Set(array(root.default_sets).map(string))
  return Object.values(row(root.sets)).flatMap((set) => {
    const data = row(set)
    if (global && !defaults.has(string(data.id))) return []
    return array(data.emoticons).flatMap((item) => {
      const emote = row(item),
        id = string(emote.id),
        name = string(emote.name),
        animated = row(emote.animated)
      const urls = Object.keys(animated).length ? animated : row(emote.urls)
      const imageUrl = https(urls['4'] ?? urls['2'] ?? urls['1'])
      return id && name && imageUrl
        ? [
            {
              id,
              alias: name,
              name,
              provider: 'ffz' satisfies NonNullable<EmoteCatalogEntry['provider']>,
              source: global
                ? ('global' satisfies EmoteCatalogEntry['source'])
                : ('ffz' satisfies NonNullable<EmoteCatalogEntry['provider']>),
              imageUrl,
              animated: Object.keys(animated).length > 0,
              zeroWidth: emote.modifier === true,
              modifier: emote.modifier === true,
              aspectRatio: ratio(emote.width, emote.height),
            },
          ]
        : []
    })
  })
}

export function parseSevenTvEmotes(
  value: unknown,
  source: 'global' | 'seventv' | 'personal' = 'seventv',
): EmoteCatalogEntry[] {
  const root = row(value)
  return array(root.emotes).flatMap((item) => {
    const active = row(item),
      data = row(active.data),
      host = row(data.host)
    const files = array(host.files).map(row)
    const file =
      files.find((f) => f.name === '2x.webp') ?? files.find((f) => f.format === 'WEBP') ?? files[0]
    const id = string(active.id),
      alias = string(active.name),
      base = https(host.url)
    if (!id || !alias || !base || !file) return []
    return [
      {
        id,
        alias,
        name: string(data.name) || alias,
        provider: 'seventv' satisfies NonNullable<EmoteCatalogEntry['provider']>,
        source,
        imageUrl: `${base}/${string(file.name)}`,
        animated: data.animated === true,
        zeroWidth: (Number(active.flags) & 1) !== 0 || (Number(data.flags) & 256) !== 0,
        aspectRatio: ratio(file.width, file.height),
      },
    ]
  })
}

export interface ProviderEmoteOptions {
  twitchUserId?: string
  sevenTV?: EmoteCatalogEntry[]
  nativeEmotes?: EmoteCatalogEntry[]
  personalUserId?: string
  preferences?: EmotePreferences
}

export function createEmoteProviderService(fetcher: ProviderFetch = fetchProviderMetadata) {
  const cache = new Map<string, { value: unknown; expires: number }>()
  const pending = new Map<string, Promise<unknown>>()
  const errors = new Map<string, string>()
  const channels = new Map<string, EmoteCatalogEntry[]>()
  let active = 0
  const waiting: Array<() => void> = []
  const request = (url: string, ttl = 300_000): Promise<unknown> => {
    const existing = cache.get(url)
    if (existing && existing.expires > Date.now()) return Promise.resolve(existing.value)
    const inflight = pending.get(url)
    if (inflight) return inflight
    if (pending.size >= 500) return Promise.resolve(null)
    const task = (async () => {
      if (active >= 6) await new Promise<void>((resolve) => waiting.push(resolve))
      else active++
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(12_000) })
        if (response.status === 404) {
          cache.set(url, { value: null, expires: Date.now() + ttl })
          return null
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (Number(response.headers.get('content-length')) > 8_000_000)
          throw new Error('Provider response is too large')
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength > 8_000_000) throw new Error('Provider response is too large')
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
        cache.delete(url)
        cache.set(url, { value, expires: Date.now() + ttl })
        while (cache.size > 250) deleteOldestEntry(cache)
        errors.delete(url)
        return value
      } catch (error) {
        errors.set(url, error instanceof Error ? error.message : String(error))
        while (errors.size > 30) deleteOldestEntry(errors)
        if (existing) {
          cache.set(url, { value: existing.value, expires: Date.now() + 30_000 })
          return existing.value
        }
        cache.set(url, { value: null, expires: Date.now() + 30_000 })
        return null
      } finally {
        const next = waiting.shift()
        if (next) next()
        else active--
        while (cache.size > 250) deleteOldestEntry(cache)
      }
    })().finally(() => pending.delete(url))
    pending.set(url, task)
    return task
  }
  const personal = async (platform: Platform, userId: string): Promise<EmoteCatalogEntry[]> => {
    if (platform === 'youtube' || !userId) return []
    const connection = row(
      await request(`https://7tv.io/v3/users/${platform}/${encodeURIComponent(userId)}`),
    )
    const set = array(row(connection.user).emote_sets)
      .map(row)
      .find((entry) => (Number(entry.flags) & 4) !== 0)
    if (!set) return []
    return parseSevenTvEmotes(
      await request(`https://7tv.io/v3/emote-sets/${encodeURIComponent(string(set.id))}`),
      'personal',
    )
  }
  const personalSet = async (setId: string): Promise<EmoteCatalogEntry[]> => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(setId)) throw new Error('Invalid 7TV personal emote set.')
    return parseSevenTvEmotes(
      await request(`https://7tv.io/v3/emote-sets/${encodeURIComponent(setId)}`),
      'personal',
    )
  }
  const channelSevenTv = async (platform: Platform, id: string): Promise<EmoteCatalogEntry[]> => {
    if (platform === 'youtube' || !/^\d+$/.test(id)) return []
    const connection = row(
      await request(`https://7tv.io/v3/users/${platform}/${encodeURIComponent(id)}`),
    )
    return parseSevenTvEmotes(row(connection.emote_set))
  }
  const get = async (
    platform: Platform,
    channelId: string,
    options: ProviderEmoteOptions = {},
  ): Promise<EmoteCatalogEntry[]> => {
    channelId = channelId.replace(/^#/, '').toLowerCase()
    const preferences = options.preferences ?? DEFAULT_EMOTE_PREFERENCES
    const tasks: Array<Promise<EmoteCatalogEntry[]>> = []
    if (preferences.enabled.bttv) {
      tasks.push(
        request('https://api.betterttv.net/3/cached/emotes/global', 1_800_000).then((value) =>
          parseBttvEmotes(value, true),
        ),
      )
      const id = options.twitchUserId ?? (/^\d+$/.test(channelId) ? channelId : '')
      if (platform === 'twitch' && id)
        tasks.push(
          request(`https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(id)}`).then(
            (value) => parseBttvEmotes(value),
          ),
        )
    }
    if (preferences.enabled.ffz) {
      tasks.push(
        request('https://api.frankerfacez.com/v1/set/global', 1_800_000).then((value) =>
          parseFfzEmotes(value, true),
        ),
      )
      if (platform === 'twitch')
        tasks.push(
          request(
            `https://api.frankerfacez.com/v1/room/${/^\d+$/.test(channelId) ? 'id/' : ''}${encodeURIComponent(channelId.replace(/^#/, ''))}`,
          ).then((value) => parseFfzEmotes(value)),
        )
    }
    if (preferences.enabled.seventv) {
      tasks.push(
        request('https://7tv.io/v3/emote-sets/global', 1_800_000).then((value) =>
          parseSevenTvEmotes(value, 'global'),
        ),
      )
      if (options.sevenTV === undefined) {
        const id = options.twitchUserId ?? (/^\d+$/.test(channelId) ? channelId : '')
        if (id) tasks.push(channelSevenTv(platform, id))
      }
      if (preferences.personal && options.personalUserId)
        tasks.push(personal(platform, options.personalUserId))
    }
    const catalogs = await Promise.all(tasks)
    catalogs.push(
      options.nativeEmotes ?? [],
      (options.sevenTV ?? []).map((emote) => ({ ...emote, provider: 'seventv' })),
    )
    const merged = mergeProviderEmotes(catalogs, preferences)
    channels.set(`${platform}:${channelId}`, merged)
    if (options.twitchUserId) channels.set(`${platform}:${options.twitchUserId}`, merged)
    while (channels.size > 250) deleteOldestEntry(channels)
    return merged
  }
  const badges = async (
    platform: Platform,
    userId: string,
    username?: string,
  ): Promise<Badge[]> => {
    if (platform !== 'twitch') return []
    const [bttv, ffz] = await Promise.all([
      request('https://api.betterttv.net/3/cached/badges', 1_800_000),
      request('https://api.frankerfacez.com/v1/badges', 1_800_000),
    ])
    const result: Badge[] = array(bttv)
      .map(row)
      .filter((entry) => string(entry.providerId) === userId)
      .flatMap((entry) => {
        const badge = row(entry.badge),
          imageUrl = https(badge.svg)
        return imageUrl
          ? [
              {
                id: `bttv:${string(badge.type)}`,
                type: 'bttv',
                text: string(badge.description),
                imageUrl,
              },
            ]
          : []
      })
    const root = row(ffz),
      assignments = row(root.users)
    for (const item of array(root.badges)) {
      const badge = row(item)
      const assigned = array(assignments[string(badge.id)]).map(string)
      if (!assigned.some((id) => id === userId || id.toLowerCase() === username?.toLowerCase()))
        continue
      const urls = row(badge.urls),
        imageUrl = https(urls['4'] ?? urls['2'] ?? badge.image)
      if (imageUrl)
        result.push({
          id: `ffz:${string(badge.id)}`,
          type: 'ffz',
          text: string(badge.title),
          imageUrl,
        })
    }
    return result
  }
  const channelBadges = async (
    channelId: string,
  ): Promise<{ moderator?: Badge; vip?: Badge; users: Record<string, Badge[]> }> => {
    const [roomValue, badgeValue] = await Promise.all([
      request(
        `https://api.frankerfacez.com/v1/room/${/^\d+$/.test(channelId) ? 'id/' : ''}${encodeURIComponent(channelId.replace(/^#/, ''))}`,
      ),
      request('https://api.frankerfacez.com/v1/badges', 1_800_000),
    ])
    const roomData = row(row(roomValue).room)
    const badgeFor = (urls: unknown, role: string): Badge | undefined => {
      const data = row(urls),
        imageUrl = https(data['4'] ?? data['2'] ?? data['1'])
      return imageUrl
        ? {
            id: `ffz:${channelId}:${role}`,
            type: role,
            text: role === 'moderator' ? 'Moderator' : 'VIP',
            imageUrl,
          }
        : undefined
    }
    const definitions = new Map(
      array(row(badgeValue).badges).map((value) => {
        const badge = row(value)
        return [string(badge.id), badge] satisfies [string, Row]
      }),
    )
    const users: Record<string, Badge[]> = Object.create(null)
    for (const [badgeId, ids] of Object.entries(row(roomData.user_badge_ids))) {
      const badge = definitions.get(badgeId)
      if (!badge) continue
      const urls = row(badge.urls),
        imageUrl = https(urls['4'] ?? urls['2'] ?? badge.image)
      if (!imageUrl) continue
      for (const id of array(ids).map(string)) {
        users[id] ??= []
        users[id].push({ id: `ffz:${badgeId}`, type: 'ffz', text: string(badge.title), imageUrl })
      }
    }
    return {
      moderator: badgeFor(roomData.mod_urls, 'moderator'),
      vip: badgeFor(roomData.vip_badge, 'vip'),
      users,
    }
  }
  return {
    getProviderEmotes: get,
    getPersonalEmotes: personal,
    getPersonalEmoteSet: personalSet,
    getProviderBadges: badges,
    getChannelProviderBadges: channelBadges,
    getCachedProviderEmotes: (platform: Platform, channelId: string) =>
      channels.get(`${platform}:${channelId.replace(/^#/, '').toLowerCase()}`) ??
      EMPTY_CACHED_CATALOG,
    async invalidate() {
      await Promise.allSettled(pending.values())
      cache.clear()
      channels.clear()
      errors.clear()
    },
    errors: () => [...errors].map(([url, error]) => ({ url, error })),
  }
}

const service = createEmoteProviderService()
export const getProviderEmotes = service.getProviderEmotes
export const getPersonalEmotes = service.getPersonalEmotes
export const getPersonalEmoteSet = service.getPersonalEmoteSet
export const getProviderBadges = service.getProviderBadges
export const getChannelProviderBadges = service.getChannelProviderBadges
export const getProviderErrors = service.errors

export const getCachedProviderEmotes = service.getCachedProviderEmotes

export const invalidateProviderEmotes = service.invalidate
