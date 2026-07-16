import type { EmoteCatalogEntry, EmoteSource } from '@twirchat/shared/protocol'
import { fuzzyFilter } from './fuzzyFilter'

const EMOTE_SOURCES: EmoteSource[] = ['channel', 'seventv', 'collectibles', 'global']

const SOURCE_LABELS: Record<EmoteSource, string> = {
  channel: 'Channel',
  seventv: '7TV',
  collectibles: 'Collectibles',
  global: 'Global',
}

export interface EmoteGroup {
  source: EmoteSource
  label: string
  entries: EmoteCatalogEntry[]
}

function filterEntries(entries: EmoteCatalogEntry[], query: string): EmoteCatalogEntry[] {
  return fuzzyFilter(
    entries.map((entry) => ({ entry, label: entry.alias })),
    query,
  ).map(({ entry }) => entry)
}

export function groupEmoteCatalog(entries: EmoteCatalogEntry[], query: string): EmoteGroup[] {
  return EMOTE_SOURCES.map((source) => ({
    source,
    label: SOURCE_LABELS[source],
    entries: filterEntries(
      entries.filter((entry) => entry.source === source),
      query,
    ),
  })).filter((group) => group.entries.length > 0)
}
