/**
 * GPUIX backend bridge — event bus.
 *
 * Mirrors the Wails `DesktopEventMap` contract (src/views/main/services/desktop-events.ts)
 * exactly, so the UI layer is portable between transports. In the GPUIX build the
 * "backend" lives in the same Bun process, so events are plain function calls.
 */

import type {
  ModerationOutcome,
  NormalizedChatMessage,
  NormalizedEvent,
  Platform,
  PlatformStatusInfo,
} from '@twirchat/shared/types'
import type { SevenTVEmote } from '@twirchat/shared/protocol'

export type DesktopEventMap = {
  chat_message: NormalizedChatMessage
  chat_event: NormalizedEvent
  chat_moderation: ModerationOutcome
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

export function createDesktopEvents(): DesktopEvents {
  const handlers = new Map<DesktopEventName, Set<(payload: never) => void>>()

  return {
    on(eventName, handler) {
      let set = handlers.get(eventName)
      if (!set) {
        set = new Set()
        handlers.set(eventName, set)
      }
      const typed = handler as (payload: never) => void
      set.add(typed)
      return () => {
        set.delete(typed)
      }
    },
    emit(eventName, payload) {
      const set = handlers.get(eventName)
      if (!set) return
      for (const handler of [...set]) {
        try {
          ;(handler as (payload: unknown) => void)(payload)
        } catch (error) {
          console.error(`[events] handler for "${eventName}" failed:`, error)
        }
      }
    },
  }
}
