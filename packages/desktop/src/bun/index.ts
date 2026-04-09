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

process.on('uncaughtException', (err) => {
  log.error('UNCAUGHT EXCEPTION — process will crash', {
    error: String(err),
    stack: err?.stack ?? 'no stack',
    name: err?.name ?? 'unknown',
  })
  console.error('UNCAUGHT EXCEPTION:', err)
})

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  log.error('UNHANDLED REJECTION — promise rejected without .catch()', {
    error: String(err),
    stack: err?.stack ?? 'no stack',
    name: err?.name ?? 'unknown',
  })
  console.error('UNHANDLED REJECTION:', reason)
})

import { BrowserWindow, BuildConfig, Updater, Utils, defineElectrobunRPC } from 'electrobun/bun'

import { getDb, initDb } from '../store/db'
import { getClientSecret } from '../store/client-secret'
import {
  AccountStore,
  ChannelStore,
  MessageStore,
  SettingsStore,
  UsernameColorCache,
} from '../store'
import { BackendConnection } from '../backend-connection'
import { ChatAggregator } from '../chat/aggregator'
import { pushOverlayEvent, pushOverlayMessage, startOverlayServer } from '../overlay-server'
import { getTwitchAuthUrl, prepareTwitchAuth } from '../auth/twitch'
import { getKickAuthUrl, prepareKickAuth } from '../auth/kick'
import { getYouTubeAuthUrl, prepareYouTubeAuth } from '../auth/youtube'
import { TwitchAdapter } from '../platforms/twitch/adapter'
import { KickAdapter } from '../platforms/kick/adapter'
import { YouTubeAdapter } from '../platforms/youtube/adapter'
import { sevenTVService } from '../seventv'
import { WatchedChannelManager } from '../watched-channels/manager'
import { WatchedChannelsLayoutStore } from '../store/watched-channels-layout-store'
import { logger } from '@twirchat/shared/logger'
import type { DesktopToBackendMessage } from '@twirchat/shared'
import type {
  NormalizedChatMessage,
  LayoutNode,
  PanelNode,
  Platform,
  PlatformStatusInfo,
  SplitDirection,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'

// Set process title to show "TwirChat" instead of "bun" in process managers
process.title = 'TwirChat'

import type { TwirChatRPCSchema, WebviewSender } from '../shared/rpc'
import type {
  ChannelsStatusResponse,
  StreamStatusResponse,
  UpdateStreamRequest,
  UpdateStreamResponse,
  SearchCategoriesResponse,
} from '@twirchat/shared/protocol'
import { startAuthServer, setAuthServerRpcSender, setOnAuthSuccessCallback } from '../auth'
import { setRuntimeConfig, getRuntimeConfig, backendFetch } from '../runtime-config'

// ============================================================
// 1. Load runtime config from build.json
// ============================================================

const buildConfig = await BuildConfig.get()
const runtimeConfig = buildConfig.runtime as {
  backendUrl?: string
  backendWsUrl?: string
  nodeEnv?: string
}

// Set runtime config (not baked into build, loaded at runtime)
setRuntimeConfig({
  backendUrl: runtimeConfig.backendUrl,
  backendWsUrl: runtimeConfig.backendWsUrl,
  nodeEnv: runtimeConfig.nodeEnv,
})

// Also set process.env for backward compatibility with other modules
const currentConfig = getRuntimeConfig()
if (currentConfig.backendUrl) {
  process.env['CHATRIX_BACKEND_URL'] = currentConfig.backendUrl
}
if (currentConfig.backendWsUrl) {
  process.env['CHATRIX_BACKEND_WS_URL'] = currentConfig.backendWsUrl
}
if (currentConfig.nodeEnv) {
  process.env['NODE_ENV'] = currentConfig.nodeEnv
}

// ============================================================
// 2. Initialisation
// ============================================================

const log = logger('main')

log.info('Starting...')

initDb()
log.info('Database ready')

const clientSecret = getClientSecret()
log.info('Client secret', { secret: `${clientSecret.slice(0, 8)}...` })

// Make the secret available to backendFetch() used throughout the process
setRuntimeConfig({ clientSecret })

const backendConn = new BackendConnection(clientSecret)
const aggregator = new ChatAggregator(500)

// Link 7TV service to backend connection
sevenTVService.sendToBackend = (message) => {
  backendConn.send(message as DesktopToBackendMessage)
}

// Register platform adapters — these run entirely in the Bun process.
// YouTube uses gRPC (cannot run in webview/browser context).
const twitchAdapter = new TwitchAdapter()
const kickAdapter = new KickAdapter()
const youtubeAdapter = new YouTubeAdapter()
aggregator.registerAdapter(twitchAdapter)
aggregator.registerAdapter(kickAdapter)
aggregator.registerAdapter(youtubeAdapter)

startOverlayServer()

const watchedChannelManager = new WatchedChannelManager()

// ============================================================
// 1c. Set up auth success callback BEFORE starting auth server
// ============================================================

setOnAuthSuccessCallback(async (platform, channelSlug) => {
  log.info('Authentication successful, reconnecting adapter', {
    action: 'auth',
    platform,
  })

  const adapter = aggregator.getAdapter(platform)
  if (!adapter) {
    log.warn('No adapter found for platform', { action: 'auth', platform })
    return
  }

  // Use provided channelSlug or get from saved channels
  const targetChannel = channelSlug || ChannelStore.findByPlatform(platform)[0]
  if (!targetChannel) {
    log.info('No channel specified, skipping reconnection', {
      action: 'auth',
      platform,
    })
    return
  }

  // Disconnect and reconnect to switch to authenticated mode
  try {
    await adapter.disconnect()
    log.info('Adapter disconnected', { action: 'auth', platform })

    // Reconnect to the channel
    await adapter.connect(targetChannel)
    log.info('Adapter reconnected in authenticated mode', {
      action: 'auth',
      channel: targetChannel,
      platform,
    })
    // Subscribe to 7TV emotes for this channel
    // For Kick, use broadcasterUserId instead of slug
    let sevenTvChannelId = targetChannel
    if (platform === 'kick') {
      const kickAdapterCast = adapter as KickAdapter
      const broadcasterUserId = kickAdapterCast.getBroadcasterUserId()
      if (broadcasterUserId) {
        sevenTvChannelId = String(broadcasterUserId)
      }
    }
    sevenTVService.subscribeToChannel(platform, sevenTvChannelId).catch((error) => {
      log.error('Failed to subscribe to 7TV', {
        platform,
        channelSlug: sevenTvChannelId,
        error: String(error),
        action: '7tv',
      })
    })
  } catch (error) {
    log.error('Failed to reconnect adapter', {
      platform,
      error: String(error),
      action: 'auth',
    })
  }

  // Also reconnect any watched channel adapters for this platform
  // So they switch from anonymous → authenticated mode immediately
  await watchedChannelManager.reconnectByPlatform(platform).catch((error) => {
    log.error('Failed to reconnect watched channels after auth', {
      platform,
      error: String(error),
    })
  })
})

// Start auth server AFTER setting up the callback
startAuthServer()

// ============================================================
// 2. Define Electrobun RPC (bun side)
// ============================================================

const currentStatuses = new Map<string, PlatformStatusInfo>()

// ============================================================
// 2. Define Electrobun RPC (bun side)
// ============================================================

const rpc = defineElectrobunRPC<TwirChatRPCSchema>('bun', {
  handlers: {
    // --- Requests from the webview ---
    requests: {
      getAccounts: () => AccountStore.findAll(),

      getSettings: () => SettingsStore.get(),

      saveSettings: (params) => {
        SettingsStore.set(params)
      },

      getChannels: () => ChannelStore.findAll(),

      authStart: async ({ platform }) => {
        if (platform === 'twitch') {
          const { codeChallenge, state } = prepareTwitchAuth()
          const url = await getTwitchAuthUrl(codeChallenge, state)
          openBrowser(url)
        } else if (platform === 'kick') {
          const { codeChallenge, state } = prepareKickAuth()
          const url = await getKickAuthUrl(codeChallenge, state)
          openBrowser(url)
        } else if (platform === 'youtube') {
          const { codeChallenge, state } = prepareYouTubeAuth()
          const url = await getYouTubeAuthUrl(codeChallenge, state)
          openBrowser(url)
        } else {
          backendConn.send({ type: 'auth_start', platform })
        }
      },

      authLogout: ({ platform }) => {
        backendConn.send({ type: 'auth_logout', platform })
        AccountStore.deleteByPlatform(platform)
        // Reconnect watched channels so they drop back to anonymous mode
        void watchedChannelManager.reconnectByPlatform(platform).catch((err) => {
          log.error('Failed to reconnect watched channels after logout', {
            platform,
            error: String(err),
          })
        })
      },

      joinChannel: ({ platform, channelSlug }) => {
        const adapter = aggregator.getAdapter(platform)
        if (!adapter) {
          log.warn('No adapter registered for platform', {
            platform,
            action: 'joinChannel',
          })
          return
        }
        ChannelStore.save(platform, channelSlug)
        log.info('Connecting to channel', {
          platform,
          channelSlug,
          action: 'joinChannel',
        })
        adapter
          .connect(channelSlug)
          .then(() => {
            log.info('adapter.connect() resolved', {
              platform,
              channelSlug,
              action: 'joinChannel',
            })
            // Subscribe to 7TV emotes for this channel
            // For Kick, use broadcasterUserId instead of slug
            let sevenTvChannelId = channelSlug
            if (platform === 'kick') {
              const kickAdapterCast = adapter as KickAdapter
              const broadcasterUserId = kickAdapterCast.getBroadcasterUserId()
              if (broadcasterUserId) {
                sevenTvChannelId = String(broadcasterUserId)
              }
            }
            sevenTVService.subscribeToChannel(platform, sevenTvChannelId).catch((err) => {
              log.error('Failed to subscribe to 7TV', {
                platform,
                channelSlug: sevenTvChannelId,
                error: String(err),
                action: '7tv',
              })
            })
          })
          .catch((err) => {
            log.error('Failed to connect', {
              platform,
              channelSlug,
              error: String(err),
              action: 'joinChannel',
            })
          })
      },

      leaveChannel: ({ platform, channelSlug }) => {
        const adapter = aggregator.getAdapter(platform)
        if (!adapter) {
          log.warn('No adapter registered for platform', {
            platform,
            action: 'leaveChannel',
          })
          return
        }
        ChannelStore.remove(platform, channelSlug)
        // Unsubscribe from 7TV emotes for this channel
        sevenTVService.unsubscribeFromChannel(platform, channelSlug).catch((err) => {
          log.error('Failed to unsubscribe from 7TV', {
            platform,
            channelSlug,
            error: String(err),
            action: '7tv',
          })
        })
        adapter.disconnect().catch((err) => {
          log.error('Failed to disconnect', {
            platform,
            error: String(err),
            action: 'leaveChannel',
          })
        })
      },

      sendMessage: ({ platform, channelId, text, replyToMessageId }) => {
        const adapter = aggregator.getAdapter(platform)
        if (!adapter) {
          log.warn('No adapter registered for platform', {
            platform,
            action: 'sendMessage',
          })
          return
        }
        adapter.sendMessage(channelId, text, replyToMessageId).catch((err) => {
          log.error('Failed to send message', {
            platform,
            error: String(err),
            action: 'sendMessage',
          })
        })
      },

      getStreamStatus: async ({ platform, channelId }) => {
        const res = await backendFetch(
          `/api/stream-status?platform=${platform}&channelId=${encodeURIComponent(channelId)}`,
        )
        if (!res.ok) throw new Error(`stream-status: ${res.status}`)
        return (await res.json()) as StreamStatusResponse
      },

      updateStream: async (params) => {
        const account = AccountStore.findByPlatform(params.platform)
        if (!account) throw new Error(`No ${params.platform} account found`)
        const tokens = AccountStore.getTokens(account.id)
        if (!tokens?.accessToken) throw new Error(`No access token for ${params.platform}`)

        const body: UpdateStreamRequest = {
          ...params,
          userAccessToken: tokens.accessToken,
        }

        const res = await backendFetch(`/api/update-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(`update-stream: ${res.status}`)
        return (await res.json()) as UpdateStreamResponse
      },

      searchCategories: async ({ platform, query }) => {
        const res = await backendFetch(
          `/api/search-categories?platform=${platform}&query=${encodeURIComponent(query)}`,
        )
        if (!res.ok) throw new Error(`search-categories: ${res.status}`)
        return (await res.json()) as SearchCategoriesResponse
      },

      getChannelsStatus: async ({ channels }) => {
        // Attach user access tokens for platforms where the user is authenticated
        const enriched = channels.map((ch) => {
          const account = AccountStore.findByPlatform(ch.platform as Platform)
          if (account) {
            const tokens = AccountStore.getTokens(account.id)
            if (tokens?.accessToken) {
              return { ...ch, userAccessToken: tokens.accessToken }
            }
          }
          return ch
        })

        const res = await backendFetch(`/api/channels-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channels: enriched }),
        })
        if (!res.ok) throw new Error(`channels-status: ${res.status}`)
        return (await res.json()) as ChannelsStatusResponse
      },

      getStatuses: () => [...currentStatuses.values()],

      getRecentMessages: (params) => {
        const limit = (params as { limit?: number } | null)?.limit ?? 100
        return MessageStore.getRecent(limit)
      },

      getUsernameColor: ({ platform, username }) => {
        return UsernameColorCache.get(platform, username) ?? null
      },

      checkForUpdate: async () => {
        const updateInfo = await Updater.checkForUpdate()
        const currentVersion = await Updater.localInfo.version()
        return {
          updateAvailable: updateInfo.updateAvailable,
          version: updateInfo.version,
          currentVersion,
        }
      },

      downloadUpdate: async () => {
        try {
          await Updater.downloadUpdate()
          return { success: true }
        } catch (err) {
          return { success: false, error: String(err) }
        }
      },

      applyUpdate: async () => {
        await Updater.applyUpdate()
      },

      // ---- Watched Channels ----

      getWatchedChannels: () => watchedChannelManager.getAll(),

      addWatchedChannel: async ({
        platform,
        channelSlug,
      }: {
        platform: 'twitch' | 'kick' | 'youtube'
        channelSlug: string
      }) => {
        return await watchedChannelManager.addChannel(platform, channelSlug)
      },

      removeWatchedChannel: async ({ id }: { id: string }) => {
        await watchedChannelManager.removeChannel(id)
        WatchedChannelsLayoutStore.remove(id)
      },

      getWatchedChannelMessages: ({ id }: { id: string }) => {
        return watchedChannelManager.getMessages(id)
      },

      sendWatchedChannelMessage: async ({
        id,
        text,
        replyToMessageId,
      }: {
        id: string
        text: string
        replyToMessageId?: string
      }) => {
        await watchedChannelManager.sendMessage(id, text, replyToMessageId)
      },

      getWatchedChannelStatuses: () => {
        return watchedChannelManager.getAllStatuses()
      },

      openExternalUrl: ({ url }) => {
        openBrowser(url)
      },

      // ---- Watched Channels Layout ----

      getTabChannelIds: () => {
        const db = getDb()
        const row = db
          .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
          .get('tab_channel_ids')
        if (!row) return null
        try {
          return JSON.parse(row.value) as string[]
        } catch {
          return null
        }
      },

      setTabChannelIds: ({ ids }: { ids: string[] }) => {
        const db = getDb()
        db.run(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ['tab_channel_ids', JSON.stringify(ids)],
        )
      },

      getWatchedChannelsLayout: ({ tabId }: { tabId: string }) => {
        return WatchedChannelsLayoutStore.get(tabId)
      },

      setWatchedChannelsLayout: ({
        tabId,
        layout,
      }: {
        tabId: string
        layout: WatchedChannelsLayout
      }) => {
        WatchedChannelsLayoutStore.set(tabId, layout)
      },

      splitPanel: ({
        tabId,
        panelId,
        direction,
      }: {
        tabId: string
        panelId: string
        direction: SplitDirection
      }) => {
        const layout = WatchedChannelsLayoutStore.get(tabId)

        const MAX_PANELS = 8
        const countPanels = (node: LayoutNode): number => {
          if (node.type === 'panel') return 1
          return node.children.reduce((sum, child) => sum + countPanels(child), 0)
        }

        if (countPanels(layout.root) >= MAX_PANELS) {
          throw new Error('Maximum panel limit reached (8)')
        }

        const findNodeById = (node: LayoutNode, id: string): PanelNode | null => {
          if (node.type === 'panel' && node.id === id) return node
          if (node.type === 'split') {
            for (const child of node.children) {
              const found = findNodeById(child, id)
              if (found) return found
            }
          }
          return null
        }

        const findParentOfNode = (
          root: LayoutNode,
          nodeId: string,
        ): { node: LayoutNode; children: LayoutNode[] } | null => {
          if (root.type === 'split') {
            for (let i = 0; i < root.children.length; i++) {
              const child = root.children[i]
              if (!child) continue
              if (child.id === nodeId) {
                return { node: root, children: root.children }
              }
              const found = findParentOfNode(child, nodeId)
              if (found) return found
            }
          }
          return null
        }

        const panel = findNodeById(layout.root, panelId)
        if (!panel || panel.type !== 'panel') {
          throw new Error('Panel not found')
        }

        const newPanel: PanelNode = {
          type: 'panel',
          id: crypto.randomUUID(),
          content: { type: 'empty' },
          flex: 50,
        }

        const parent = findParentOfNode(layout.root, panelId)
        if (parent && parent.node.type === 'split' && parent.node.direction === direction) {
          const index = parent.children.findIndex((c) => c.id === panelId)
          parent.children.splice(index + 1, 0, newPanel)
          const flexPerChild = 100 / parent.children.length
          parent.children.forEach((child) => (child.flex = flexPerChild))
        } else {
          const newSplit: LayoutNode = {
            type: 'split',
            id: crypto.randomUUID(),
            direction,
            children: [panel, newPanel],
            flex: panel.flex,
          }

          panel.flex = 50

          if (parent) {
            const index = parent.children.findIndex((c) => c.id === panelId)
            parent.children[index] = newSplit
          } else {
            layout.root = newSplit
          }
        }

        WatchedChannelsLayoutStore.set(tabId, layout)
        return { original: panel, newPanel }
      },

      removePanel: ({ tabId, panelId }: { tabId: string; panelId: string }) => {
        const layout = WatchedChannelsLayoutStore.get(tabId)

        const findNodeById = (node: LayoutNode, id: string): PanelNode | null => {
          if (node.type === 'panel' && node.id === id) return node
          if (node.type === 'split') {
            for (const child of node.children) {
              const found = findNodeById(child, id)
              if (found) return found
            }
          }
          return null
        }

        const findParentOfNode = (
          root: LayoutNode,
          nodeId: string,
        ): { node: LayoutNode; children: LayoutNode[] } | null => {
          if (root.type === 'split') {
            for (let i = 0; i < root.children.length; i++) {
              const child = root.children[i]
              if (!child) continue
              if (child.id === nodeId) {
                return { node: root, children: root.children }
              }
              const found = findParentOfNode(child, nodeId)
              if (found) return found
            }
          }
          return null
        }

        const panelToRemove = findNodeById(layout.root, panelId)
        if (panelToRemove?.type === 'panel' && panelToRemove.content.type === 'main') {
          throw new Error('Cannot remove main panel')
        }

        const parent = findParentOfNode(layout.root, panelId)
        if (!parent) throw new Error('Panel not found')

        const index = parent.children.findIndex((c) => c.id === panelId)
        if (index === -1) throw new Error('Panel not found in parent')

        parent.children.splice(index, 1)

        if (parent.children.length === 1) {
          const onlyChild = parent.children[0]
          if (onlyChild) {
            const grandparent = findParentOfNode(layout.root, parent.node.id)
            if (grandparent) {
              const parentIndex = grandparent.children.findIndex((c) => c.id === parent.node.id)
              if (parentIndex !== -1) {
                grandparent.children[parentIndex] = onlyChild
              }
            } else {
              layout.root = onlyChild
            }
          }
        } else {
          const flexPerChild = 100 / parent.children.length
          parent.children.forEach((child) => (child.flex = flexPerChild))
        }

        WatchedChannelsLayoutStore.set(tabId, layout)
      },

      assignChannelToPanel: ({
        tabId,
        panelId,
        channelId,
      }: {
        tabId: string
        panelId: string
        channelId: string | null
      }) => {
        const layout = WatchedChannelsLayoutStore.get(tabId)

        const findNodeById = (node: LayoutNode, id: string): PanelNode | null => {
          if (node.type === 'panel' && node.id === id) return node
          if (node.type === 'split') {
            for (const child of node.children) {
              const found = findNodeById(child, id)
              if (found) return found
            }
          }
          return null
        }

        const panel = findNodeById(layout.root, panelId)
        if (!panel || panel.type !== 'panel') {
          throw new Error('Panel not found')
        }

        panel.content = channelId ? { type: 'watched', channelId } : { type: 'empty' }

        WatchedChannelsLayoutStore.set(tabId, layout)
      },
    },
  },
  maxRequestTime: 10_000,
})

// Typed sender: cast rpc.send to the explicit WebviewSender type so TypeScript
// Can resolve the message names without fighting complex generic inference.
const sendToView = rpc.send as unknown as WebviewSender

// Pass the RPC sender to the auth server so it can notify the webview of auth events
setAuthServerRpcSender(sendToView)

// DEV-ONLY: HTTP endpoint for test message injection
if (process.env.NODE_ENV !== 'production') {
  Bun.serve({
    port: 45824,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/dev/inject-chat' && req.method === 'POST') {
        const body = (await req.json()) as NormalizedChatMessage
        sendToView.chat_message(body)
        return new Response('ok')
      }
      return new Response('not found', { status: 404 })
    },
  })
  log.info('[Dev] Test injection endpoint listening on port 45824')
}

// ============================================================
// 3. Main window
// ============================================================

/**
 * In development, check if the Vite HMR server is running on port 5173.
 * If it is, load from there so changes are reflected instantly.
 * In production (or when vite is not running), fall back to views://.
 */
const channel = await Updater.localInfo.channel()
async function resolveWindowUrl(): Promise<string> {
  if (channel === 'dev') {
    log.info('Running in dev channel — skipping Vite server check')
    return 'http://localhost:5173'
  }

  return 'views://main/index.html'
}

const windowUrl = await resolveWindowUrl()

const win = new BrowserWindow({
  frame: { height: 800, width: 1200, x: 0, y: 0 },
  rpc,
  title: 'TwirChat',
  url: windowUrl,
})

if (channel === 'dev') {
  win.webview.openDevTools()
}

// ============================================================
// 3b. Auto-update setup
// ============================================================

// Subscribe to update status changes and forward to webview
Updater.onStatusChange((entry) => {
  log.info(`[Updater] ${entry.status}: ${entry.message}`)
  sendToView.update_status({
    message: entry.message,
    progress: entry.details?.progress,
    status: entry.status,
  })
})

// Auto-check for updates on startup (if enabled in settings)
const settings = SettingsStore.get()
if (settings?.autoCheckUpdates !== false && channel !== 'dev') {
  log.info('Checking for updates...')
  Updater.checkForUpdate()
    .then((updateInfo) => {
      if (updateInfo.updateAvailable) {
        log.info(`Update available: ${updateInfo.version}`)
        // Optionally auto-download: Updater.downloadUpdate()
      } else {
        log.info('No updates available')
      }
    })
    .catch((error) => {
      log.error('Failed to check for updates', { error: String(error) })
    })
}

// ============================================================
// 4. Route adapter events → webview + overlay
// ============================================================

aggregator.onMessage((msg) => {
  MessageStore.save(msg)
  UsernameColorCache.addMessage(msg)
  pushOverlayMessage(msg)
  sendToView.chat_message(msg)
  log.info('Chat message', {
    author: msg.author.displayName,
    platform: msg.platform,
    text: msg.text,
  })
})

aggregator.onEvent((ev) => {
  pushOverlayEvent(ev)
  sendToView.chat_event(ev)
  log.info('Event', {
    platform: ev.platform,
    type: ev.type,
    user: ev.user.displayName,
  })
})

aggregator.onStatus((s) => {
  currentStatuses.set(s.platform, s)
  sendToView.platform_status(s)
  log.info('Status', {
    channel: s.channelLogin,
    mode: s.mode,
    platform: s.platform,
    status: s.status,
  })
})

// ---- Watched channel events → webview ----

watchedChannelManager.onMessage((channelId, message) => {
  sendToView.watched_channel_message({ channelId, message })
  log.info('Watched message', {
    author: message.author.displayName,
    channelId,
    platform: message.platform,
  })
})

watchedChannelManager.onStatus((channelId, status) => {
  sendToView.watched_channel_status({ channelId, status })
  log.info('Watched status', {
    channelId,
    platform: status.platform,
    status: status.status,
  })
})

// ============================================================
// 5. Route backend messages → webview (auth flows only)
// ============================================================

backendConn.onMessage((msg) => {
  switch (msg.type) {
    case 'auth_url': {
      sendToView.auth_url({ platform: msg.platform, url: msg.url })
      openBrowser(msg.url)
      break
    }

    case 'auth_success': {
      sendToView.auth_success({
        platform: msg.platform,
        username: msg.username,
        displayName: msg.displayName,
      })
      break
    }

    case 'auth_error': {
      sendToView.auth_error({ platform: msg.platform, error: msg.error })
      break
    }

    case 'pong': {
      break
    }

    case 'error': {
      log.error('Backend error', { message: msg.message })
      break
    }

    default: {
      break
    }
  }
})

backendConn.onSystemMessage((msg) => {
  if (msg.action === 'set_changed') {
    const systemMsg: NormalizedChatMessage = {
      author: {
        badges: [],
        color: '#6441a5',
        displayName: '7TV',
        id: '7tv-system',
        username: '7TV',
      },
      channelId: msg.channelId,
      emotes: [],
      id: `7tv-system-${Date.now()}-${Math.random()}`,
      platform: msg.platform,
      text: `Active emote set changed to «${msg.setName}»`,
      timestamp: new Date(),
      type: 'system',
    }
    aggregator.injectMessage(systemMsg)
    return
  }

  if (msg.action === 'set_renamed') {
    const systemMsg: NormalizedChatMessage = {
      author: {
        badges: [],
        color: '#6441a5',
        displayName: '7TV',
        id: '7tv-system',
        username: '7TV',
      },
      channelId: msg.channelId,
      emotes: [],
      id: `7tv-system-${Date.now()}-${Math.random()}`,
      platform: msg.platform,
      text: `Emote set «${msg.oldName}» renamed to «${msg.newName}»`,
      timestamp: new Date(),
      type: 'system',
    }
    aggregator.injectMessage(systemMsg)
    return
  }

  if (msg.action === 'set_deleted') {
    const systemMsg: NormalizedChatMessage = {
      author: {
        badges: [],
        color: '#6441a5',
        displayName: '7TV',
        id: '7tv-system',
        username: '7TV',
      },
      channelId: msg.channelId,
      emotes: [],
      id: `7tv-system-${Date.now()}-${Math.random()}`,
      platform: msg.platform,
      text: `Emote set «${msg.setName}» was deleted`,
      timestamp: new Date(),
      type: 'system',
    }
    aggregator.injectMessage(systemMsg)
    return
  }

  const actionText =
    msg.action === 'added' ? 'added to' : msg.action === 'removed' ? 'removed from' : 'renamed in'
  const oldAliasText = msg.oldAlias ? ` (was ${msg.oldAlias})` : ''

  log.info('7TV system message', {
    action: msg.action,
    channelId: msg.channelId,
    emoteAlias: msg.emote.alias,
    platform: msg.platform,
  })

  const emoteWithColons = `:${msg.emote.alias}:`
  const textBeforeEmote = 'Emote '
  const startPos = textBeforeEmote.length
  const endPos = startPos + emoteWithColons.length - 1

  const systemMsg: NormalizedChatMessage = {
    author: {
      badges: [],
      color: '#6441a5',
      displayName: '7TV',
      id: '7tv-system',
      username: '7TV',
    },
    channelId: msg.channelId,
    emotes: [
      {
        id: msg.emote.id,
        name: msg.emote.alias,
        imageUrl: sevenTVService.getImageUrl(msg.emote.id),
        positions: [{ start: startPos, end: endPos }],
        aspectRatio: msg.emote.aspectRatio,
      },
    ],
    id: `7tv-system-${Date.now()}-${Math.random()}`,
    platform: msg.platform,
    text: `${textBeforeEmote}${emoteWithColons}${oldAliasText} ${actionText} the channel`,
    timestamp: new Date(),
    type: 'system',
  }

  aggregator.injectMessage(systemMsg)
})

// ============================================================
// 6. Backend connection
// ============================================================

backendConn.connect()

// Keep WS alive
setInterval(() => {
  backendConn.send({ type: 'ping' })
}, 30_000)

// ============================================================
// 7. Auto-connect to persisted channels and authenticated accounts
// ============================================================

const savedChannels = ChannelStore.findAll()
const connectedPlatforms = new Set<string>()

// First, connect to explicitly saved channels
for (const [platform, slugs] of Object.entries(savedChannels)) {
  for (const slug of slugs ?? []) {
    const adapter = aggregator.getAdapter(platform as Platform)
    if (!adapter) {
      log.warn('No adapter for platform', { action: 'AutoConnect', platform })
      continue
    }
    connectedPlatforms.add(platform)
    log.info('Connecting to channel', {
      action: 'AutoConnect',
      platform,
      slug,
    })
    adapter
      .connect(slug)
      .then(() => {
        log.info('Connected', { action: 'AutoConnect', platform, slug })
        // Subscribe to 7TV emotes for this channel
        // For Kick, use broadcasterUserId instead of slug
        let sevenTvChannelId = slug
        if (platform === 'kick') {
          const kickAdapterCast = adapter as KickAdapter
          const broadcasterUserId = kickAdapterCast.getBroadcasterUserId()
          if (broadcasterUserId) {
            sevenTvChannelId = String(broadcasterUserId)
          }
        }
        sevenTVService.subscribeToChannel(platform as Platform, sevenTvChannelId).catch((error) => {
          log.error('Failed to subscribe to 7TV', {
            platform,
            channelSlug: sevenTvChannelId,
            error: String(error),
            action: '7tv',
          })
        })
      })
      .catch((error) => {
        log.error('Failed to connect', {
          platform,
          slug,
          error: String(error),
          action: 'AutoConnect',
        })
      })
  }
}

// For YouTube and Kick, auto-connect to user's own channel if authenticated but not yet connected
const accounts = AccountStore.findAll()
for (const account of accounts) {
  if (account.platform === 'youtube' || account.platform === 'kick') {
    // Skip if already connected via saved channels
    if (connectedPlatforms.has(account.platform)) {
      continue
    }

    const adapter = aggregator.getAdapter(account.platform)
    if (!adapter) {
      log.warn('No adapter for platform', {
        action: 'AutoConnectAccount',
        platform: account.platform,
      })
      continue
    }

    // Auto-connect to user's own channel
    const channelSlug = account.username
    log.info("Auto-connecting to user's channel", {
      action: 'AutoConnectAccount',
      channel: channelSlug,
      platform: account.platform,
    })

    // Save the channel for persistence
    ChannelStore.save(account.platform, channelSlug)

    adapter
      .connect(channelSlug)
      .then(() => {
        log.info("Connected to user's channel", {
          action: 'AutoConnectAccount',
          channel: channelSlug,
          platform: account.platform,
        })
        // Subscribe to 7TV emotes for this channel
        // For Kick, use broadcasterUserId instead of slug
        let sevenTvChannelId = channelSlug
        if (account.platform === 'kick') {
          const kickAdapterCast = adapter as KickAdapter
          const broadcasterUserId = kickAdapterCast.getBroadcasterUserId()
          if (broadcasterUserId) {
            sevenTvChannelId = String(broadcasterUserId)
          }
        }
        sevenTVService.subscribeToChannel(account.platform, sevenTvChannelId).catch((error) => {
          log.error('Failed to subscribe to 7TV', {
            platform: account.platform,
            channelSlug: sevenTvChannelId,
            error: String(error),
            action: '7tv',
          })
        })
      })
      .catch((error) => {
        log.error("Failed to connect to user's channel", {
          platform: account.platform,
          channel: channelSlug,
          error: String(error),
          action: 'AutoConnectAccount',
        })
      })
  }
}

// ============================================================
// 8. Auto-connect watched channels
// ============================================================

watchedChannelManager.autoConnect().catch((error) => {
  log.error('Failed to auto-connect watched channels', { error: String(error) })
})

log.info('Ready')

// ============================================================
// Helpers
// ============================================================

function openBrowser(url: string): void {
  const success = Utils.openExternal(url)
  if (!success) {
    log.error('Failed to open browser', { action: 'auth', url })
    log.info('Please open manually', { action: 'auth', url })
  }
}

export { win, rpc, aggregator, backendConn }
