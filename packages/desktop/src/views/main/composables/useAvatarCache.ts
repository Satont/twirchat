import { reactive } from 'vue'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { desktopApi, type AvatarResolution, type ModerationPlatform } from '../services/desktop-api'

type AvatarLookup = (params: {
  platform: ModerationPlatform
  authorId: string
  username?: string
}) => Promise<AvatarResolution>

export interface AvatarCache {
  avatarUrlFor(message: NormalizedChatMessage): string | undefined
  ensureAvatar(message: NormalizedChatMessage): void
}

/**
 * Creates a reactive session cache. It deliberately returns fallback state
 * synchronously and starts I/O only as a fire-and-forget side effect.
 */
export function createAvatarCache(resolveAvatar: AvatarLookup): AvatarCache {
  const urls = reactive(new Map<string, string>())
  const requested = new Set<string>()

  function avatarUrlFor(message: NormalizedChatMessage): string | undefined {
    const supplied = normalizedAvatarURL(message.author.avatarUrl)
    if (supplied) return supplied
    const key = avatarKey(message)
    return key ? urls.get(key) : undefined
  }

  function ensureAvatar(message: NormalizedChatMessage): void {
    const platform = avatarPlatform(message)
    if (!platform) return
    const key = `${platform}:${message.author.id}`

    const supplied = normalizedAvatarURL(message.author.avatarUrl)
    if (supplied) {
      urls.set(key, supplied)
      return
    }
    if (urls.has(key) || requested.has(key)) return

    requested.add(key)
    void resolveAvatar({
      platform,
      authorId: message.author.id,
      ...(message.author.username ? { username: message.author.username } : {}),
    })
      .then((resolution) => {
        const avatarURL = normalizedAvatarURL(resolution.avatarUrl)
        if (avatarURL) urls.set(key, avatarURL)
      })
      .catch(() => undefined)
  }

  return { avatarUrlFor, ensureAvatar }
}

const sessionAvatarCache = createAvatarCache((params) => desktopApi.request.resolveAvatar(params))

export function useAvatarCache(): AvatarCache {
  return sessionAvatarCache
}

function avatarKey(message: NormalizedChatMessage): string | undefined {
  const platform = avatarPlatform(message)
  if (!platform) {
    return undefined
  }
  return `${platform}:${message.author.id}`
}

function avatarPlatform(message: NormalizedChatMessage): ModerationPlatform | undefined {
  if (message.author.id.trim() === '') {
    return undefined
  }
  if (message.platform === 'twitch') return 'twitch'
  if (
    message.platform === 'kick' &&
    ((message.author.username ?? '').trim() !== '' || message.author.avatarUrl)
  ) {
    return 'kick'
  }
  return undefined
}

function normalizedAvatarURL(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}
