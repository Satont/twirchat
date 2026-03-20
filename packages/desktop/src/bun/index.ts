/**
 * TwirChat — Electrobun main process entry point
 *
 * Responsibilities:
 *  - Initialise SQLite DB and client secret
 *  - Connect to the backend service via WebSocket
 *  - Aggregate incoming chat messages / events
 *  - Run the OBS overlay HTTP+WS server
 *  - Create the main BrowserWindow with the Vue UI
 *  - Bridge backend messages into the webview via Electrobun RPC
 *  - Handle RPC requests coming from the webview (accounts, settings, auth…)
 */

import { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";

import { initDb } from "../store/db";
import { getClientSecret } from "../store/client-secret";
import { AccountStore, SettingsStore } from "../store";
import { BackendConnection } from "../backend-connection";
import { ChatAggregator } from "../chat/aggregator";
import {
  startOverlayServer,
  pushOverlayMessage,
  pushOverlayEvent,
} from "../overlay-server";

import type { TwirChatRPCSchema, WebviewSender } from "../shared/rpc";

// ============================================================
// 1. Initialisation
// ============================================================

console.log("[TwirChat] Starting...");

initDb();
console.log("[TwirChat] Database ready");

const clientSecret = getClientSecret();
console.log(`[TwirChat] Client secret: ${clientSecret.slice(0, 8)}...`);

const backendConn = new BackendConnection(clientSecret);
const aggregator = new ChatAggregator(500);

startOverlayServer();

// ============================================================
// 2. Define Electrobun RPC (bun side)
// ============================================================

const rpc = defineElectrobunRPC<TwirChatRPCSchema>("bun", {
  handlers: {
    // --- Requests from the webview ---
    requests: {
      getAccounts: () => AccountStore.findAll(),

      getSettings: () => SettingsStore.get(),

      saveSettings: (params) => {
        SettingsStore.set(params);
      },

      authStart: ({ platform }) => {
        backendConn.send({ type: "auth_start", platform });
      },

      authLogout: ({ platform }) => {
        backendConn.send({ type: "auth_logout", platform });
        AccountStore.deleteByPlatform(platform);
      },

      joinChannel: ({ platform, channelSlug }) => {
        backendConn.send({ type: "channel_join", platform, channelSlug });
      },

      leaveChannel: ({ platform, channelSlug }) => {
        backendConn.send({ type: "channel_leave", platform, channelSlug });
      },

      sendMessage: ({ platform, channelId, text }) => {
        backendConn.send({ type: "send_message", platform, channelId, text });
      },
    },
  },
});

// Typed sender: cast rpc.send to the explicit WebviewSender type so TypeScript
// can resolve the message names without fighting complex generic inference.
const sendToView = rpc.send as unknown as WebviewSender;

// ============================================================
// 3. Main window
// ============================================================

/**
 * In development, check if the Vite HMR server is running on port 5173.
 * If it is, load from there so changes are reflected instantly.
 * In production (or when vite is not running), fall back to views://.
 */
async function resolveWindowUrl(): Promise<string> {
  const viteUrl = "http://localhost:5173";
  try {
    const res = await fetch(viteUrl, { signal: AbortSignal.timeout(500) });
    if (res.ok || res.status < 500) {
      console.log("[TwirChat] Vite dev server detected — using HMR URL");
      return viteUrl;
    }
  } catch {
    // Vite not running — use built assets
  }
  return "views://main/index.html";
}

const windowUrl = await resolveWindowUrl();

const win = new BrowserWindow({
  title: "TwirChat",
  url: windowUrl,
  frame: { x: 0, y: 0, width: 1200, height: 800 },
  rpc,
});

// ============================================================
// 4. Route backend messages → webview
// ============================================================

backendConn.onMessage((msg) => {
  switch (msg.type) {
    case "chat_message":
      aggregator.injectMessage(msg.data);
      pushOverlayMessage(msg.data);
      // Push to the Vue UI
      sendToView.chat_message(msg.data);
      break;

    case "chat_event":
      aggregator.injectEvent(msg.data);
      pushOverlayEvent(msg.data);
      sendToView.chat_event(msg.data);
      break;

    case "platform_status":
      aggregator.injectStatus(msg.data);
      sendToView.platform_status(msg.data);
      break;

    case "auth_url":
      sendToView.auth_url({ platform: msg.platform, url: msg.url });
      void openBrowser(msg.url);
      break;

    case "auth_success":
      sendToView.auth_success({
        platform: msg.platform,
        username: msg.username,
        displayName: msg.displayName,
      });
      break;

    case "auth_error":
      sendToView.auth_error({ platform: msg.platform, error: msg.error });
      break;

    case "pong":
      break;

    case "error":
      console.error(`[Backend] ${msg.message}`);
      break;

    default:
      break;
  }
});

// ============================================================
// 5. Backend connection
// ============================================================

backendConn.connect();

// Keep WS alive
setInterval(() => {
  backendConn.send({ type: "ping" });
}, 30_000);

// Dev logging
aggregator.onMessage((msg) => {
  console.log(
    `[Chat] [${msg.platform}] ${msg.author.displayName}: ${msg.text}`,
  );
});
aggregator.onEvent((ev) => {
  console.log(`[Event] [${ev.platform}] ${ev.type}: ${ev.user.displayName}`);
});
aggregator.onStatus((s) => {
  console.log(`[Status] ${s.platform}: ${s.status} (${s.mode})`);
});

console.log("[TwirChat] Ready.");

// ============================================================
// Helpers
// ============================================================

async function openBrowser(url: string): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await Bun.$`open ${url}`;
    } else if (process.platform === "win32") {
      await Bun.$`start ${url}`;
    } else {
      await Bun.$`xdg-open ${url}`;
    }
  } catch (err) {
    console.error(`[Auth] Failed to open browser: ${err}`);
    console.log(`[Auth] Please open manually: ${url}`);
  }
}

export { win, rpc, aggregator, backendConn };
