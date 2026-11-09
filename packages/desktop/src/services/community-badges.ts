import { providerImageSource } from '@twirchat/shared/emote-proxy'
import type { Badge, Platform } from '@twirchat/shared/types'
import { z } from 'zod'

export type CommunityBadgeProvider = 'ffzap' | 'dankchat' | 'chatsen' | 'homies' | 'twir'
export const COMMUNITY_BADGE_PROVIDERS: readonly CommunityBadgeProvider[] = [
  'ffzap',
  'dankchat',
  'chatsen',
  'homies',
  'twir',
]
export type CommunityBadgePreferences = Record<CommunityBadgeProvider, boolean>
export interface CommunityBadgeSelection {
  badges: boolean
  communityBadges: CommunityBadgePreferences
}
export const DEFAULT_COMMUNITY_BADGE_PREFERENCES: CommunityBadgePreferences = {
  ffzap: true,
  dankchat: true,
  chatsen: true,
  homies: true,
  twir: true,
}

type BadgeIndex = ReadonlyMap<string, readonly Badge[]>
type MutableBadgeIndex = Map<string, Badge[]>
type BadgeIndexCache = WeakMap<object, BadgeIndex>
type BadgeIndexParser = (value: unknown) => BadgeIndex
type CommunityBadgeRequest = (url: string, ttl?: number) => Promise<unknown>
interface ChatsenDefinition {
  badge: Badge
  priority: number
}

const EMPTY_INDEX: BadgeIndex = new Map()
const MAX_CATALOG_ENTRIES = 50_000
const MAX_ASSIGNMENTS = 200_000
const FFZAP_HELPERS = new Set(['11819690', '36442149', '29519423', '22025290', '4867723'])
const CHATSEN_PRIORITIES = new Map(
  [
    'developer',
    'early_supporter',
    'performance_artist',
    'early_bird',
    'relaxo',
    'patreon_tier4',
    'patreon_tier3s',
    'patreon_tier3',
    'patreon_tier2s',
    'patreon_tier2',
    'patreon_tier1s',
    'patreon_tier1',
  ].map((name, priority) => [name, priority]),
)

const rowSchema = z.record(z.string(), z.unknown())
const row = (value: unknown): Record<string, unknown> => rowSchema.safeParse(value).data ?? {}
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const string = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
const text = (value: unknown, fallback = ''): string =>
  (string(value).trim() || fallback).slice(0, 256)
const twitchId = (value: unknown): string => {
  const id = string(value).trim()
  return /^\d{1,20}$/.test(id) ? id : ''
}
const badgeId = (value: unknown): string => {
  const id = string(value).trim()
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : ''
}
const image = (value: unknown): string | undefined => providerImageSource(string(value))?.href

function put(index: MutableBadgeIndex, userId: string, badge: Badge, multiple = false): void {
  if (!multiple) {
    index.set(userId, [badge])
    return
  }
  const existing = index.get(userId)
  if (!existing) {
    index.set(userId, [badge])
    return
  }
  if (!existing.some((entry) => entry.id === badge.id)) existing.push(badge)
}

export function indexFfzApBadges(value: unknown): BadgeIndex {
  const index: MutableBadgeIndex = new Map()
  for (const item of array(value).slice(0, MAX_CATALOG_ENTRIES)) {
    const entry = row(item)
    const userId = twitchId(entry.id)
    if (!userId) continue
    const imageUrl = image(`https://api.ffzap.com/v1/user/badge/${userId}/3`)
    if (!imageUrl) continue
    put(index, userId, {
      id: `ffzap:${userId}`,
      type: 'ffzap',
      text:
        userId === '26964566'
          ? 'FFZ:AP Developer'
          : FFZAP_HELPERS.has(userId)
            ? 'FFZ:AP Helper'
            : 'FFZ:AP Supporter',
      imageUrl,
    })
  }
  return index
}

export function indexDankChatBadges(value: unknown): BadgeIndex {
  const index: MutableBadgeIndex = new Map()
  for (const item of array(value).slice(0, MAX_CATALOG_ENTRIES)) {
    const entry = row(item)
    const name = text(entry.type)
    const imageUrl = image(entry.url)
    if (!name || name === 'DankChat Top Supporter' || !imageUrl) continue
    for (const user of array(entry.users).slice(0, MAX_ASSIGNMENTS)) {
      const userId = twitchId(user)
      // Leafyrino's unordered first-wins is nondeterministic; payload order is stable here.
      if (userId && !index.has(userId))
        put(index, userId, {
          id: `dankchat:${badgeId(name) || name.slice(0, 128)}`,
          type: 'dankchat',
          text: name,
          imageUrl,
        })
    }
  }
  return index
}

export function indexChatsenBadges(value: unknown): BadgeIndex {
  const root = row(value)
  const definitions = new Map<string, ChatsenDefinition>()
  for (const item of array(root.badges).slice(0, MAX_CATALOG_ENTRIES)) {
    const entry = row(item)
    const name = badgeId(entry.name)
    const imageUrl = image(entry.image)
    if (!name || !imageUrl) continue
    const description = text(entry.description)
    definitions.set(name, {
      badge: {
        id: `chatsen:${name}`,
        type: 'chatsen',
        text: text(entry.title, name),
        ...(description ? { description } : {}),
        imageUrl,
      },
      priority: CHATSEN_PRIORITIES.get(name) ?? 999,
    })
  }
  const index: MutableBadgeIndex = new Map()
  for (const item of array(root.users).slice(0, MAX_CATALOG_ENTRIES)) {
    const entry = row(item)
    const userId = twitchId(entry.id)
    if (!userId) continue
    let selected: ChatsenDefinition | undefined
    for (const assignment of array(entry.badges).slice(0, 128)) {
      const definition = definitions.get(badgeId(row(assignment).badgeName))
      if (definition && (!selected || definition.priority < selected.priority))
        selected = definition
    }
    if (selected) put(index, userId, selected.badge)
  }
  return index
}

export function indexHomiesCustomBadges(value: unknown): BadgeIndex {
  const entries = Array.isArray(value) ? value : array(row(value).badges)
  const index: MutableBadgeIndex = new Map()
  for (const item of entries.slice(0, 20_000)) {
    const entry = row(item)
    const userId = twitchId(entry.userId)
    const imageUrl = image(entry.image3) ?? image(entry.image2) ?? image(entry.image1)
    if (!userId || !imageUrl) continue
    const id = badgeId(entry.badgeId) || userId
    // Match Leafyrino's last-wins behavior if a user has duplicate custom entries.
    put(index, userId, {
      id: `homies-custom:${id}`,
      type: 'homies',
      text: text(entry.tooltip, 'Homies Custom Badge'),
      imageUrl,
    })
  }
  return index
}

export function indexTwirBadges(value: unknown): BadgeIndex {
  const index: MutableBadgeIndex = new Map()
  for (const item of array(value).slice(0, MAX_CATALOG_ENTRIES)) {
    const entry = row(item)
    const id = badgeId(entry.id)
    const name = text(entry.name, 'Twir Badge')
    const imageUrl = image(entry.url)
    if (!id || !imageUrl) continue
    for (const user of array(entry.users).slice(0, MAX_ASSIGNMENTS)) {
      const userId = twitchId(user)
      if (userId) put(index, userId, { id: `twir:${id}`, type: 'twir', text: name, imageUrl }, true)
    }
  }
  return index
}

function cachedIndex(value: unknown, cache: BadgeIndexCache, parse: BadgeIndexParser): BadgeIndex {
  if (!value || typeof value !== 'object') return EMPTY_INDEX
  const existing = cache.get(value)
  if (existing) return existing
  const parsed = parse(value)
  cache.set(value, parsed)
  return parsed
}

export function createCommunityBadgeService(request: CommunityBadgeRequest) {
  const caches = {
    ffzap: new WeakMap<object, BadgeIndex>(),
    dankchat: new WeakMap<object, BadgeIndex>(),
    chatsen: new WeakMap<object, BadgeIndex>(),
    homies: new WeakMap<object, BadgeIndex>(),
    twir: new WeakMap<object, BadgeIndex>(),
  }
  const load = (
    enabled: boolean,
    url: string,
    cache: BadgeIndexCache,
    parse: BadgeIndexParser,
  ): Promise<BadgeIndex> =>
    enabled
      ? request(url, 1_800_000)
          .then((value) => cachedIndex(value, cache, parse))
          .catch(() => EMPTY_INDEX)
      : Promise.resolve(EMPTY_INDEX)

  return {
    async getBadges(
      platform: Platform,
      userId: string,
      selection: CommunityBadgeSelection,
    ): Promise<Badge[]> {
      if (platform !== 'twitch' || !selection.badges || !twitchId(userId)) return []
      const enabled = selection.communityBadges
      const catalogs = await Promise.all([
        load(enabled.ffzap, 'https://api.ffzap.com/v1/supporters', caches.ffzap, indexFfzApBadges),
        load(
          enabled.dankchat,
          'https://flxrs.com/api/badges',
          caches.dankchat,
          indexDankChatBadges,
        ),
        load(
          enabled.chatsen,
          'https://raw.githubusercontent.com/chatsen/resources/master/assets/data.json',
          caches.chatsen,
          indexChatsenBadges,
        ),
        load(
          enabled.homies,
          'https://chatterinohomies.com/api/badges/list',
          caches.homies,
          indexHomiesCustomBadges,
        ),
        load(enabled.twir, 'https://twir.app/api/v1/public/badges', caches.twir, indexTwirBadges),
      ])
      const result: Badge[] = []
      for (const catalog of catalogs) result.push(...(catalog.get(userId) ?? []))
      return result
    },
  }
}
