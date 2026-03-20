/**
 * Chatrix — main process entry point
 *
 * Спринт 2: monorepo, UUID client identity, BackendConnection WS, Kick via backend.
 */

import { initDb } from "./store/db";
import { getClientSecret } from "./store/client-secret";
import { BackendConnection } from "./backend-connection";
import { ChatAggregator } from "./chat/aggregator";
import { startOverlayServer, pushOverlayMessage, pushOverlayEvent } from "./overlay-server";

// ============================================================
// Инициализация
// ============================================================

console.log("[Chatrix] Starting...");

// 1. База данных — должна быть первой, генерирует/читает секрет
initDb();
console.log("[Chatrix] Database ready");

// 2. Читаем/генерируем UUID-секрет
const clientSecret = getClientSecret();
console.log(`[Chatrix] Client secret: ${clientSecret.slice(0, 8)}...`);

// 3. Подключаемся к backend
const backendConn = new BackendConnection(clientSecret);
backendConn.connect();

// 4. Агрегатор чата
const aggregator = new ChatAggregator(500);

// 5. OBS Overlay server
const overlayServer = startOverlayServer();

// Роутим входящие WS-сообщения от backend
backendConn.onMessage((msg) => {
  switch (msg.type) {
    case "chat_message":
      aggregator.injectMessage(msg.data);
      pushOverlayMessage(msg.data);
      break;

    case "chat_event":
      aggregator.injectEvent(msg.data);
      pushOverlayEvent(msg.data);
      break;

    case "platform_status":
      aggregator.injectStatus(msg.data);
      break;

    case "auth_url":
      // Open the OAuth URL in the system browser
      console.log(`[Auth] Opening ${msg.platform} OAuth URL...`);
      void openBrowser(msg.url);
      break;

    case "auth_success":
      console.log(`[Auth] ${msg.platform} connected as ${msg.username}`);
      break;

    case "auth_error":
      console.error(`[Auth] ${msg.platform} error: ${msg.error}`);
      break;

    case "error":
      console.error(`[Backend] Error: ${msg.message}`);
      break;

    case "pong":
      // heartbeat OK
      break;

    default:
      break;
  }
});

// Логируем все входящие сообщения (для разработки)
aggregator.onMessage((msg) => {
  console.log(`[Chat] [${msg.platform}] ${msg.author.displayName}: ${msg.text}`);
});

aggregator.onEvent((event) => {
  console.log(`[Event] [${event.platform}] ${event.type}: ${event.user.displayName}`);
});

aggregator.onStatus((status) => {
  console.log(`[Status] ${status.platform}: ${status.status} (${status.mode})`);
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
    console.error(`[Auth] Failed to open browser: ${err}`);
    console.log(`[Auth] Please open manually: ${url}`);
  }
}

export { aggregator, backendConn, clientSecret, overlayServer };

console.log("[Chatrix] Ready.");

