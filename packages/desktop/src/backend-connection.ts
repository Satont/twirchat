import type {
  BackendToDesktopMessage,
  DesktopToBackendMessage,
} from "@twirchat/shared";
import { getBackendWsUrl } from "./runtime-config";
import { logger } from "@twirchat/shared/logger";

const log = logger("backend-connection");

type MessageHandler = (msg: BackendToDesktopMessage) => void;

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Manages the persistent WebSocket connection from desktop to backend.
 * Automatically reconnects with exponential backoff on disconnect.
 */
export class BackendConnection {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectDelay = RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly clientSecret: string) {}

  connect(): void {
    this.stopped = false;
    this._connect();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  send(msg: DesktopToBackendMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      log.warn("Cannot send — not connected");
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private _connect(): void {
    const backendWsUrl = getBackendWsUrl();
    log.info(`Connecting to ${backendWsUrl}...`);

    const ws = new WebSocket(backendWsUrl, {
      headers: {
        "X-Client-Secret": this.clientSecret,
      },
    } as unknown as string[]);
    ws.addEventListener("open", () => {
      log.info("Connected");
      this.reconnectDelay = RECONNECT_DELAY_MS;
      // Send client secret as first message (some implementations prefer headers, but
      // browsers don't support custom WS headers — we'll upgrade when running in Bun)
    });

    ws.addEventListener("message", (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as BackendToDesktopMessage;
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch (err) {
        log.error("Failed to parse message", { error: String(err) });
      }
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      if (!this.stopped) {
        log.info(
          `Disconnected. Reconnecting in ${this.reconnectDelay}ms...`,
        );
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelay = Math.min(
            this.reconnectDelay * 2,
            MAX_RECONNECT_DELAY_MS,
          );
          this._connect();
        }, this.reconnectDelay);
      }
    });

    ws.addEventListener("error", (evt) => {
      log.error("WebSocket error", { event: String(evt) });
    });

    this.ws = ws;
  }
}
