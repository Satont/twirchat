import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import type { Emote, NormalizedChatMessage } from '@twirchat/shared/types'

import { deleteOldestEntry } from './bounded-cache'

export type EmoteProvider = 'twitch' | 'seventv' | 'bttv' | 'ffz'
export interface EmotePreferences {
  enabled: Record<EmoteProvider, boolean>
  precedence: EmoteProvider[]
  zeroWidth: boolean
  modifiers: boolean
  badges: boolean
  paints: boolean
  personal: boolean
  sendPresence: boolean
  emojiCompletion: boolean
  favorites: EmoteCatalogEntry[]
}
export const DEFAULT_EMOTE_PREFERENCES: EmotePreferences = {
  enabled: { twitch: true, seventv: true, bttv: true, ffz: true },
  precedence: ['twitch', 'seventv', 'bttv', 'ffz'],
  zeroWidth: true,
  modifiers: true,
  badges: true,
  paints: true,
  personal: true,
  sendPresence: false,
  emojiCompletion: true,
  favorites: [],
}
export function emoteProvider(
  emote: Pick<EmoteCatalogEntry, 'source' | 'provider' | 'imageUrl'>,
): EmoteProvider {
  if (emote.provider) return emote.provider
  if (
    emote.source === 'seventv' ||
    emote.source === 'personal' ||
    /7tv\.|\/proxy\/7tv\//.test(emote.imageUrl)
  )
    return 'seventv'
  if (emote.source === 'bttv' || /betterttv\./.test(emote.imageUrl)) return 'bttv'
  if (emote.source === 'ffz' || /frankerfacez\./.test(emote.imageUrl)) return 'ffz'
  return 'twitch'
}

export function mergeProviderEmotes(
  catalogs: EmoteCatalogEntry[][],
  preferences = DEFAULT_EMOTE_PREFERENCES,
): EmoteCatalogEntry[] {
  const result = new Map<string, EmoteCatalogEntry>()
  for (const provider of preferences.precedence) {
    if (!preferences.enabled[provider]) continue
    // Within a provider, channel/personal aliases beat global aliases.
    const entries = catalogs
      .flat()
      .filter((emote) => emoteProvider(emote) === provider)
      .sort((a, b) => Number(a.source === 'global') - Number(b.source === 'global'))
    for (const emote of entries) {
      if (emote.source === 'personal' && !preferences.personal) continue
      if (!result.has(emote.alias) && (!emote.modifier || preferences.modifiers))
        result.set(emote.alias, {
          ...emote,
          provider,
          zeroWidth: preferences.zeroWidth && emote.zeroWidth,
        })
    }
  }
  return [...result.values()]
}

/** Match exact provider aliases against raw UTF-16 offsets before display cleanup. */
export function createProviderEmoteEnricher(
  catalog: EmoteCatalogEntry[],
  preferences = DEFAULT_EMOTE_PREFERENCES,
): (message: NormalizedChatMessage) => NormalizedChatMessage {
  const aliases = new Map(
    mergeProviderEmotes([catalog], preferences).map((emote) => [emote.alias, emote]),
  )
  return (message) => {
    const retained = message.emotes.flatMap((emote) => {
      const provider = emoteProvider({ ...emote, source: emote.source ?? 'channel' })
      if (!preferences.enabled[provider] || (emote.source === 'personal' && !preferences.personal))
        return []
      const positions = emote.positions.filter((position) => {
        const winner = aliases.get(message.text.slice(position.start, position.end + 1))
        return (
          !winner ||
          preferences.precedence.indexOf(provider) <=
            preferences.precedence.indexOf(emoteProvider(winner))
        )
      })
      if (!positions.length) return []
      return [{ ...emote, positions, zeroWidth: preferences.zeroWidth && emote.zeroWidth }]
    })
    const additions = new Map<string, Emote>()
    const occupied = retained.flatMap((emote) => emote.positions)
    for (const match of message.text.matchAll(/\S+/gu)) {
      const entry = aliases.get(match[0])
      if (!entry || entry.modifier) continue
      const start = match.index,
        end = start + match[0].length - 1
      if (occupied.some((position) => start <= position.end && end >= position.start)) continue
      const key = `${entry.provider}:${entry.id}:${entry.alias}`
      const existing = additions.get(key)
      const position = { start, end }
      if (existing) existing.positions.push(position)
      else
        additions.set(key, {
          id: entry.id,
          name: entry.alias,
          imageUrl: entry.imageUrl,
          aspectRatio: entry.aspectRatio,
          source: entry.source,
          provider: entry.provider,
          animated: entry.animated,
          zeroWidth: entry.zeroWidth,
          modifier: entry.modifier,
          positions: [position],
        })
    }
    const changed =
      additions.size > 0 ||
      retained.length !== message.emotes.length ||
      retained.some(
        (emote, index) =>
          emote.positions.length !== message.emotes[index]?.positions.length ||
          emote.zeroWidth !== message.emotes[index]?.zeroWidth,
      )
    return changed ? { ...message, emotes: [...retained, ...additions.values()] } : message
  }
}

const enrichers = new WeakMap<
  EmoteCatalogEntry[],
  Map<string, (message: NormalizedChatMessage) => NormalizedChatMessage>
>()
const authorCatalogs = new WeakMap<
  EmoteCatalogEntry[],
  { public: EmoteCatalogEntry[]; combined: WeakMap<EmoteCatalogEntry[], EmoteCatalogEntry[]> }
>()

/** Share the channel alias index across rows while keeping personal sets author-scoped. */
export function authorEmoteCatalog(
  channel: EmoteCatalogEntry[],
  personal: EmoteCatalogEntry[],
  isOwnAuthor: boolean,
): EmoteCatalogEntry[] {
  if (isOwnAuthor && !personal.length) return channel
  let cached = authorCatalogs.get(channel)
  if (!cached) {
    const publicCatalog = channel.some((emote) => emote.source === 'personal')
      ? channel.filter((emote) => emote.source !== 'personal')
      : channel
    cached = { public: publicCatalog, combined: new WeakMap() }
    authorCatalogs.set(channel, cached)
  }
  if (!personal.length) return cached.public
  let combined = cached.combined.get(personal)
  if (!combined) {
    combined = [...personal, ...cached.public]
    cached.combined.set(personal, combined)
  }
  return combined
}

export function enrichProviderEmotes(
  message: NormalizedChatMessage,
  catalog: EmoteCatalogEntry[],
  preferences = DEFAULT_EMOTE_PREFERENCES,
): NormalizedChatMessage {
  const signature = JSON.stringify([
    preferences.enabled,
    preferences.precedence,
    preferences.zeroWidth,
    preferences.modifiers,
    preferences.personal,
  ])
  let versions = enrichers.get(catalog)
  if (!versions) {
    versions = new Map()
    enrichers.set(catalog, versions)
  }
  let enrich = versions.get(signature)
  if (!enrich) {
    enrich = createProviderEmoteEnricher(catalog, preferences)
    versions.set(signature, enrich)
    if (versions.size > 4) deleteOldestEntry(versions)
  }
  return enrich(message)
}
