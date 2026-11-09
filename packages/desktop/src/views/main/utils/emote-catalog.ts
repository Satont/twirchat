import type { EmoteCatalogEntry, EmoteSource } from '@twirchat/shared/protocol'

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

const SOURCE_LABELS: Record<EmoteSource, string> = {
  channel: 'Channel',
  seventv: '7TV',
  collectibles: 'Collectibles',
  global: 'Global',
  bttv: 'BTTV',
  ffz: 'FFZ',
  personal: 'Personal',
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
  ).map((source) => ({ source, label: SOURCE_LABELS[source], entries: groups[source] }))
}
