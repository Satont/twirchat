import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import { z } from 'zod'

import { COMMUNITY_BADGE_PROVIDERS } from './community-badges'
import {
  DEFAULT_EMOTE_PREFERENCES,
  emoteProvider,
  type EmotePreferences,
  type EmoteProvider,
} from './provider-emotes'

const PROVIDERS: EmoteProvider[] = ['twitch', 'seventv', 'bttv', 'ffz']

export function validateEmotePreferences(value: unknown): EmotePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid emote preferences.')
  const input = z
    .object({
      enabled: z.record(z.string(), z.boolean()).optional(),
      precedence: z.array(z.enum(['twitch', 'seventv', 'bttv', 'ffz'])).optional(),
      zeroWidth: z.boolean().optional(),
      modifiers: z.boolean().optional(),
      badges: z.boolean().optional(),
      paints: z.boolean().optional(),
      communityBadges: z.record(z.string(), z.boolean()).optional(),
      personal: z.boolean().optional(),
      sendPresence: z.boolean().optional(),
      emojiCompletion: z.boolean().optional(),
      favorites: z.array(z.unknown()).optional(),
    })
    .parse(value)
  const preferences = structuredClone(DEFAULT_EMOTE_PREFERENCES)
  if (input.enabled !== undefined) {
    if (!input.enabled || typeof input.enabled !== 'object' || Array.isArray(input.enabled))
      throw new Error('Invalid emote providers.')
    for (const provider of PROVIDERS) {
      const enabled = input.enabled[provider]
      if (enabled !== undefined && typeof enabled !== 'boolean')
        throw new Error(`Invalid ${provider} preference.`)
      if (typeof enabled === 'boolean') preferences.enabled[provider] = enabled
    }
  }
  if (input.communityBadges !== undefined) {
    for (const provider of COMMUNITY_BADGE_PROVIDERS) {
      const enabled = input.communityBadges[provider]
      if (enabled !== undefined) preferences.communityBadges[provider] = enabled
    }
  }
  if (input.precedence !== undefined) {
    if (
      !Array.isArray(input.precedence) ||
      input.precedence.length !== PROVIDERS.length ||
      new Set(input.precedence).size !== PROVIDERS.length ||
      !input.precedence.every((provider) => PROVIDERS.includes(provider))
    )
      throw new Error('Provider precedence must contain every provider exactly once.')
    preferences.precedence = input.precedence
  }
  for (const key of [
    'zeroWidth',
    'modifiers',
    'badges',
    'paints',
    'personal',
    'sendPresence',
    'emojiCompletion',
  ] satisfies (keyof Pick<
    EmotePreferences,
    | 'zeroWidth'
    | 'modifiers'
    | 'badges'
    | 'paints'
    | 'personal'
    | 'sendPresence'
    | 'emojiCompletion'
  >)[]) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean')
      throw new Error(`Invalid ${key} preference.`)
    if (typeof input[key] === 'boolean') preferences[key] = input[key]
  }
  if (input.favorites !== undefined) {
    if (!Array.isArray(input.favorites) || input.favorites.length > 250)
      throw new Error('Save at most 250 favorite emotes.')
    const seen = new Set<string>()
    preferences.favorites = input.favorites.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid favorite emote.')
      const emote = z
        .object({
          id: z.string(),
          alias: z.string(),
          imageUrl: z.string(),
          name: z.string().optional(),
          source: z.enum([
            'channel',
            'global',
            'seventv',
            'bttv',
            'ffz',
            'personal',
            'collectibles',
          ]),
          provider: z.enum(['twitch', 'seventv', 'bttv', 'ffz']).optional(),
          animated: z.boolean().optional(),
          zeroWidth: z.boolean().optional(),
          modifier: z.boolean().optional(),
          aspectRatio: z.number().optional(),
        })
        .parse(item)
      if (
        typeof emote.id !== 'string' ||
        !emote.id ||
        emote.id.length > 100 ||
        typeof emote.alias !== 'string' ||
        !emote.alias ||
        emote.alias.length > 100 ||
        typeof emote.imageUrl !== 'string' ||
        emote.imageUrl.length > 2048 ||
        !/^https?:\/\//i.test(emote.imageUrl) ||
        !['channel', 'global', 'seventv', 'bttv', 'ffz', 'personal', 'collectibles'].includes(
          String(emote.source),
        )
      )
        throw new Error('Invalid favorite emote data.')
      if (emote.provider !== undefined && !PROVIDERS.includes(emote.provider))
        throw new Error('Invalid favorite provider.')
      const entry: EmoteCatalogEntry = {
        id: emote.id,
        alias: emote.alias,
        name: typeof emote.name === 'string' ? emote.name.slice(0, 100) : emote.alias,
        imageUrl: emote.imageUrl,
        source: emote.source,
        provider: emote.provider,
        animated: emote.animated === true,
        zeroWidth: emote.zeroWidth === true,
        modifier: emote.modifier === true,
        aspectRatio:
          typeof emote.aspectRatio === 'number' && Number.isFinite(emote.aspectRatio)
            ? Math.max(0.1, Math.min(10, emote.aspectRatio))
            : 1,
      }
      const key = favoriteEmoteKey(entry)
      if (seen.has(key)) throw new Error('A favorite emote is listed more than once.')
      seen.add(key)
      return entry
    })
  }
  return preferences
}

export function favoriteEmoteKey(
  emote: Pick<EmoteCatalogEntry, 'id' | 'alias' | 'source' | 'provider' | 'imageUrl'>,
): string {
  return `${emoteProvider(emote)}:${emote.id}:${emote.alias}`
}
