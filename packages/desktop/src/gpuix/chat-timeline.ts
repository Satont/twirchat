import type { DonationEvent } from '@twirchat/shared/donations'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { chatMessageKey, type SearchableChatMessage } from './chat-tools'
import type { DonationRow } from './state/donation-feed'
import type { HomePluginRow } from './state/home-plugin-channels'
import type { TwitchAutoModRow } from './state/twitch-automod'

type ChatMessageRow = NormalizedChatMessage | HomePluginRow
export type ChatTimelineRow = ChatMessageRow | DonationRow | TwitchAutoModRow

export function timelineRowKey(row: ChatTimelineRow): string {
  return 'key' in row ? row.key : chatMessageKey(row)
}

export function pluginChatSearchMessage({
  channel,
  message,
}: HomePluginRow): SearchableChatMessage {
  return {
    id: message.id,
    platform: channel.transportName.toLowerCase(),
    channelId: channel.channelSlug,
    author: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.author.name,
      badges: [],
    },
    text: message.text,
    emotes: [],
    type: message.kind,
  }
}

/** Interleave two ordered snapshots without changing the built-in retention or delivery index. */
export function mergeChatTimeline(
  builtIn: readonly NormalizedChatMessage[],
  plugin: readonly HomePluginRow[],
): readonly ChatMessageRow[] {
  if (plugin.length === 0) return builtIn
  if (builtIn.length === 0) return plugin
  const rows: ChatMessageRow[] = []
  let builtInIndex = 0
  for (const row of plugin) {
    let next = builtIn[builtInIndex]
    while (next && next.timestamp.getTime() <= row.message.timestamp) {
      rows.push(next)
      next = builtIn[++builtInIndex]
    }
    rows.push(row)
  }
  rows.push(...builtIn.slice(builtInIndex))
  return rows
}

export function donationAmount(donation: DonationEvent): string {
  return `${donation.amount} ${donation.currency}`.trimEnd()
}

export function donationSearchMessage({ donation, key }: DonationRow): SearchableChatMessage {
  const { provider, username, message } = donation
  const amount = donationAmount(donation)
  return {
    id: key,
    platform: provider,
    channelId: provider,
    author: { id: username, username, displayName: username, badges: [] },
    text: `Donated ${amount}${message ? ` · ${message}` : ''}`,
    type: 'system',
    emotes: [],
    metadata: { flags: { donation: true } },
  }
}

function rowTimestamp(row: ChatTimelineRow): number {
  if ('donation' in row) return row.donation.timestamp
  if ('hold' in row) return row.hold.timestamp
  return 'message' in row ? row.message.timestamp : row.timestamp.getTime()
}

/** Insert time-ordered rows into an ordered timeline without reordering it. */
function mergeTimedRows(
  chat: readonly ChatTimelineRow[],
  extra: readonly (DonationRow | TwitchAutoModRow)[],
): readonly ChatTimelineRow[] {
  const firstExtra = extra[0]
  const firstChat = chat[0]
  if (!firstExtra) return chat
  if (!firstChat) return extra
  const lastChat = chat.at(-1)
  const lastExtra = extra.at(-1)
  if (lastChat && rowTimestamp(lastChat) <= rowTimestamp(firstExtra)) return [...chat, ...extra]
  if (lastExtra && rowTimestamp(lastExtra) < rowTimestamp(firstChat)) return [...extra, ...chat]

  const rows: ChatTimelineRow[] = []
  let next = 0
  for (const row of extra) {
    const timestamp = rowTimestamp(row)
    let low = next
    let high = chat.length
    while (low < high) {
      const mid = (low + high) >>> 1
      const candidate = chat[mid]
      if (candidate && rowTimestamp(candidate) <= timestamp) low = mid + 1
      else high = mid
    }
    rows.push(...chat.slice(next, low), row)
    next = low
  }
  rows.push(...chat.slice(next))
  return rows
}

export function mergeDonationTimeline(
  chat: readonly ChatTimelineRow[],
  donations: readonly DonationRow[],
): readonly ChatTimelineRow[] {
  return mergeTimedRows(chat, donations)
}

export function mergeAutoModTimeline(
  chat: readonly ChatTimelineRow[],
  rows: readonly TwitchAutoModRow[],
): readonly ChatTimelineRow[] {
  return mergeTimedRows(chat, rows)
}

export function autoModSearchMessage({ key, hold }: TwitchAutoModRow): SearchableChatMessage {
  return {
    id: key,
    platform: 'twitch',
    channelId: hold.channelSlug,
    author: {
      id: hold.displayName,
      username: hold.displayName,
      displayName: hold.displayName,
      badges: [],
    },
    text: hold.text,
    type: 'system',
    emotes: [],
  }
}
