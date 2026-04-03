/**
 * TwirChat — main process entry point
 *
 * Спринт 2: monorepo, UUID client identity, BackendConnection WS, Kick via backend.
 */

import { initDb } from "./store/db";
import { getClientSecret } from "./store/client-secret";
import { BackendConnection } from "./backend-connection";
import { ChatAggregator } from "./chat/aggregator";
import {
  startOverlayServer,
  pushOverlayMessage,
  pushOverlayEvent,
} from "./overlay-server";
import { logger } from "@twirchat/shared/logger";
import type { NormalizedChatMessage, NormalizedEvent } from "@twirchat/shared/types";
import { sevenTVService } from "./seventv";

const log = logger("main");

// ============================================================
// Инициализация
// ============================================================

log.info("Starting...");

// 1. База данных — должна быть первой, генерирует/читает секрет
initDb();
log.info("Database ready");

// 2. Читаем/генерируем UUID-секрет
const clientSecret = getClientSecret();
log.info(`Client secret: ${clientSecret.slice(0, 8)}...`);

// 3. Подключаемся к backend
const backendConn = new BackendConnection(clientSecret);
backendConn.connect();

// Link 7TV service to backend connection
sevenTVService.sendToBackend = (message) => {
  backendConn.send(message as import("@twirchat/shared").DesktopToBackendMessage);
};

// 4. Агрегатор чата
const aggregator = new ChatAggregator(500);

// 5. OBS Overlay server
const overlayServer = startOverlayServer();

// Роутим входящие WS-сообщения от backend
backendConn.onMessage((msg) => {
  switch (msg.type) {
    case "chat_message":
      aggregator.injectMessage(msg.data as NormalizedChatMessage);
      pushOverlayMessage(msg.data as NormalizedChatMessage);
      break;

    case "chat_event":
      aggregator.injectEvent(msg.data as NormalizedEvent);
      pushOverlayEvent(msg.data as NormalizedEvent);
      break;

    case "platform_status":
      aggregator.injectStatus({ platform: msg.platform, status: msg.status, mode: "anonymous" });
      break;

    case "auth_url":
      // Open the OAuth URL in the system browser
      log.info(`[Auth] Opening ${msg.platform} OAuth URL...`);
      void openBrowser(msg.url);
      break;

    case "auth_success":
      log.info(`[Auth] ${msg.platform} connected as ${msg.username}`);
      break;

    case "auth_error":
      log.error(`[Auth] ${msg.platform} error: ${msg.error}`);
      break;

    case "error":
      log.error(`[Backend] Error: ${msg.message}`);
      break;

    case "pong":
      // heartbeat OK
      break;

    case "seventv_emote_set":
      sevenTVService.handleEmoteSet(msg.platform, msg.channelId, msg.emotes);
      break;

    case "seventv_emote_added":
      sevenTVService.handleEmoteAdded(msg.platform, msg.channelId, msg.emote);
      break;

    case "seventv_emote_removed":
      sevenTVService.handleEmoteRemoved(msg.platform, msg.channelId, msg.emoteId);
      break;

    case "seventv_emote_updated":
      sevenTVService.handleEmoteUpdated(msg.platform, msg.channelId, msg.emoteId, msg.alias);
      break;

    default:
      break;
  }
});

// Логируем все входящие сообщения (для разработки)
aggregator.onMessage((msg) => {
  log.info(
    `[Chat] [${msg.platform}] ${msg.author.displayName}: ${msg.text}`,
  );
});

aggregator.onEvent((event) => {
  log.info(
    `[Event] [${event.platform}] ${event.type}: ${event.user.displayName}`,
  );
});

aggregator.onStatus((status) => {
  log.info(`[Status] ${status.platform}: ${status.status} (${status.mode})`);
});

// Ping backend every 30s to keep WS alive
setInterval(() => {
  backendConn.send({ type: "ping" });
}, 30_000);

/**
 * Open a URL in the system default browser.
 * Works cross-platform (Linux/macOS/Windows).
 */
async function openBrowser(url: string): Promise<void> {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      await Bun.$`open ${url}`;
    } else if (platform === "win32") {
      await Bun.$`start ${url}`;
    } else {
      // Linux / other
      await Bun.$`xdg-open ${url}`;
    }
  } catch (err) {
    log.error(`[Auth] Failed to open browser: ${err}`);
    log.info(`[Auth] Please open manually: ${url}`);
  }
}

export { aggregator, backendConn, clientSecret, overlayServer };

log.info("Ready.");
