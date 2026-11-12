import type { EmoteCatalogEntry, EmoteSource } from '@twirchat/shared/protocol'

import { t } from '../../../gpuix/i18n'
import { emoteProvider } from '../../../services/provider-emotes'
import { fuzzyFilter } from './fuzzyFilter'

const EMOTE_SOURCES: EmoteSource[] = [
  'channel',
  'global',
  'seventv',
  'ffz',
  'bttv',
  'collectibles',
  'personal',
]

const ALWAYS_VISIBLE = new Set<EmoteSource>(['global', 'seventv', 'ffz', 'bttv'])

const PROVIDER_LABELS: Partial<Record<EmoteSource, string>> = {
  seventv: '7TV',
  bttv: 'BTTV',
  ffz: 'FFZ',
}

function sourceLabel(source: EmoteSource): string {
  switch (source) {
    case 'channel':
      return t('composer.emotes.channel')
    case 'global':
      return t('composer.emotes.global')
    case 'collectibles':
      return t('composer.emotes.collectibles')
    case 'personal':
      return t('composer.emotes.personal')
    default:
      return PROVIDER_LABELS[source] ?? source
  }
}

export interface EmoteGroup {
  source: EmoteSource
  label: string
  entries: EmoteCatalogEntry[]
}

export function filterEmoteEntries(
  entries: EmoteCatalogEntry[],
  query: string,
): EmoteCatalogEntry[] {
  if (!query) return entries
  return fuzzyFilter(
    entries.map((entry) => ({ entry, label: entry.alias })),
    query,
  ).map(({ entry }) => entry)
}

function accessKey(
  emote: Pick<EmoteCatalogEntry, 'id' | 'source' | 'provider' | 'imageUrl'>,
): string {
  return `${emoteProvider(emote)}:${emote.id}`
}

/**
 * Favorite copies are stored without access state, so reflect the live
 * channel catalog's lock instead of trusting the saved entry.
 */
export function applyLiveEmoteLocks(
  entries: EmoteCatalogEntry[],
  catalog: readonly EmoteCatalogEntry[],
): EmoteCatalogEntry[] {
  const locked = new Set(catalog.filter((entry) => entry.locked).map((entry) => accessKey(entry)))
  if (!locked.size) return entries
  return entries.map((entry) => (locked.has(accessKey(entry)) ? { ...entry, locked: true } : entry))
}

export function groupEmoteCatalog(entries: EmoteCatalogEntry[]): EmoteGroup[] {
  const groups: Record<EmoteSource, EmoteCatalogEntry[]> = {
    channel: [],
    global: [],
    seventv: [],
    ffz: [],
    bttv: [],
    collectibles: [],
    personal: [],
  }
  for (const entry of entries) {
    const { source } = entry
    if (source === 'collectibles' || source === 'personal') {
      groups[source].push(entry)
      continue
    }
    if (source === 'channel' || source === 'global') groups[source].push(entry)
    const provider = emoteProvider(entry)
    if (provider !== 'twitch') groups[provider].push(entry)
  }
  return EMOTE_SOURCES.filter(
    (source) => ALWAYS_VISIBLE.has(source) || groups[source].length > 0,
  ).map((source) => ({ source, label: sourceLabel(source), entries: groups[source] }))
}
