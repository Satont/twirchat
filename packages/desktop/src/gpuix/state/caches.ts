import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { runInBackground } from '../../services/background-task'
import { createStore, type Store } from './create-store'
import { persistentResource } from './persistent-resources'

type ModerationPlatform = 'twitch' | 'kick'

type AvatarLookup = (params: {
  platform: ModerationPlatform
  authorId: string
  username?: string
}) => Promise<{ avatarUrl?: string }>

export const avatarRevisionStore = persistentResource('avatarRevision', () =>
  createStore<number>(0),
)

const avatarUrls = new Map<string, string>()
const avatarRequested = new Set<string>()
let avatarLookup: AvatarLookup | null = null

export function initAvatarCache(lookup: AvatarLookup): void {
  avatarLookup = lookup
}

// ── Avatars ─────────────────────────────────────────────────────────────────

function avatarPlatform(message: NormalizedChatMessage): ModerationPlatform | undefined {
  if (message.author.id.trim() === '') return undefined
  if (message.platform === 'twitch') return 'twitch'
  if (
    message.platform === 'kick' &&
    ((message.author.username ?? '').trim() !== '' || message.author.avatarUrl)
  ) {
    return 'kick'
  }
  return undefined
}

function normalizedUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

export function avatarUrlFor(message: NormalizedChatMessage): string | undefined {
  const supplied = normalizedUrl(message.author.avatarUrl)
  if (supplied) return supplied
  const platform = avatarPlatform(message)
  if (!platform) return undefined
  return avatarUrls.get(`${platform}:${message.author.id}`)
}

export function ensureAvatar(message: NormalizedChatMessage): void {
  const platform = avatarPlatform(message)
  if (!platform || !avatarLookup) return
  const key = `${platform}:${message.author.id}`

  const supplied = normalizedUrl(message.author.avatarUrl)
  if (supplied) {
    if (!avatarUrls.has(key)) {
      avatarUrls.set(key, supplied)
      avatarRevisionStore.modify((v) => v + 1)
    }
    return
  }
  if (avatarUrls.has(key) || avatarRequested.has(key)) return

  avatarRequested.add(key)
  runInBackground(
    avatarLookup({
      platform,
      authorId: message.author.id,
      ...(message.author.username ? { username: message.author.username } : {}),
    })
      .then((resolution) => {
        const url = normalizedUrl(resolution.avatarUrl)
        if (url) {
          avatarUrls.set(key, url)
          avatarRevisionStore.modify((v) => v + 1)
        }
      })
      .catch(() => undefined),
    'caches background operation failed',
  )
}

declare module './persistent-resources' {
  interface PersistentResources {
    avatarRevision: Store<number>
  }
}
