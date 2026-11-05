import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { chatMessageKey, type SearchableChatMessage } from './chat-tools'
import type { HomePluginRow } from './state/home-plugin-channels'

export type ChatTimelineRow = NormalizedChatMessage | HomePluginRow

export function timelineRowKey(row: ChatTimelineRow): string {
  return 'message' in row ? row.key : chatMessageKey(row)
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
): readonly ChatTimelineRow[] {
  if (plugin.length === 0) return builtIn
  if (builtIn.length === 0) return plugin
  const rows: ChatTimelineRow[] = []
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
