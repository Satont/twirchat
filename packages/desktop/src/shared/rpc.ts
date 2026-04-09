/**
 * TwirChat Electrobun RPC Schema
 *
 * Defines the typed RPC contract between the Bun main process and the
 * webview (Vue) side.  Import this type in both src/bun/index.ts and
 * src/views/main/index.ts.
 *
 * Convention:
 *   bun.requests   — requests that the WEBVIEW sends and BUN handles
 *   bun.messages   — fire-and-forget messages that the WEBVIEW sends to BUN
 *   webview.requests  — (currently none)
 *   webview.messages  — messages that BUN pushes to the WEBVIEW
 */

import type { ElectrobunRPCSchema, RPCSchema } from 'electrobun/bun'
import type {
  Account,
  AppSettings,
  LayoutNode,
  NormalizedChatMessage,
  NormalizedEvent,
  Platform,
  PlatformStatusInfo,
  SplitDirection,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'
import type {
  ChannelStatusRequest,
  ChannelsStatusResponse,
  SearchCategoriesResponse,
  SevenTVEmote,
  StreamStatusResponse,
  UpdateStreamRequest,
  UpdateStreamResponse,
} from '@twirchat/shared/protocol'

// ----------------------------------------------------------------
// Bun-side schema (what the webview calls into)
// ----------------------------------------------------------------

type BunRequests = {
  /** Return all stored accounts */
  getAccounts: { params: void; response: Account[] }
  /** Return current app settings */
  getSettings: { params: void; response: AppSettings }
  /** Save app settings */
  saveSettings: { params: AppSettings; response: void }
  /** Return all persisted joined channels grouped by platform */
  getChannels: { params: void; response: Partial<Record<Platform, string[]>> }
  /** Start OAuth flow for a platform */
  authStart: { params: { platform: Platform }; response: void }
  /** Log out from a platform */
  authLogout: { params: { platform: Platform }; response: void }
  /** Join a channel for live chat */
  joinChannel: {
    params: { platform: Platform; channelSlug: string }
    response: void
  }
  /** Leave a channel */
  leaveChannel: {
    params: { platform: Platform; channelSlug: string }
    response: void
  }
  /** Send a chat message */
  sendMessage: {
    params: { platform: Platform; channelId: string; text: string; replyToMessageId?: string }
    response: void
  }
  /** Get current stream status (title, category, viewers, isLive) */
  getStreamStatus: {
    params: { platform: 'twitch' | 'kick'; channelId: string }
    response: StreamStatusResponse
  }
  /** Update stream title and/or category */
  updateStream: {
    params: Omit<UpdateStreamRequest, 'userAccessToken'>
    response: UpdateStreamResponse
  }
  /** Search for game/category suggestions */
  searchCategories: {
    params: { platform: 'twitch' | 'kick'; query: string }
    response: SearchCategoriesResponse
  }
  /** Bulk stream status for all active channels (parallel fetch via backend) */
  getChannelsStatus: {
    params: { channels: ChannelStatusRequest[] }
    response: ChannelsStatusResponse
  }
  /** Return last N persisted chat messages (default 100) */
  getRecentMessages: {
    params: { limit?: number } | void
    response: NormalizedChatMessage[]
  }
  /** Return current connection status for all platform adapters */
  getStatuses: {
    params: void
    response: PlatformStatusInfo[]
  }
  /** Get username color for mention highlighting (platform-specific) */
  getUsernameColor: {
    params: { platform: Platform; username: string }
    response: string | null
  }
  /** Get all 7TV emotes for a channel */
  getChannelEmotes: {
    params: { platform: Platform; channelId: string }
    response: SevenTVEmote[]
  }
  /** Check for app updates */
  checkForUpdate: {
    params: void
    response: { updateAvailable: boolean; version?: string; currentVersion: string }
  }
  /** Download available update */
  downloadUpdate: { params: void; response: { success: boolean; error?: string } }
  /** Apply downloaded update and restart */
  applyUpdate: { params: void; response: void }

  // ---- Watched Channels ----
  /** Return all persisted watched channels */
  getWatchedChannels: { params: void; response: WatchedChannel[] }
  /** Add a new watched channel (persists + auto-connects) */
  addWatchedChannel: {
    params: { platform: 'twitch' | 'kick' | 'youtube'; channelSlug: string }
    response: WatchedChannel
  }
  /** Remove a watched channel */
  removeWatchedChannel: { params: { id: string }; response: void }
  /** Get buffered messages for a watched channel */
  getWatchedChannelMessages: {
    params: { id: string }
    response: NormalizedChatMessage[]
  }
  /** Send a message via a watched channel */
  sendWatchedChannelMessage: {
    params: { id: string; text: string; replyToMessageId?: string }
    response: void
  }
  /** Get current connection statuses for all watched channels */
  getWatchedChannelStatuses: {
    params: void
    response: Array<{ channelId: string; status: PlatformStatusInfo }>
  }
  /** Open external URL in system browser */
  openExternalUrl: { params: { url: string }; response: void }

  // ---- Watched Channels Layout (per-tab) ----
  /** Get the list of watched channel IDs that have standalone tabs */
  getTabChannelIds: { params: void; response: string[] | null }
  /** Persist the list of watched channel IDs that have standalone tabs */
  setTabChannelIds: { params: { ids: string[] }; response: void }
  /** Get the layout tree for a specific watched channel tab */
  getWatchedChannelsLayout: { params: { tabId: string }; response: WatchedChannelsLayout | null }
  /** Persist a full layout tree for a specific watched channel tab */
  setWatchedChannelsLayout: {
    params: { tabId: string; layout: WatchedChannelsLayout }
    response: void
  }
  /** Remove a panel by id within a tab's layout */
  removePanel: { params: { tabId: string; panelId: string }; response: void }
  /** Assign (or unassign) a watched channel to a panel within a tab's layout */
  assignChannelToPanel: {
    params: { tabId: string; panelId: string; channelId: string | null }
    response: void
  }
  /** Split a panel into two in the given direction within a tab's layout */
  splitPanel: {
    params: { tabId: string; panelId: string; direction: SplitDirection }
    response: { original: LayoutNode; newPanel: LayoutNode }
  }
}

type BunMessages = Record<never, unknown>

// ----------------------------------------------------------------
// Webview-side schema (what Bun pushes into the webview)
// ----------------------------------------------------------------

type WebviewRequests = Record<never, unknown>

type WebviewMessages = {
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
  update_status: { status: string; message: string; progress?: number }
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

// ----------------------------------------------------------------
// Combined schema exported for use on both sides
// ----------------------------------------------------------------

export interface TwirChatRPCSchema {
  bun: RPCSchema<{ requests: BunRequests; messages: BunMessages }>
  webview: RPCSchema<{ requests: WebviewRequests; messages: WebviewMessages }>
}

// ----------------------------------------------------------------
// Explicit sender type — used on the bun side to push messages
// Into the webview without fighting TypeScript's generic inference
// ----------------------------------------------------------------

export type WebviewSender = {
  [K in keyof WebviewMessages]: (payload: WebviewMessages[K]) => void
}

// Satisfy ElectrobunRPCSchema constraint (structural)
export type { ElectrobunRPCSchema }
