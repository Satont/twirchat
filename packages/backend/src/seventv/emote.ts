import type { SevenTVEmote } from '@twirchat/shared/protocol'

import type { SevenTVGraphQLEmoteSet } from './client'
import type { SevenTVEventImageFile, SevenTVEventEmoteValue } from './event-schemas'

export function createSevenTvEmoteFromCatalogItem(
  item: SevenTVGraphQLEmoteSet['emotes']['items'][number],
): SevenTVEmote {
  return {
    alias: item.alias,
    animated: item.emote.flags.animated,
    aspectRatio: item.emote.aspectRatio,
    id: item.emote.id,
    imageUrl: selectPreferredSevenTvImageUrl(item.emote.images),
    name: item.emote.defaultName,
    zeroWidth: item.flags.zeroWidth,
  }
}

export function createSevenTvEmoteFromEventValue(value: SevenTVEventEmoteValue): SevenTVEmote {
  return {
    alias: value.name,
    animated: value.data.animated,
    aspectRatio: 1,
    id: value.id,
    imageUrl: selectPreferredSevenTvHostFile(value.data.host.url, value.data.host.files),
    name: value.name,
    zeroWidth: false,
  }
}

function selectPreferredSevenTvImageUrl(
  images: Array<{ url?: string | null }> | null | undefined,
): string {
  const preferred = findPreferredImage(images, ['.gif', '.webp', '.avif'])
  return preferred?.url ?? ''
}

export function selectPreferredSevenTvHostFile(
  hostUrl: string,
  files: SevenTVEventImageFile[] | null | undefined,
): string {
  const preferred = findPreferredImage(files, ['.gif', '.webp', '.avif'])
  const fileName = preferred?.name

  if (!hostUrl || !fileName) {
    return ''
  }

  return `https:${hostUrl}/${fileName}`
}

function findPreferredImage<T extends { url?: string | null; name?: string | null }>(
  images: Array<T> | null | undefined,
  extensions: string[],
): T | undefined {
  for (const extension of extensions) {
    const match = images?.find((image) => {
      const value = image.url ?? image.name ?? ''
      return value.toLowerCase().endsWith(extension)
    })

    if (match) {
      return match
    }
  }

  return images?.[0]
}

export function updateSetEmote(
  emotes: Map<string, SevenTVEmote>,
  id: string,
  update: Partial<SevenTVEmote>,
): SevenTVEmote | undefined {
  for (const [alias, emote] of emotes) {
    if (emote.id !== id) continue
    const changed = { ...emote, ...update }
    const nextAlias = update.alias || alias
    if (nextAlias !== alias) emotes.delete(alias)
    emotes.set(nextAlias, changed)
    return changed
  }
  return undefined
}

export function removeSetEmote(emotes: Map<string, SevenTVEmote>, id: string): boolean {
  for (const [alias, emote] of emotes) {
    if (emote.id === id) return emotes.delete(alias)
  }
  return false
}
