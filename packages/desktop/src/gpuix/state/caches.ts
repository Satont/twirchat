/**
 * Reactive session caches for avatars and mention colors.
 * Ports useAvatarCache.ts + the mention half of useMessageParsing.ts.
 * Both bump a revision store so mounted messages re-render on resolution.
 */

import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import { createStore } from './create-store'

type ModerationPlatform = 'twitch' | 'kick'

type AvatarLookup = (params: {
  platform: ModerationPlatform
  authorId: string
  username?: string
}) => Promise<{ avatarUrl?: string }>

type ColorLookup = (params: { platform: Platform; username: string }) => Promise<string | null>

export const avatarRevisionStore = createStore(0)
export const mentionColorRevisionStore = createStore(0)

const avatarUrls = new Map<string, string>()
const avatarRequested = new Set<string>()
const mentionColors = new Map<string, string | null>()

let avatarLookup: AvatarLookup | null = null
let colorLookup: ColorLookup | null = null

export function initCaches(lookups: {
  resolveAvatar: AvatarLookup
  getUsernameColor: ColorLookup
}): void {
  avatarLookup = lookups.resolveAvatar
  colorLookup = lookups.getUsernameColor
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
      avatarRevisionStore.set((v) => v + 1)
    }
    return
  }
  if (avatarUrls.has(key) || avatarRequested.has(key)) return

  avatarRequested.add(key)
  void avatarLookup({
    platform,
    authorId: message.author.id,
    ...(message.author.username ? { username: message.author.username } : {}),
  })
    .then((resolution) => {
      const url = normalizedUrl(resolution.avatarUrl)
      if (url) {
        avatarUrls.set(key, url)
        avatarRevisionStore.set((v) => v + 1)
      }
    })
    .catch(() => undefined)
}

// ── Mention colors ──────────────────────────────────────────────────────────

const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g

export function mentionColor(platform: string, username: string): string | null | undefined {
  return mentionColors.get(`${platform}:${username.toLowerCase()}`)
}

export function ensureMentionColors(platform: Platform, text: string): void {
  if (!colorLookup) return
  const mentions = text.match(MENTION_REGEX)
  if (!mentions) return
  const uniqueUsers = new Set(mentions.map((m) => m.slice(1)))
  for (const username of uniqueUsers) {
    const key = `${platform}:${username.toLowerCase()}`
    if (mentionColors.has(key)) continue
    if (mentionColors.size > 2000) mentionColors.clear()
    mentionColors.set(key, null) // optimistic placeholder, replaced on resolve
    const lookup = colorLookup
    void lookup({ platform, username })
      .then((color) => {
        mentionColors.set(key, color)
        mentionColorRevisionStore.set((v) => v + 1)
      })
      .catch(() => undefined)
  }
}
