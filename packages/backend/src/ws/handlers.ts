import type { ServerWebSocket } from "bun";
import type { DesktopToBackendMessage } from "@chatrix/shared";
import { connectionManager, type WsData } from "./connection-manager.ts";
import { ClientStore } from "../db/index.ts";
import { startKickOAuth } from "../auth/kick.ts";
import { AccountStore } from "../db/index.ts";

export async function handleWsOpen(ws: ServerWebSocket<WsData>): Promise<void> {
  connectionManager.register(ws);
  await ClientStore.touch(ws.data.clientSecret);
}

export function handleWsClose(ws: ServerWebSocket<WsData>): void {
  connectionManager.remove(ws);
}

export async function handleWsMessage(
  ws: ServerWebSocket<WsData>,
  raw: string | Buffer
): Promise<void> {
  let msg: DesktopToBackendMessage;

  try {
    msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as DesktopToBackendMessage;
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    return;
  }

  switch (msg.type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong" }));
      break;

    case "auth_start": {
      if (msg.platform === "kick") {
        try {
          const url = await startKickOAuth(ws.data.clientSecret);
          ws.send(JSON.stringify({ type: "auth_url", platform: "kick", url }));
        } catch (err) {
          ws.send(JSON.stringify({ type: "auth_error", platform: "kick", error: String(err) }));
        }
      } else {
        ws.send(JSON.stringify({ type: "error", message: `auth_start: unsupported platform ${msg.platform}` }));
      }
      break;
    }

    case "auth_logout": {
      try {
        await AccountStore.delete(ws.data.clientSecret, msg.platform);
        console.log(`[WS] Logout ${msg.platform} for client ${ws.data.clientSecret.slice(0, 8)}...`);
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `auth_logout failed: ${String(err)}` }));
      }
      break;
    }

    case "send_message": {
      // send_message via backend will be handled per-platform when platform adapters are added server-side
      ws.send(JSON.stringify({ type: "error", message: "send_message not yet supported" }));
      break;
    }

    case "channel_join":
    case "channel_leave":
      // Channel tracking — no-op for now, will be used for backend-managed subscriptions
      break;

    default:
      ws.send(JSON.stringify({ type: "error", message: `Unknown message type: ${(msg as { type: string }).type}` }));
  }
}
