import { onUnmounted } from 'vue'
import { eventSource } from '../main'

type EventMap = {
  chat_message: import('@twirchat/shared/types').NormalizedChatMessage
  chat_event: import('@twirchat/shared/types').NormalizedEvent
  platform_status: import('@twirchat/shared/types').PlatformStatusInfo
  auth_url: { platform: import('@twirchat/shared/types').Platform; url: string }
  auth_success: { platform: string; username: string; displayName: string }
  auth_error: { platform: string; error: string }
  update_status: { status: string; message: string; progress?: number; hash?: string }
  watched_channel_message: {
    channelId: string
    message: import('@twirchat/shared/types').NormalizedChatMessage
  }
  watched_channel_status: {
    channelId: string
    status: import('@twirchat/shared/types').PlatformStatusInfo
  }
  channel_emotes_set: {
    platform: import('@twirchat/shared/types').Platform
    channelId: string
    emotes: import('@twirchat/shared/protocol').SevenTVEmote[]
  }
  channel_emote_added: {
    platform: import('@twirchat/shared/types').Platform
    channelId: string
    emote: import('@twirchat/shared/protocol').SevenTVEmote
  }
  channel_emote_removed: {
    platform: import('@twirchat/shared/types').Platform
    channelId: string
    emoteId: string
  }
  channel_emote_updated: {
    platform: import('@twirchat/shared/types').Platform
    channelId: string
    emoteId: string
    newAlias: string
  }
}

export function useRpcListener<K extends keyof EventMap>(
  event: K,
  handler: (payload: EventMap[K]) => void,
): void {
  const listener = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as EventMap[K]
      handler(data)
    } catch {
      console.warn(`[useRpcListener] Failed to parse event: ${event}`)
    }
  }

  eventSource.addEventListener(event, listener as EventListener)

  onUnmounted(() => {
    eventSource.removeEventListener(event, listener as EventListener)
  })
}
