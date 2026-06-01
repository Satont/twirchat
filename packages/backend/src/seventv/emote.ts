import type { SevenTVEventImageFile, SevenTVEventEmoteValue } from './event-client.ts'

export interface SevenTvEmoteInput {
  alias: string
  animated: boolean
  aspectRatio: number
  id: string
  imageUrl: string
  name: string
  zeroWidth: boolean
}

export interface SevenTVEmote {
  id: string
  alias: string
  name: string
  animated: boolean
  zeroWidth: boolean
  aspectRatio: number
  imageUrl: string
}

export function createSevenTvEmote(input: SevenTvEmoteInput): SevenTVEmote {
  return {
    alias: input.alias,
    animated: input.animated,
    aspectRatio: input.aspectRatio,
    id: input.id,
    imageUrl: input.imageUrl,
    name: input.name,
    zeroWidth: input.zeroWidth,
  }
}

export function createSevenTvEmoteFromEventValue(value: SevenTVEventEmoteValue): SevenTVEmote {
  return createSevenTvEmote({
    alias: value.name,
    animated: value.data.animated,
    aspectRatio: 1,
    id: value.id,
    imageUrl: selectPreferredSevenTvHostFile(value.data.host.url, value.data.host.files),
    name: value.name,
    zeroWidth: false,
  })
}

export function isSevenTvEventEmoteValue(value: unknown): value is SevenTVEventEmoteValue {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as {
    data?: unknown
    id?: unknown
    name?: unknown
  }

  if (typeof record.id !== 'string' || typeof record.name !== 'string') {
    return false
  }

  if (typeof record.data !== 'object' || record.data === null) {
    return false
  }

  const data = record.data as {
    animated?: unknown
    host?: unknown
  }

  if (typeof data.animated !== 'boolean' || typeof data.host !== 'object' || data.host === null) {
    return false
  }

  const host = data.host as {
    files?: unknown
    url?: unknown
  }

  return typeof host.url === 'string' && Array.isArray(host.files)
}

export function isSevenTvEventEmoteUpdate(update: {
  key: string
  old_value: unknown
  value: unknown
}): update is {
  key: 'emotes'
  old_value: SevenTVEventEmoteValue
  value: SevenTVEventEmoteValue
} {
  return (
    update.key === 'emotes' &&
    isSevenTvEventEmoteValue(update.value) &&
    isSevenTvEventEmoteValue(update.old_value)
  )
}

export function selectPreferredSevenTvImageUrl(
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
