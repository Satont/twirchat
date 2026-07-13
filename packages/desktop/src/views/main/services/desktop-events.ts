import type {
  NormalizedChatMessage,
  NormalizedEvent,
  Platform,
  PlatformStatusInfo,
} from '@twirchat/shared/types'
import type { SevenTVEmote } from '@twirchat/shared/protocol'
import { Events } from '@wailsio/runtime'

export type DesktopEventMap = {
  chat_message: NormalizedChatMessage
  chat_event: NormalizedEvent
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

export interface WailsEventRuntime {
  On(name: string, callback: (event: { data: unknown }) => void): () => void
}

export interface DesktopEvents {
  on<EventName extends keyof DesktopEventMap>(
    eventName: EventName,
    handler: (payload: DesktopEventMap[EventName]) => void,
  ): () => void
}

export function createDesktopEvents(runtime: WailsEventRuntime = Events): DesktopEvents {
  return {
    on(eventName, handler) {
      return runtime.On(eventName, (event) => {
        handler(deserializeEvent(eventName, event.data))
      })
    },
  }
}

function deserializeEvent<EventName extends keyof DesktopEventMap>(
  eventName: EventName,
  payload: unknown,
): DesktopEventMap[EventName] {
  if (eventName === 'chat_message') {
    return toChatMessage(payload as NormalizedChatMessage) as DesktopEventMap[EventName]
  }
  if (eventName === 'chat_event') {
    return toChatEvent(payload as NormalizedEvent) as DesktopEventMap[EventName]
  }
  if (eventName === 'watched_channel_message') {
    const watched = payload as DesktopEventMap['watched_channel_message']
    return { ...watched, message: toChatMessage(watched.message) } as DesktopEventMap[EventName]
  }
  return payload as DesktopEventMap[EventName]
}

function toChatMessage(message: NormalizedChatMessage): NormalizedChatMessage {
  return { ...message, timestamp: toDate(message.timestamp) }
}

function toChatEvent(event: NormalizedEvent): NormalizedEvent {
  return { ...event, timestamp: toDate(event.timestamp) }
}

function toDate(timestamp: Date | string): Date {
  return timestamp instanceof Date ? timestamp : new Date(timestamp)
}

export const desktopEvents = createDesktopEvents()
