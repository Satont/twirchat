import { onUnmounted } from "vue";
import { eventSource } from "../main";
import type {
  NormalizedChatMessage,
  NormalizedEvent,
  Platform,
  PlatformStatusInfo,
} from "@twirchat/shared";
import type { SevenTVEmote } from "@twirchat/shared/protocol";

type EventMap = {
  chat_message: NormalizedChatMessage;
  chat_event: NormalizedEvent;
  platform_status: PlatformStatusInfo;
  auth_url: { platform: Platform; url: string };
  auth_success: { platform: string; username: string; displayName: string };
  auth_error: { platform: string; error: string };
  update_status: {
    status: string;
    message: string;
    progress?: number;
    hash?: string;
  };
  watched_channel_message: {
    channelId: string;
    message: NormalizedChatMessage;
  };
  watched_channel_status: { channelId: string; status: PlatformStatusInfo };
  channel_emotes_set: {
    platform: Platform;
    channelId: string;
    emotes: SevenTVEmote[];
  };
  channel_emote_added: {
    platform: Platform;
    channelId: string;
    emote: SevenTVEmote;
  };
  channel_emote_removed: {
    platform: Platform;
    channelId: string;
    emoteId: string;
  };
  channel_emote_updated: {
    platform: Platform;
    channelId: string;
    emoteId: string;
    newAlias: string;
  };
};

export function useRpcListener<K extends keyof EventMap>(
  event: K,
  handler: (payload: EventMap[K]) => void,
): void {
  const listener = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as EventMap[K];
      handler(data);
    } catch {
      console.warn(`[useRpcListener] Failed to parse event: ${event}`);
    }
  };

  eventSource.addEventListener(event, listener as EventListener);

  onUnmounted(() => {
    eventSource.removeEventListener(event, listener as EventListener);
  });
}
