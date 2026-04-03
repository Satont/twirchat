import type { ServerWebSocket } from "bun";
import type { DesktopToBackendMessage } from "@twirchat/shared";
import { connectionManager, type WsData } from "./connection-manager.ts";
import { ClientStore } from "../db/index.ts";
import { startKickOAuth } from "../auth/kick.ts";
import { buildTwitchAuthUrl } from "../auth/twitch.ts";
import { AccountStore } from "../db/index.ts";
import { logger } from "@twirchat/shared/logger";
import { config } from "../config.ts";
import { sevenTVManager } from "../seventv/index.ts";
import type { BackendToDesktopMessage } from "@twirchat/shared";

const log = logger("ws");

// Setup 7TV manager to send messages to clients
sevenTVManager.sendToClient = (clientSecret: string, message: unknown) => {
  connectionManager.send(clientSecret, message as BackendToDesktopMessage);
};

export async function handleWsOpen(ws: ServerWebSocket<WsData>): Promise<void> {
  log.info("WebSocket opened", { client: ws.data.clientSecret.slice(0, 8) });
  connectionManager.register(ws);
  await ClientStore.touch(ws.data.clientSecret);
}

export function handleWsClose(ws: ServerWebSocket<WsData>): void {
  connectionManager.remove(ws);
  // Cleanup 7TV subscriptions for this client
  sevenTVManager.cleanupClient(ws.data.clientSecret);
}

export async function handleWsMessage(
  ws: ServerWebSocket<WsData>,
  raw: string | Buffer,
): Promise<void> {
  let msg: DesktopToBackendMessage;

  try {
    msg = JSON.parse(
      typeof raw === "string" ? raw : raw.toString(),
    ) as DesktopToBackendMessage;
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
          ws.send(
            JSON.stringify({
              type: "auth_error",
              platform: "kick",
              error: String(err),
            }),
          );
        }
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `auth_start: unsupported platform ${msg.platform}`,
          }),
        );
      }
      break;
    }

    case "auth_start_twitch": {
      try {
        // Legacy WS-based flow - uses backend redirect URI
        const { url } = buildTwitchAuthUrl(msg.codeChallenge, msg.state, config.TWITCH_REDIRECT_URI);
        ws.send(JSON.stringify({ type: "auth_url", platform: "twitch", url }));
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "auth_error",
            platform: "twitch",
            error: String(err),
          }),
        );
      }
      break;
    }

    case "auth_logout": {
      try {
        await AccountStore.delete(ws.data.clientSecret, msg.platform);
        log.info("Logout", {
          platform: msg.platform,
          client: ws.data.clientSecret.slice(0, 8),
        });
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `auth_logout failed: ${String(err)}`,
          }),
        );
      }
      break;
    }

    case "send_message": {
      // send_message via backend will be handled per-platform when platform adapters are added server-side
      ws.send(
        JSON.stringify({
          type: "error",
          message: "send_message not yet supported",
        }),
      );
      break;
    }

    case "channel_join":
    case "channel_leave":
      // Channel tracking — no-op for now, will be used for backend-managed subscriptions
      break;

    case "seventv_subscribe": {
      try {
        await sevenTVManager.subscribeClient(
          ws.data.clientSecret,
          msg.platform,
          msg.channelId,
        );
      } catch (err) {
        log.error("7TV subscribe error", { error: String(err) });
        ws.send(
          JSON.stringify({
            type: "error",
            message: `7TV subscribe failed: ${String(err)}`,
          }),
        );
      }
      break;
    }

    case "seventv_unsubscribe": {
      try {
        sevenTVManager.unsubscribeClient(
          ws.data.clientSecret,
          msg.platform,
          msg.channelId,
        );
      } catch (err) {
        log.error("7TV unsubscribe error", { error: String(err) });
      }
      break;
    }

    case "seventv_resubscribe": {
      // Handle reconnect - client sends list of channels to resubscribe
      try {
        for (const sub of msg.subscriptions) {
          await sevenTVManager.subscribeClient(
            ws.data.clientSecret,
            sub.platform,
            sub.channelId,
          );
        }
      } catch (err) {
        log.error("7TV resubscribe error", { error: String(err) });
      }
      break;
    }

    default:
      ws.send(
        JSON.stringify({
          type: "error",
          message: `Unknown message type: ${(msg as { type: string }).type}`,
        }),
      );
  }
}
