import type { ServerWebSocket } from "bun";
import type { BackendToDesktopMessage } from "@twirchat/shared";

export interface WsData {
  clientSecret: string;
}

/** Manages active WebSocket connections from desktop clients */
class ConnectionManager {
  private connections = new Map<string, ServerWebSocket<WsData>>();

  register(ws: ServerWebSocket<WsData>): void {
    this.connections.set(ws.data.clientSecret, ws);
    console.log(
      `[WS] Client connected: ${ws.data.clientSecret.slice(0, 8)}...`,
    );
  }

  remove(ws: ServerWebSocket<WsData>): void {
    this.connections.delete(ws.data.clientSecret);
    console.log(
      `[WS] Client disconnected: ${ws.data.clientSecret.slice(0, 8)}...`,
    );
  }

  send(clientSecret: string, message: BackendToDesktopMessage): boolean {
    const ws = this.connections.get(clientSecret);
    if (!ws) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  broadcast(message: BackendToDesktopMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.connections.values()) {
      ws.send(payload);
    }
  }

  has(clientSecret: string): boolean {
    return this.connections.has(clientSecret);
  }

  get size(): number {
    return this.connections.size;
  }
}

export const connectionManager = new ConnectionManager();
