import type { ChatClear, RoomState } from '@twirchat/shared/channel-tools'
/**
 * GPUIX backend bridge — event bus.
 *
 * Mirrors the Wails `DesktopEventMap` contract (src/views/main/services/desktop-events.ts)
 * exactly, so the UI layer is portable between transports. In the GPUIX build the
 * "backend" lives in the same Bun process, so events are plain function calls.
 */
import type { EmoteCatalogEntry, SevenTVEmote } from '@twirchat/shared/protocol'
import type {
  TwitchActivityEvent,
  TwitchWhisper,
  TwitchEventSubStatus,
} from '@twirchat/shared/twitch-activities'
import type {
  TwitchActivitySnapshotUpdate,
  TwitchActivityCapability,
} from '@twirchat/shared/twitch-activities'
import type {
  ModerationOutcome,
  NormalizedChatMessage,
  NormalizedEvent,
  Platform,
  PlatformStatusInfo,
} from '@twirchat/shared/types'

import type { PluginInfo, PluginTransportMessage, PluginTransportStatus } from '../../plugins/api'
import type { StreamerModeStatus } from '../../services/streamer-mode'
import type { PluginWatchedChannel } from '../../watched-channels/plugin-channel-types'

export type DesktopEventMap = {
  plugins_changed: readonly PluginInfo[]
  plugin_channel_message: { channel: PluginWatchedChannel; message: PluginTransportMessage }
  plugin_channel_status: { channel: PluginWatchedChannel; status: PluginTransportStatus }
  streamer_mode_changed: StreamerModeStatus
  accounts_changed: { platform: Platform; identityChanged: boolean }
  author_emote_catalog: { platform: Platform; authorId: string; emotes: EmoteCatalogEntry[] }
  channel_emote_catalog: { platform: Platform; channelId: string; emotes: EmoteCatalogEntry[] }
  chat_message: NormalizedChatMessage
  chat_history_snapshot: {
    channelId: string
    messages: NormalizedChatMessage[]
    watchedChannelId?: string
  }
  chat_event: NormalizedEvent
  chat_moderation: ModerationOutcome
  channel_room_state: RoomState
  chat_clear: ChatClear
  twitch_activity: TwitchActivityEvent
  twitch_whisper: TwitchWhisper
  twitch_eventsub_status: TwitchEventSubStatus
  twitch_activity_snapshot: TwitchActivitySnapshotUpdate
  twitch_activity_capability: TwitchActivityCapability
  platform_status: PlatformStatusInfo
  auth_url: { platform: Platform; url: string }
  auth_success: { platform: Platform; username: string; displayName: string }
  auth_error: { platform: Platform; error: string }
  update_status: { status: string; message: string; progress?: number; hash?: string }
  watched_channel_message: { channelId: string; message: NormalizedChatMessage }
  watched_channel_status: { channelId: string; status: PlatformStatusInfo }
  channel_emotes_set: { platform: Platform; channelId: string; emotes: SevenTVEmote[] }
  channel_emote_added: { platform: Platform; channelId: string; emote: SevenTVEmote }
  channel_emote_removed: { platform: Platform; channelId: string; emoteId: string }
  channel_emote_updated: {
    platform: Platform
    channelId: string
    emoteId: string
    newAlias: string
  }
}

export type DesktopEventName = keyof DesktopEventMap

export interface DesktopEvents {
  on<EventName extends DesktopEventName>(
    eventName: EventName,
    handler: (payload: DesktopEventMap[EventName]) => void,
  ): () => void
  emit<EventName extends DesktopEventName>(
    eventName: EventName,
    payload: DesktopEventMap[EventName],
  ): void
}

type EventHandlers = {
  [Name in DesktopEventName]: Set<(payload: DesktopEventMap[Name]) => void>
}

export function createDesktopEvents(): DesktopEvents {
  const handlers: EventHandlers = {
    plugins_changed: new Set(),
    plugin_channel_message: new Set(),
    plugin_channel_status: new Set(),
    streamer_mode_changed: new Set(),
    accounts_changed: new Set(),
    author_emote_catalog: new Set(),
    channel_emote_catalog: new Set(),
    chat_message: new Set(),
    chat_history_snapshot: new Set(),
    chat_event: new Set(),
    chat_moderation: new Set(),
    channel_room_state: new Set(),
    chat_clear: new Set(),
    twitch_activity: new Set(),
    twitch_whisper: new Set(),
    twitch_eventsub_status: new Set(),
    twitch_activity_snapshot: new Set(),
    twitch_activity_capability: new Set(),
    platform_status: new Set(),
    auth_url: new Set(),
    auth_success: new Set(),
    auth_error: new Set(),
    update_status: new Set(),
    watched_channel_message: new Set(),
    watched_channel_status: new Set(),
    channel_emotes_set: new Set(),
    channel_emote_added: new Set(),
    channel_emote_removed: new Set(),
    channel_emote_updated: new Set(),
  }

  return {
    on(eventName, handler) {
      const set = handlers[eventName]
      set.add(handler)
      return () => {
        set.delete(handler)
      }
    },
    emit(eventName, payload) {
      const set = handlers[eventName]
      for (const handler of [...set]) {
        try {
          handler(payload)
        } catch (error) {
          console.error(`[events] handler for "${eventName}" failed:`, error)
        }
      }
    },
  }
}
