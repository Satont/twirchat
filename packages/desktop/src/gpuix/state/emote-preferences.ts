import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import type { Emote, Platform } from '@twirchat/shared/types'

import { validateEmotePreferences, favoriteEmoteKey } from '../../services/emote-preferences'
import { DEFAULT_EMOTE_PREFERENCES, emoteProvider } from '../../services/provider-emotes'
import { persistentResource } from './persistent-resources'
import type { PreferenceStore } from './preferences'
export { validateEmotePreferences, favoriteEmoteKey } from '../../services/emote-preferences'
import { createPreferenceStore, type PreferenceApi } from './preferences'

export const emotePreferences = persistentResource('preference:emote_preferences_v1', () =>
  createPreferenceStore(
    'emote_preferences_v1',
    DEFAULT_EMOTE_PREFERENCES,
    validateEmotePreferences,
  ),
)
export const emotePreferencesStore = emotePreferences.store
export const loadEmotePreferences = emotePreferences.load
export const saveEmotePreferences = emotePreferences.save

export function favoriteEntry(emote: Emote): EmoteCatalogEntry {
  const entry: EmoteCatalogEntry = {
    id: emote.id,
    alias: emote.name,
    name: emote.name,
    imageUrl: emote.imageUrl,
    source: emote.source ?? 'channel',
    provider: emote.provider,
    animated: emote.animated ?? false,
    zeroWidth: emote.zeroWidth ?? false,
    modifier: emote.modifier,
    aspectRatio: emote.aspectRatio ?? 1,
  }
  return { ...entry, provider: emoteProvider(entry) }
}

export async function toggleFavoriteEmote(
  api: PreferenceApi,
  emote: EmoteCatalogEntry,
): Promise<void> {
  await loadEmotePreferences(api)
  const current = emotePreferencesStore.get().value
  const key = favoriteEmoteKey(emote)
  const exists = current.favorites.some((favorite) => favoriteEmoteKey(favorite) === key)
  const favorites = exists
    ? current.favorites.filter((favorite) => favoriteEmoteKey(favorite) !== key)
    : [...current.favorites, emote]
  await saveEmotePreferences(api, { ...current, favorites })
}

export function platformSupportsPersonalEmotes(platform: Platform): boolean {
  return platform !== 'youtube'
}

declare module './persistent-resources' {
  interface PersistentResources {
    'preference:emote_preferences_v1': PreferenceStore<typeof DEFAULT_EMOTE_PREFERENCES>
  }
}
