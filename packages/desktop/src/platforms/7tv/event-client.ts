import { emoteStore } from "./emote-store";
import { fetchUserWithEmoteSet, fetchEmoteSet } from "./gql-client";

const EVENT_API_URL = "https://events.7tv.io/v3";

interface EventAPIMessage {
  op: number;
  t?: number;
  d?: unknown;
}

interface UserUpdateEvent {
  id: string;
  actor?: {
    id: string;
    display_name: string;
  };
  updated?: {
    style?: {
      activeEmoteSetId?: string;
    };
  };
}

interface EmoteSetUpdateEvent {
  id: string;
  actor?: {
    id: string;
    display_name: string;
  };
  pushed?: Array<{
    key: string;
    index: number;
    type: "emote";
    value: {
      id: string;
      alias: string;
      emote: {
        id: string;
        defaultName: string;
        flags: {
          animated: boolean;
        };
        images: Array<{
          url: string;
          mime: string;
          size: number;
          scale: number;
          width: number;
          height: number;
          frameCount: number;
        }>;
      };
    };
  }>;
  pulled?: Array<{
    key: string;
    index: number;
    type: "emote";
    old_value: {
      id: string;
      alias: string;
      emote: {
        id: string;
        defaultName: string;
        flags: {
          animated: boolean;
        };
        images: Array<{
          url: string;
          mime: string;
          size: number;
          scale: number;
          width: number;
          height: number;
          frameCount: number;
        }>;
      };
    };
  }>;
  updated?: Array<{
    key: string;
    index: number;
    type: "emote";
    old_value: {
      id: string;
      alias: string;
    };
    value: {
      id: string;
      alias: string;
    };
  }>;
}

export class SevenTVEventClient {
  private abortController: AbortController | null = null;
  private userId: string | null = null;
  private reconnectTimer: Timer | null = null;
  private heartbeatTimer: Timer | null = null;
  private lastHeartbeat = 0;
  private isConnecting = false;
  private currentEmoteSetId: string | null = null;

  async connect(userId: string): Promise<void> {
    if (this.isConnecting || this.abortController) {
      return;
    }

    this.isConnecting = true;
    this.userId = userId;

    try {
      const userData = await fetchUserWithEmoteSet(userId);
      if (!userData?.style?.activeEmoteSet?.id) {
        console.warn("[7TV] No active emote set found for user:", userId);
        this.isConnecting = false;
        return;
      }

      const emoteSet = userData.style.activeEmoteSet;
      this.currentEmoteSetId = emoteSet.id;
      emoteStore.loadEmoteSet(emoteSet.id, emoteSet.emotes.items);
      console.log(`[7TV] Loaded ${emoteStore.getEmoteCount()} emotes from set:`, emoteSet.name);

      this.startEventStream(userId, emoteSet.id);
    } catch (error) {
      console.error("[7TV] Failed to connect:", error);
      this.scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  disconnect(): void {
    this.clearTimers();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.userId = null;
    this.currentEmoteSetId = null;
    emoteStore.clear();
    console.log("[7TV] Disconnected");
  }

  private startEventStream(userId: string, emoteSetId: string): void {
    const url = new URL(EVENT_API_URL);
    url.searchParams.append("s", "user");
    url.searchParams.append("s", `emote_set.${emoteSetId}`);

    this.abortController = new AbortController();

    fetch(url.toString(), {
      signal: this.abortController.signal,
      headers: {
        "Accept": "text/event-stream",
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        if (!response.body) {
          throw new Error("No response body");
        }

        console.log("[7TV] Event stream connected");
        this.lastHeartbeat = Date.now();
        this.startHeartbeatCheck();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data) {
                  try {
                    const message: EventAPIMessage = JSON.parse(data);
                    this.handleMessage(message);
                  } catch (error) {
                    console.error("[7TV] Failed to parse message:", error);
                  }
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          console.error("[7TV] Event stream error:", error);
          this.scheduleReconnect();
        }
      });
  }

  private handleMessage(message: EventAPIMessage): void {
    switch (message.op) {
      case 0:
        this.lastHeartbeat = Date.now();
        break;
      case 1:
        if (message.d) {
          this.handleDispatch(message.d as { type: string; body: unknown });
        }
        break;
      default:
        break;
    }
  }

  private handleDispatch(dispatch: { type: string; body: unknown }): void {
    switch (dispatch.type) {
      case "user.update": {
        const event = dispatch.body as UserUpdateEvent;
        this.handleUserUpdate(event);
        break;
      }
      case "emote_set.update": {
        const event = dispatch.body as EmoteSetUpdateEvent;
        this.handleEmoteSetUpdate(event);
        break;
      }
      default:
        break;
    }
  }

  private handleUserUpdate(event: UserUpdateEvent): void {
    if (event.updated?.style?.activeEmoteSetId) {
      const newEmoteSetId = event.updated.style.activeEmoteSetId;
      const currentEmoteSetId = emoteStore.getCurrentEmoteSetId();

      if (newEmoteSetId !== currentEmoteSetId) {
        console.log("[7TV] Active emote set changed:", newEmoteSetId);
        this.switchToEmoteSet(newEmoteSetId);
      }
    }
  }

  private async switchToEmoteSet(emoteSetId: string): Promise<void> {
    try {
      const emoteSet = await fetchEmoteSet(emoteSetId);
      if (!emoteSet) {
        console.error("[7TV] Emote set not found:", emoteSetId);
        return;
      }
      emoteStore.loadEmoteSet(emoteSetId, emoteSet.emotes.items);
      console.log(`[7TV] Switched to new emote set: ${emoteSet.name} (${emoteStore.getEmoteCount()} emotes)`);

      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }

      this.currentEmoteSetId = emoteSetId;

      if (this.userId) {
        this.startEventStream(this.userId, emoteSetId);
      }
    } catch (error) {
      console.error("[7TV] Failed to switch emote set:", error);
    }
  }

  private handleEmoteSetUpdate(event: EmoteSetUpdateEvent): void {
    const currentEmoteSetId = emoteStore.getCurrentEmoteSetId();
    if (!currentEmoteSetId || event.id !== currentEmoteSetId) {
      return;
    }

    if (event.pushed) {
      for (const push of event.pushed) {
        if (push.type === "emote") {
          emoteStore.addEmote({
            id: push.value.id,
            alias: push.value.alias,
            emote: push.value.emote,
            flags: { zeroWidth: false },
          });
          console.log("[7TV] Emote added:", push.value.alias);
        }
      }
    }

    if (event.pulled) {
      for (const pull of event.pulled) {
        if (pull.type === "emote") {
          emoteStore.removeEmote(pull.old_value.id);
          console.log("[7TV] Emote removed:", pull.old_value.alias);
        }
      }
    }

    if (event.updated) {
      for (const update of event.updated) {
        if (update.type === "emote") {
          emoteStore.updateAlias(update.value.id, update.value.alias);
          console.log("[7TV] Emote renamed:", update.old_value.alias, "->", update.value.alias);
        }
      }
    }
  }

  private startHeartbeatCheck(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastHeartbeat > 45000) {
        console.warn("[7TV] Heartbeat timeout, reconnecting...");
        if (this.abortController) {
          this.abortController.abort();
          this.abortController = null;
        }
        this.scheduleReconnect();
      }
    }, 15000);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.userId) {
        console.log("[7TV] Reconnecting...");
        this.connect(this.userId);
      }
    }, 5000);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const sevenTVEventClient = new SevenTVEventClient();
