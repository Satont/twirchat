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
import {
  AccountStore,
  SettingsStore,
  ChannelStore,
  MessageStore,
  UsernameColorCache,
} from "../store";
import { BackendConnection } from "../backend-connection";
import { ChatAggregator } from "../chat/aggregator";
import {
  startOverlayServer,
  pushOverlayMessage,
  pushOverlayEvent,
} from "../overlay-server";
import { prepareTwitchAuth, getTwitchAuthUrl } from "../auth/twitch";
import { prepareKickAuth, getKickAuthUrl } from "../auth/kick";
import { prepareYouTubeAuth, getYouTubeAuthUrl } from "../auth/youtube";
import { TwitchAdapter } from "../platforms/twitch/adapter";
import { KickAdapter } from "../platforms/kick/adapter";
import { YouTubeAdapter } from "../platforms/youtube/adapter";
import { BACKEND_URL } from "@twirchat/shared/constants";
import { logger } from "@twirchat/shared/logger";

import type { TwirChatRPCSchema, WebviewSender } from "../shared/rpc";
import type {
  StreamStatusResponse,
  UpdateStreamRequest,
  UpdateStreamResponse,
  SearchCategoriesResponse,
} from "@twirchat/shared/protocol";
import type { PlatformStatusInfo } from "@twirchat/shared/types";
import {
  startAuthServer,
  setAuthServerRpcSender,
  setOnAuthSuccessCallback,
} from "../auth";

// ============================================================
// 1. Initialisation
// ============================================================

const log = logger("main");

log.info("Starting...");

initDb();
log.info("Database ready");

const clientSecret = getClientSecret();
log.info("Client secret", { secret: `${clientSecret.slice(0, 8)}...` });

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
// 1c. Set up auth success callback BEFORE starting auth server
// ============================================================

setOnAuthSuccessCallback(async (platform, channelSlug) => {
  log.info("Authentication successful, reconnecting adapter", {
    platform,
    action: "auth",
  });

  const adapter = aggregator.getAdapter(platform);
  if (!adapter) {
    log.warn("No adapter found for platform", { platform, action: "auth" });
    return;
  }

  // Use provided channelSlug or get from saved channels
  const targetChannel = channelSlug || ChannelStore.findByPlatform(platform)[0];
  if (!targetChannel) {
    log.info("No channel specified, skipping reconnection", {
      platform,
      action: "auth",
    });
    return;
  }

  // Disconnect and reconnect to switch to authenticated mode
  try {
    await adapter.disconnect();
    log.info("Adapter disconnected", { platform, action: "auth" });

    // Reconnect to the channel
    await adapter.connect(targetChannel);
    log.info("Adapter reconnected in authenticated mode", {
      platform,
      channel: targetChannel,
      action: "auth",
    });
  } catch (err) {
    log.error("Failed to reconnect adapter", {
      platform,
      error: String(err),
      action: "auth",
    });
  }
});

// Start auth server AFTER setting up the callback
startAuthServer();

// ============================================================
// 2. Define Electrobun RPC (bun side)
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

      authStart: async ({ platform }) => {
        if (platform === "twitch") {
          const { codeChallenge, state } = prepareTwitchAuth();
          const url = await getTwitchAuthUrl(codeChallenge, state);
          void openBrowser(url);
        } else if (platform === "kick") {
          const { codeChallenge, state } = prepareKickAuth();
          const url = await getKickAuthUrl(codeChallenge, state);
          void openBrowser(url);
        } else if (platform === "youtube") {
          const { codeChallenge, state } = prepareYouTubeAuth();
          const url = await getYouTubeAuthUrl(codeChallenge, state);
          void openBrowser(url);
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
          log.warn("No adapter registered for platform", {
            platform,
            action: "joinChannel",
          });
          return;
        }
        ChannelStore.save(platform, channelSlug);
        log.info("Connecting to channel", {
          platform,
          channelSlug,
          action: "joinChannel",
        });
        adapter
          .connect(channelSlug)
          .then(() => {
            log.info("adapter.connect() resolved", {
              platform,
              channelSlug,
              action: "joinChannel",
            });
          })
          .catch((err) => {
            log.error("Failed to connect", {
              platform,
              channelSlug,
              error: String(err),
              action: "joinChannel",
            });
          });
      },

      leaveChannel: ({ platform, channelSlug }) => {
        const adapter = aggregator.getAdapter(platform);
        if (!adapter) {
          log.warn("No adapter registered for platform", {
            platform,
            action: "leaveChannel",
          });
          return;
        }
        ChannelStore.remove(platform, channelSlug);
        adapter.disconnect().catch((err) => {
          log.error("Failed to disconnect", {
            platform,
            error: String(err),
            action: "leaveChannel",
          });
        });
      },

      sendMessage: ({ platform, channelId, text }) => {
        const adapter = aggregator.getAdapter(platform);
        if (!adapter) {
          log.warn("No adapter registered for platform", {
            platform,
            action: "sendMessage",
          });
          return;
        }
        adapter.sendMessage(channelId, text).catch((err) => {
          log.error("Failed to send message", {
            platform,
            error: String(err),
            action: "sendMessage",
          });
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
          const account = AccountStore.findByPlatform(
            ch.platform as import("@twirchat/shared/types").Platform,
          );
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

// Pass the RPC sender to the auth server so it can notify the webview of auth events
setAuthServerRpcSender(sendToView);

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
    log.info("Running in dev channel — skipping Vite server check");
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
  log.info("Chat message", {
    platform: msg.platform,
    author: msg.author.displayName,
    text: msg.text,
  });
});

aggregator.onEvent((ev) => {
  pushOverlayEvent(ev);
  sendToView.chat_event(ev);
  log.info("Event", {
    platform: ev.platform,
    type: ev.type,
    user: ev.user.displayName,
  });
});

aggregator.onStatus((s) => {
  currentStatuses.set(s.platform, s);
  sendToView.platform_status(s);
  log.info("Status", {
    platform: s.platform,
    status: s.status,
    mode: s.mode,
    channel: s.channelLogin,
  });
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
      log.error("Backend error", { message: msg.message });
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
// 7. Auto-connect to persisted channels and authenticated accounts
// ============================================================

const savedChannels = ChannelStore.findAll();
const connectedPlatforms = new Set<string>();

// First, connect to explicitly saved channels
for (const [platform, slugs] of Object.entries(savedChannels)) {
  for (const slug of slugs ?? []) {
    const adapter = aggregator.getAdapter(
      platform as import("@twirchat/shared/types").Platform,
    );
    if (!adapter) {
      log.warn("No adapter for platform", { platform, action: "AutoConnect" });
      continue;
    }
    connectedPlatforms.add(platform);
    log.info("Connecting to channel", {
      platform,
      slug,
      action: "AutoConnect",
    });
    adapter
      .connect(slug)
      .then(() => {
        log.info("Connected", { platform, slug, action: "AutoConnect" });
      })
      .catch((err) => {
        log.error("Failed to connect", {
          platform,
          slug,
          error: String(err),
          action: "AutoConnect",
        });
      });
  }
}

// For YouTube and Kick, auto-connect to user's own channel if authenticated but not yet connected
const accounts = AccountStore.findAll();
for (const account of accounts) {
  if (account.platform === "youtube" || account.platform === "kick") {
    // Skip if already connected via saved channels
    if (connectedPlatforms.has(account.platform)) {
      continue;
    }

    const adapter = aggregator.getAdapter(account.platform);
    if (!adapter) {
      log.warn("No adapter for platform", {
        platform: account.platform,
        action: "AutoConnectAccount",
      });
      continue;
    }

    // Auto-connect to user's own channel
    const channelSlug = account.username;
    log.info("Auto-connecting to user's channel", {
      platform: account.platform,
      channel: channelSlug,
      action: "AutoConnectAccount",
    });

    // Save the channel for persistence
    ChannelStore.save(account.platform, channelSlug);

    adapter
      .connect(channelSlug)
      .then(() => {
        log.info("Connected to user's channel", {
          platform: account.platform,
          channel: channelSlug,
          action: "AutoConnectAccount",
        });
      })
      .catch((err) => {
        log.error("Failed to connect to user's channel", {
          platform: account.platform,
          channel: channelSlug,
          error: String(err),
          action: "AutoConnectAccount",
        });
      });
  }
}

log.info("Ready");

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
    log.error("Failed to open browser", { error: String(err), action: "auth" });
    log.info("Please open manually", { url, action: "auth" });
  }
}

export { win, rpc, aggregator, backendConn };
