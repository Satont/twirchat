/**
 * Shared message types for the desktop process.
 *
 * History: this file used to define the Electrobun RPC schema. The GPUIX
 * build keeps only the pieces that are still referenced: the auth server's
 * typed sender and the user-history DTOs. The live request/event contract
 * for the UI now lives in src/gpuix/backend/{api,events}.ts.
 */

import type {
  NormalizedChatMessage,
  NormalizedEvent,
  Platform,
  PlatformStatusInfo,
} from '@twirchat/shared/types'
import type { SevenTVEmote } from '@twirchat/shared/protocol'

export interface UserAlias {
  platform: Platform
  platformUserId: string
  alias: string
  createdAt: number
  updatedAt: number
}

export interface UserChatHistoryCursor {
  createdAt: number
  id: string
}

export interface UserChatHistoryPage {
  messages: NormalizedChatMessage[]
  nextCursor: UserChatHistoryCursor | null
  hasMore: boolean
}

/** Messages the main process pushes to the UI. */
export type WebviewMessages = {
  /** A new chat message arrived */
  chat_message: NormalizedChatMessage
  /** A follow/sub/raid/… event arrived */
  chat_event: NormalizedEvent
  /** Platform connection status changed */
  platform_status: PlatformStatusInfo
  /** OAuth URL ready — open in browser */
  auth_url: { platform: Platform; url: string }
  /** OAuth completed successfully */
  auth_success: { platform: Platform; username: string; displayName: string }
  /** OAuth failed */
  auth_error: { platform: Platform; error: string }
  /** Update status changed */
  update_status: { status: string; message: string; progress?: number; hash?: string }
  /** A new message arrived on a watched channel */
  watched_channel_message: { channelId: string; message: NormalizedChatMessage }
  /** Status changed for a watched channel */
  watched_channel_status: { channelId: string; status: PlatformStatusInfo }
  /** Full emote set received for a channel */
  channel_emotes_set: { platform: Platform; channelId: string; emotes: SevenTVEmote[] }
  /** An emote was added to a channel */
  channel_emote_added: { platform: Platform; channelId: string; emote: SevenTVEmote }
  /** An emote was removed from a channel (by ID) */
  channel_emote_removed: { platform: Platform; channelId: string; emoteId: string }
  /** An emote alias was updated */
  channel_emote_updated: {
    platform: Platform
    channelId: string
    emoteId: string
    newAlias: string
  }
}

/** Explicit sender type — used to push messages to the UI layer. */
export type WebviewSender = {
  [K in keyof WebviewMessages]: (payload: WebviewMessages[K]) => void
}
