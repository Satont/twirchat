/**
 * TwirChat — Electrobun main process entry point
 *
 * Responsibilities:
 *  - Initialise SQLite DB and client secret
 *  - Connect to the backend service via WebSocket (auth flows only)
 *  - Instantiate and register platform adapters (Twitch, Kick, YouTube)
 *  - Aggregate incoming chat messages / events via ChatAggregator
 *  - Run the OBS overlay HTTP+WS server
 *  - Create the main BrowserWindow with the Vue UI
 *  - Bridge adapter events into the webview via Electrobun RPC
 *  - Handle RPC requests coming from the webview (accounts, settings, auth…)
 */

import { BrowserWindow, defineElectrobunRPC, Updater } from "electrobun/bun";

import { initDb } from "../store/db";
import { getClientSecret } from "../store/client-secret";
import { AccountStore, SettingsStore, ChannelStore, MessageStore, UsernameColorCache } from "../store";
import { BackendConnection } from "../backend-connection";
import { ChatAggregator } from "../chat/aggregator";
import {
  startOverlayServer,
  pushOverlayMessage,
  pushOverlayEvent,
} from "../overlay-server";
import { prepareTwitchAuth } from "../auth/twitch";
import { TwitchAdapter } from "../platforms/twitch/adapter";
import { KickAdapter } from "../platforms/kick/adapter";
import { YouTubeAdapter } from "../platforms/youtube/adapter";
import { BACKEND_URL } from "@twirchat/shared/constants";

import type { TwirChatRPCSchema, WebviewSender } from "../shared/rpc";
import type {
  StreamStatusResponse,
  UpdateStreamRequest,
  UpdateStreamResponse,
  SearchCategoriesResponse,
} from "@twirchat/shared/protocol";
import type { PlatformStatusInfo } from "@twirchat/shared/types";

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

// Register platform adapters — these run entirely in the Bun process.
// YouTube uses gRPC (cannot run in webview/browser context).
const twitchAdapter = new TwitchAdapter();
const kickAdapter = new KickAdapter();
const youtubeAdapter = new YouTubeAdapter();
aggregator.registerAdapter(twitchAdapter);
aggregator.registerAdapter(kickAdapter);
aggregator.registerAdapter(youtubeAdapter);

startOverlayServer();

// ============================================================
// 1b. Track latest adapter status per platform
// ============================================================

const currentStatuses = new Map<string, PlatformStatusInfo>();

// ============================================================
// 2. Define Electrobun RPC (bun side)
// ============================================================

const rpc = defineElectrobunRPC<TwirChatRPCSchema>("bun", {
  maxRequestTime: 10_000,
  handlers: {
    // --- Requests from the webview ---
    requests: {
      getAccounts: () => AccountStore.findAll(),

      getSettings: () => SettingsStore.get(),

      saveSettings: (params) => {
        SettingsStore.set(params);
      },

      getChannels: () => ChannelStore.findAll(),

      authStart: ({ platform }) => {
        if (platform === "twitch") {
          const { codeChallenge, state } = prepareTwitchAuth();
          backendConn.send({ type: "auth_start_twitch", codeChallenge, state });
        } else {
          backendConn.send({ type: "auth_start", platform });
        }
      },

      authLogout: ({ platform }) => {
        backendConn.send({ type: "auth_logout", platform });
        AccountStore.deleteByPlatform(platform);
      },

      joinChannel: ({ platform, channelSlug }) => {
        const adapter = aggregator.getAdapter(platform);
        if (!adapter) {
          console.warn(
            `[joinChannel] No adapter registered for platform: ${platform}`,
          );
          return;
        }
        ChannelStore.save(platform, channelSlug);
        console.log(`[joinChannel] Connecting ${platform} to "${channelSlug}"...`);
        adapter.connect(channelSlug).then(() => {
          console.log(`[joinChannel] adapter.connect() resolved for ${platform}:"${channelSlug}"`);
        }).catch((err) => {
          console.error(
            `[joinChannel] Failed to connect ${platform} to "${channelSlug}":`,
            err,
          );
        });
      },

      leaveChannel: ({ platform, channelSlug }) => {
        const adapter = aggregator.getAdapter(platform);
        if (!adapter) {
          console.warn(
            `[leaveChannel] No adapter registered for platform: ${platform}`,
          );
          return;
        }
        ChannelStore.remove(platform, channelSlug);
        adapter.disconnect().catch((err) => {
          console.error(
            `[leaveChannel] Failed to disconnect ${platform}:`,
            err,
          );
        });
      },

      sendMessage: ({ platform, channelId, text }) => {
        const adapter = aggregator.getAdapter(platform);
        if (!adapter) {
          console.warn(
            `[sendMessage] No adapter registered for platform: ${platform}`,
          );
          return;
        }
        adapter.sendMessage(channelId, text).catch((err) => {
          console.error(`[sendMessage] Failed to send on ${platform}:`, err);
        });
      },

      getStreamStatus: async ({ platform, channelId }) => {
        const res = await fetch(
          `${BACKEND_URL}/api/stream-status?platform=${platform}&channelId=${encodeURIComponent(channelId)}`,
          { headers: { "X-Client-Secret": clientSecret } },
        );
        if (!res.ok) throw new Error(`stream-status: ${res.status}`);
        return (await res.json()) as StreamStatusResponse;
      },

      updateStream: async (params) => {
        const account = AccountStore.findByPlatform(params.platform);
        if (!account) throw new Error(`No ${params.platform} account found`);
        const tokens = AccountStore.getTokens(account.id);
        if (!tokens?.accessToken)
          throw new Error(`No access token for ${params.platform}`);

        const body: UpdateStreamRequest = {
          ...params,
          userAccessToken: tokens.accessToken,
        };

        const res = await fetch(`${BACKEND_URL}/api/update-stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Secret": clientSecret,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`update-stream: ${res.status}`);
        return (await res.json()) as UpdateStreamResponse;
      },

      searchCategories: async ({ platform, query }) => {
        const res = await fetch(
          `${BACKEND_URL}/api/search-categories?platform=${platform}&query=${encodeURIComponent(query)}`,
          { headers: { "X-Client-Secret": clientSecret } },
        );
        if (!res.ok) throw new Error(`search-categories: ${res.status}`);
        return (await res.json()) as SearchCategoriesResponse;
      },

      getChannelsStatus: async ({ channels }) => {
        // Attach user access tokens for platforms where the user is authenticated
        const enriched = channels.map((ch) => {
          const account = AccountStore.findByPlatform(ch.platform as import("@twirchat/shared/types").Platform);
          if (account) {
            const tokens = AccountStore.getTokens(account.id);
            if (tokens?.accessToken) {
              return { ...ch, userAccessToken: tokens.accessToken };
            }
          }
          return ch;
        });

        const res = await fetch(`${BACKEND_URL}/api/channels-status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Secret": clientSecret,
          },
          body: JSON.stringify({ channels: enriched }),
        });
        if (!res.ok) throw new Error(`channels-status: ${res.status}`);
        return (await res.json()) as import("@twirchat/shared/protocol").ChannelsStatusResponse;
      },

      getStatuses: () => [...currentStatuses.values()],

      getRecentMessages: (params) => {
        const limit = (params as { limit?: number } | null)?.limit ?? 100;
        return MessageStore.getRecent(limit);
      },

      getUsernameColor: ({ platform, username }) => {
        return UsernameColorCache.get(platform, username) ?? null;
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
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    console.log(
      "[TwirChat] Running in dev channel — skipping Vite server check",
    );
    return "http://localhost:5173";
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

win.webview.openDevTools();

// ============================================================
// 4. Route adapter events → webview + overlay
// ============================================================

aggregator.onMessage((msg) => {
  MessageStore.save(msg);
  UsernameColorCache.addMessage(msg);
  pushOverlayMessage(msg);
  sendToView.chat_message(msg);
  console.log(
    `[Chat] [${msg.platform}] ${msg.author.displayName}: ${msg.text}`,
  );
});

aggregator.onEvent((ev) => {
  pushOverlayEvent(ev);
  sendToView.chat_event(ev);
  console.log(`[Event] [${ev.platform}] ${ev.type}: ${ev.user.displayName}`);
});

aggregator.onStatus((s) => {
  currentStatuses.set(s.platform, s);
  sendToView.platform_status(s);
  console.log(`[Status] ${s.platform}: ${s.status} (${s.mode})${s.channelLogin ? ` channel=${s.channelLogin}` : ""}`);
});

// ============================================================
// 5. Route backend messages → webview (auth flows only)
// ============================================================

backendConn.onMessage((msg) => {
  switch (msg.type) {
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
// 6. Backend connection
// ============================================================

backendConn.connect();

// Keep WS alive
setInterval(() => {
  backendConn.send({ type: "ping" });
}, 30_000);

// ============================================================
// 7. Auto-connect to persisted channels
// ============================================================

const savedChannels = ChannelStore.findAll();
for (const [platform, slugs] of Object.entries(savedChannels)) {
  for (const slug of slugs ?? []) {
    const adapter = aggregator.getAdapter(platform as import("@twirchat/shared/types").Platform);
    if (!adapter) {
      console.warn(`[AutoConnect] No adapter for platform: ${platform}`);
      continue;
    }
    console.log(`[AutoConnect] Connecting ${platform} to "${slug}"...`);
    adapter.connect(slug).then(() => {
      console.log(`[AutoConnect] Connected ${platform}:"${slug}"`);
    }).catch((err) => {
      console.error(`[AutoConnect] Failed ${platform}:"${slug}":`, err);
    });
  }
}

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
