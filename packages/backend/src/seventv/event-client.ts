import { logger } from "@twirchat/shared/logger";

const log = logger("seventv:event");

const SEVENTV_EVENT_API_URL = "wss://events.7tv.io/v3";

export interface SevenTVEventMessage {
  op: number;
  t?: number;
  d?: unknown;
}

export interface SevenTVHello {
  heartbeat_interval: number;
  session_id: string;
  subscription_limit: number;
}

export interface UserUpdateEventNestedField {
  key: string;
  value: unknown;
  old_value?: unknown;
}

export interface UserUpdateEvent {
  id: string;
  updated?: Array<{
    key: string;
    index?: number | null;
    nested?: boolean;
    type?: string;
    // When nested === true, value is an array of UserUpdateEventNestedField.
    // Otherwise, value can be any scalar/object (string, null, object, etc.)
    value?: unknown;
    old_value?: unknown;
  }>;
}

export interface EmoteSetUpdateEvent {
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
        aspectRatio: number;
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
        aspectRatio: number;
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

export type SevenTVEventHandler = (event: {
  type: string;
  body: EmoteSetUpdateEvent | UserUpdateEvent;
}) => void;

export class SevenTVEventClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: Timer | null = null;
  private reconnectTimer: Timer | null = null;
  private sessionId: string | null = null;
  private subscriptionLimit = 0;
  private heartbeatInterval = 0;
  private lastHeartbeat = 0;
  private isConnecting = false;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 30000;
  private readonly baseReconnectDelay = 1000;

  private subscriptions = new Map<
    string,
    { type: string; condition: Record<string, string> }
  >();

  onEvent: SevenTVEventHandler | null = null;
  onConnected: (() => void) | null = null;
  onDisconnected: (() => void) | null = null;

  async connect(): Promise<void> {
    if (this.isConnecting || this.ws) {
      return;
    }

    this.isConnecting = true;
    log.info("Connecting to 7TV EventAPI...");

    try {
      this.ws = new WebSocket(SEVENTV_EVENT_API_URL);

      this.ws.onopen = () => {
        log.info("WebSocket connected");
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data as string);
      };

      this.ws.onclose = (event) => {
        log.info("WebSocket closed", { code: event.code, reason: event.reason });
        this.cleanup();
        
        if (this.shouldReconnect) {
          this.scheduleReconnect(event.code);
        }
      };

      this.ws.onerror = (error) => {
        log.error("WebSocket error", { error: String(error) });
      };
    } catch (error) {
      log.error("Failed to connect", { error: String(error) });
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    log.info("Disconnecting from 7TV EventAPI...");
    this.shouldReconnect = false;
    this.cleanup();
  }

  private cleanup(): void {
    this.isConnecting = false;
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }

    this.onDisconnected?.();
  }

  private handleMessage(data: string): void {
    try {
      const message: SevenTVEventMessage = JSON.parse(data);
      
      // Log ALL raw messages for debugging
      if (message.op === 0) {
        log.info("RAW DISPATCH MESSAGE", { raw: data });
      }
      
      if (message.op !== 2) {
        log.info("7TV EventAPI message received", { op: message.op, type: (message.d as any)?.type });
      }

      switch (message.op) {
        case 1: // Hello
          this.handleHello(message.d as SevenTVHello);
          break;
        case 0: // Dispatch
          if (message.d) {
            const dispatch = message.d as { type: string; body: EmoteSetUpdateEvent | UserUpdateEvent };
            log.info("DISPATCH EVENT RECEIVED", { type: dispatch.type, bodyId: dispatch.body?.id });
            this.onEvent?.(dispatch);
          }
          break;
        case 2: // Heartbeat
          this.lastHeartbeat = Date.now();
          break;
        case 4: // Reconnect
          log.info("Server requested reconnect");
          this.reconnect();
          break;
        case 5: // Ack
          // Acknowledgment, can be logged for debugging
          break;
        case 6: // Error
          log.error("Server error", { data: message.d });
          break;
        case 7: // End of Stream
          const eos = message.d as { code: number; message: string };
          log.info("End of stream", { code: eos.code, message: eos.message });
          break;
        default:
          log.debug("Unknown opcode", { op: message.op });
      }
    } catch (error) {
      log.error("Failed to parse message", { error: String(error), data });
    }
  }

  private handleHello(hello: SevenTVHello): void {
    log.info("Received hello", {
      sessionId: hello.session_id,
      subscriptionLimit: hello.subscription_limit,
      heartbeatInterval: hello.heartbeat_interval,
    });

    this.sessionId = hello.session_id;
    this.subscriptionLimit = hello.subscription_limit;
    this.heartbeatInterval = hello.heartbeat_interval;
    this.lastHeartbeat = Date.now();

    // Start heartbeat
    this.startHeartbeat();

    // Resubscribe to all previous subscriptions
    for (const [id, sub] of this.subscriptions) {
      this.sendSubscribe(sub.type, sub.condition);
    }

    this.reconnectAttempts = 0;
    this.onConnected?.();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    // Check heartbeat every interval / 2
    const checkInterval = this.heartbeatInterval / 2;
    
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastHeartbeat;
      
      // If no heartbeat for 3 intervals, consider connection dead
      if (elapsed > this.heartbeatInterval * 3) {
        log.warn("Heartbeat timeout, reconnecting...");
        this.reconnect();
      }
    }, checkInterval);
  }

  subscribe(type: string, condition: Record<string, string>): void {
    const subId = `${type}:${JSON.stringify(condition)}`;
    
    if (this.subscriptions.has(subId)) {
      return; // Already subscribed
    }

    this.subscriptions.set(subId, { type, condition });
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(type, condition);
    }
  }

  unsubscribe(type: string, condition?: Record<string, string>): void {
    const subId = condition 
      ? `${type}:${JSON.stringify(condition)}`
      : `${type}:*`;
    
    if (condition) {
      this.subscriptions.delete(subId);
    } else {
      // Unsubscribe all of this type
      for (const [id, sub] of this.subscriptions) {
        if (sub.type === type) {
          this.subscriptions.delete(id);
        }
      }
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendUnsubscribe(type, condition);
    }
  }

  private sendSubscribe(type: string, condition: Record<string, string>): void {
    const payload = {
      op: 35,
      d: { type, condition },
    };
    log.info("Sending subscribe", { type, condition, payload: JSON.stringify(payload) });
    this.send(payload);
  }

  private sendUnsubscribe(type: string, condition?: Record<string, string>): void {
    const payload: { op: number; d: { type: string; condition?: Record<string, string> } } = {
      op: 36,
      d: { type },
    };
    
    if (condition) {
      payload.d.condition = condition;
    }
    
    this.send(payload);
  }

  private send(message: SevenTVEventMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private reconnect(): void {
    this.cleanup();
    this.connect();
  }

  private scheduleReconnect(closeCode?: number): void {
    if (!this.shouldReconnect) return;

    // Don't reconnect on certain close codes
    if (closeCode === 4001 || closeCode === 4002 || closeCode === 4003 || closeCode === 4004) {
      log.error("Fatal close code, not reconnecting", { code: closeCode });
      return;
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );

    this.reconnectAttempts++;

    log.info("Scheduling reconnect", { delay, attempt: this.reconnectAttempts });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get subscriptionCount(): number {
    return this.subscriptions.size;
  }
}

export const sevenTVEventClient = new SevenTVEventClient();
