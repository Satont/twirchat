import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'

export interface UserCardTarget {
  platform: Platform
  platformUserId: string
  channelId?: string
  displayName: string
  username?: string
  avatarUrl?: string
  currentAlias?: string
}

type AliasMap = Map<Platform, Map<string, string>>

type UserCardCommandResult =
  | { ok: true; target: UserCardTarget }
  | { ok: false; error: 'missing-query' | 'not-found' | 'ambiguous' }

function normalizeUserLookup(value: string): string {
  return value.trim().replace(/^@+/, '').toLocaleLowerCase()
}

function getAlias(
  aliasMap: AliasMap | undefined,
  platform: Platform,
  platformUserId: string,
): string | undefined {
  return aliasMap?.get(platform)?.get(platformUserId)
}

export function parseUserCardCommand(text: string): string | null {
  const match = text.trim().match(/^\/user(?:\s+(.+))?$/i)
  if (!match) {
    return null
  }

  return normalizeUserLookup(match[1] ?? '')
}

export function resolveUserCardCommand(
  text: string,
  messages: NormalizedChatMessage[],
  aliasMap?: AliasMap,
): UserCardCommandResult | null {
  const query = parseUserCardCommand(text)
  if (query === null) {
    return null
  }

  if (!query) {
    return { ok: false, error: 'missing-query' }
  }

  const deduped = new Map<string, UserCardTarget>()

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index]
    if (!msg?.author.id) {
      continue
    }

    const key = `${msg.platform}:${msg.author.id}`
    if (deduped.has(key)) {
      continue
    }

    deduped.set(key, {
      platform: msg.platform,
      platformUserId: msg.author.id,
      channelId: msg.channelId,
      displayName: msg.author.displayName,
      username: msg.author.username,
      avatarUrl: msg.author.avatarUrl,
      currentAlias: getAlias(aliasMap, msg.platform, msg.author.id),
    })
  }

  const matches = [...deduped.values()].filter((target) => {
    const alias = normalizeUserLookup(target.currentAlias ?? '')
    const displayName = normalizeUserLookup(target.displayName)
    const username = normalizeUserLookup(target.username ?? '')

    return alias === query || displayName === query || username === query
  })

  if (matches.length === 0) {
    return { ok: false, error: 'not-found' }
  }

  if (matches.length > 1) {
    return { ok: false, error: 'ambiguous' }
  }

  return { ok: true, target: matches[0]! }
}
