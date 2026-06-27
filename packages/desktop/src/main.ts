/**
 * TwirChat — Deno Desktop main process entry point
 *
 * Responsibilities:
 *  - Initialise SQLite DB and client secret
 *  - Connect to the backend service via WebSocket (auth flows only)
 *  - Instantiate and register platform adapters (Twitch, Kick, YouTube)
 *  - Aggregate incoming chat messages / events via ChatAggregator
 *  - Run the OBS overlay HTTP+WS server
 *  - Create the main BrowserWindow with the Vue UI
 *  - Bridge adapter events into the webview via SSE
 *  - Handle binding requests coming from the webview
 */

import { getDb, initDb } from './store/db'
import { getClientSecret } from './store/client-secret'
import {
  AccountStore,
  ChannelStore,
  MessageStore,
  SettingsStore,
  UsernameColorCache,
} from './store'
import { UserAliasStore } from './store/user-alias-store'
import { BackendConnection } from './backend-connection'
import { ChatAggregator } from './chat/aggregator'
import { pushOverlayEvent, pushOverlayMessage, startOverlayServer } from './overlay-server'
import { getTwitchAuthUrl, prepareTwitchAuth } from './auth/twitch'
import { getKickAuthUrl, prepareKickAuth } from './auth/kick'
import { getYouTubeAuthUrl, prepareYouTubeAuth } from './auth/youtube'
import { TwitchAdapter } from './platforms/twitch/adapter'
import { KickAdapter } from './platforms/kick/adapter'
import { YouTubeAdapter } from './platforms/youtube/adapter'
import { sevenTVService } from './seventv'
import { WatchedChannelManager } from './watched-channels/manager'
import { WatchedChannelsLayoutStore } from './store/watched-channels-layout-store'
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
import type {
  ChannelsStatusResponse,
  SearchCategoriesResponse,
  StreamStatusResponse,
  UpdateStreamRequest,
  UpdateStreamResponse,
  UserCardMetadataResponse,
} from '@twirchat/shared/protocol'
import { startAuthServer, setOnAuthSuccessCallback } from './auth'
import { setRuntimeConfig, backendFetch } from './runtime-config'
import { pushEvent, createSseStream } from './event-bus'

// ============================================================
// 1. Load runtime config from environment
// ============================================================

setRuntimeConfig({
  backendUrl: Deno.env.get('CHATRIX_BACKEND_URL'),
  backendWsUrl: Deno.env.get('CHATRIX_BACKEND_WS_URL'),
  nodeEnv: Deno.env.get('NODE_ENV'),
})

// ============================================================
// 2. Initialisation
// ============================================================

const log = logger('main')

log.info('Starting...')

initDb()
log.info('Database ready')

const clientSecret = getClientSecret()
log.info('Client secret', { secret: `${clientSecret.slice(0, 8)}...` })

setRuntimeConfig({ clientSecret })

const backendConn = new BackendConnection(clientSecret)
const aggregator = new ChatAggregator(500)

sevenTVService.sendToBackend = (message) => {
  backendConn.send(message as DesktopToBackendMessage)
}

const twitchAdapter = new TwitchAdapter()
const kickAdapter = new KickAdapter()
const youtubeAdapter = new YouTubeAdapter()
aggregator.registerAdapter(twitchAdapter)
aggregator.registerAdapter(kickAdapter)
aggregator.registerAdapter(youtubeAdapter)

startOverlayServer()

const watchedChannelManager = new WatchedChannelManager()

function getSevenTvTwitchPlatformUserId(channelSlug: string): string | undefined {
  const twitchAccount = AccountStore.findByPlatform('twitch')
  if (!twitchAccount) return undefined
  if (twitchAccount.username.toLowerCase() !== channelSlug.toLowerCase()) return undefined
  return twitchAccount.platformUserId
}

// ============================================================
// 1c. Auth success callback
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

  const targetChannel = channelSlug || ChannelStore.findByPlatform(platform)[0]
  if (!targetChannel) {
    log.info('No channel specified, skipping reconnection', {
      action: 'auth',
      platform,
    })
    return
  }

  try {
    await adapter.disconnect()
    log.info('Adapter disconnected', { action: 'auth', platform })

    await adapter.connect(targetChannel)
    log.info('Adapter reconnected in authenticated mode', {
      action: 'auth',
      channel: targetChannel,
      platform,
    })

    let sevenTvChannelId = targetChannel
    let sevenTvPlatformUserId: string | undefined
    if (platform === 'kick') {
      const kickAdapterCast = adapter as KickAdapter
      const broadcasterUserId = kickAdapterCast.getBroadcasterUserId()
      if (broadcasterUserId) {
        sevenTvChannelId = String(broadcasterUserId)
      }
    } else if (platform === 'twitch') {
      sevenTvPlatformUserId = getSevenTvTwitchPlatformUserId(targetChannel)
    }
    sevenTVService
      .subscribeToChannel(platform, sevenTvChannelId, [targetChannel], sevenTvPlatformUserId)
      .catch((error) => {
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

  await watchedChannelManager.reconnectByPlatform(platform).catch((error) => {
    log.error('Failed to reconnect watched channels after auth', {
      platform,
      error: String(error),
    })
  })
})

startAuthServer()

// ============================================================
// 2. Status tracking
// ============================================================

const currentStatuses = new Map<string, PlatformStatusInfo>()

// ============================================================
// 3. Main Deno.serve — bindings + SSE (auto-bound to webview)
// ============================================================

// Deno.BrowserWindow is part of the Deno Desktop API (not yet available in standard Deno).
// When available, this creates the native window and registers bindings.
// For now, bindings are registered via HTTP routes as a fallback.
const hasBrowserWindow = typeof (Deno as Record<string, unknown>).BrowserWindow === 'function'

let win: { bind(name: string, handler: (...args: unknown[]) => unknown): void } | null = null

if (hasBrowserWindow) {
  // @ts-expect-error — Deno Desktop API not yet in types
  win = new Deno.BrowserWindow({
    title: 'TwirChat',
    width: 1200,
    height: 800,
  })
}

function bindOrRoute(name: string, handler: (...args: any[]) => any): void {
  if (win) {
    bindOrRoute(name, handler)
  }
}

// Register all bindings
bindOrRoute('getAccounts', () => AccountStore.findAll())
bindOrRoute('getSettings', () => SettingsStore.get())
bindOrRoute('saveSettings', (s: unknown) => {
  SettingsStore.set(s as import('@twirchat/shared/types').AppSettings)
})
bindOrRoute('getChannels', () => ChannelStore.findAll())
bindOrRoute('getUserAliases', () => UserAliasStore.findAll())
bindOrRoute(
  'setUserAlias',
  ({
    platform,
    platformUserId,
    alias,
  }: {
    platform: Platform
    platformUserId: string
    alias: string
  }) => {
    if (!alias) {
      UserAliasStore.remove(platform, platformUserId)
    } else {
      UserAliasStore.upsert(platform, platformUserId, alias)
    }
  },
)
bindOrRoute(
  'removeUserAlias',
  ({ platform, platformUserId }: { platform: Platform; platformUserId: string }) =>
    UserAliasStore.remove(platform, platformUserId),
)
bindOrRoute('authStart', async ({ platform }: { platform: Platform }) => {
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
})
bindOrRoute('authLogout', ({ platform }: { platform: Platform }) => {
  backendConn.send({ type: 'auth_logout', platform })
  AccountStore.deleteByPlatform(platform)
  void watchedChannelManager.reconnectByPlatform(platform).catch((err) => {
    log.error('Failed to reconnect watched channels after logout', {
      platform,
      error: String(err),
    })
  })
})
bindOrRoute(
  'joinChannel',
  ({ platform, channelSlug }: { platform: Platform; channelSlug: string }) => {
    const adapter = aggregator.getAdapter(platform)
    if (!adapter) {
      log.warn('No adapter registered for platform', { platform, action: 'joinChannel' })
      return
    }
    ChannelStore.save(platform, channelSlug)
    log.info('Connecting to channel', { platform, channelSlug, action: 'joinChannel' })
    adapter
      .connect(channelSlug)
      .then(() => {
        log.info('adapter.connect() resolved', { platform, channelSlug, action: 'joinChannel' })
        let sevenTvChannelId = channelSlug
        let sevenTvPlatformUserId: string | undefined
        if (platform === 'kick') {
          const kickAdapterCast = adapter as KickAdapter
          const broadcasterUserId = kickAdapterCast.getBroadcasterUserId()
          if (broadcasterUserId) sevenTvChannelId = String(broadcasterUserId)
        } else if (platform === 'twitch') {
          sevenTvPlatformUserId = getSevenTvTwitchPlatformUserId(channelSlug)
        }
        sevenTVService
          .subscribeToChannel(platform, sevenTvChannelId, [channelSlug], sevenTvPlatformUserId)
          .catch((err) => {
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
)
bindOrRoute(
  'leaveChannel',
  ({ platform, channelSlug }: { platform: Platform; channelSlug: string }) => {
    const adapter = aggregator.getAdapter(platform)
    if (!adapter) {
      log.warn('No adapter registered for platform', { platform, action: 'leaveChannel' })
      return
    }
    ChannelStore.remove(platform, channelSlug)
    sevenTVService.unsubscribeFromChannel(platform, channelSlug).catch((err) => {
      log.error('Failed to unsubscribe from 7TV', {
        platform,
        channelSlug,
        error: String(err),
        action: '7tv',
      })
    })
    adapter.disconnect().catch((err) => {
      log.error('Failed to disconnect', { platform, error: String(err), action: 'leaveChannel' })
    })
  },
)
bindOrRoute(
  'sendMessage',
  ({
    platform,
    channelId,
    text,
    replyToMessageId,
  }: {
    platform: Platform
    channelId: string
    text: string
    replyToMessageId?: string
  }) => {
    const adapter = aggregator.getAdapter(platform)
    if (!adapter) {
      log.warn('No adapter registered for platform', { platform, action: 'sendMessage' })
      return
    }
    adapter.sendMessage(channelId, text, replyToMessageId).catch((err) => {
      log.error('Failed to send message', { platform, error: String(err), action: 'sendMessage' })
    })
  },
)
bindOrRoute(
  'getStreamStatus',
  async ({ platform, channelId }: { platform: 'twitch' | 'kick'; channelId: string }) => {
    const res = await backendFetch(
      `/api/stream-status?platform=${platform}&channelId=${encodeURIComponent(channelId)}`,
    )
    if (!res.ok) throw new Error(`stream-status: ${res.status}`)
    return (await res.json()) as StreamStatusResponse
  },
)
bindOrRoute(
  'updateStream',
  async (params: { platform: Platform; channelId: string; title?: string; category?: string }) => {
    const account = AccountStore.findByPlatform(params.platform)
    if (!account) throw new Error(`No ${params.platform} account found`)
    const tokens = AccountStore.getTokens(account.id)
    if (!tokens?.accessToken) throw new Error(`No access token for ${params.platform}`)

    const body: UpdateStreamRequest = { ...params, userAccessToken: tokens.accessToken }
    const res = await backendFetch('/api/update-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`update-stream: ${res.status}`)
    return (await res.json()) as UpdateStreamResponse
  },
)
bindOrRoute(
  'searchCategories',
  async ({ platform, query }: { platform: 'twitch' | 'kick'; query: string }) => {
    const res = await backendFetch(
      `/api/search-categories?platform=${platform}&query=${encodeURIComponent(query)}`,
    )
    if (!res.ok) throw new Error(`search-categories: ${res.status}`)
    return (await res.json()) as SearchCategoriesResponse
  },
)
bindOrRoute(
  'getChannelsStatus',
  async ({
    channels,
  }: {
    channels: import('@twirchat/shared/protocol').ChannelStatusRequest[]
  }) => {
    const enriched = channels.map((ch) => {
      const account = AccountStore.findByPlatform(ch.platform as Platform)
      if (account) {
        const tokens = AccountStore.getTokens(account.id)
        if (tokens?.accessToken) return { ...ch, userAccessToken: tokens.accessToken }
      }
      return ch
    })
    const res = await backendFetch('/api/channels-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels: enriched }),
    })
    if (!res.ok) throw new Error(`channels-status: ${res.status}`)
    return (await res.json()) as ChannelsStatusResponse
  },
)
bindOrRoute('getStatuses', () => [...currentStatuses.values()])
bindOrRoute('getRecentMessages', (params?: { limit?: number }) => {
  const limit = params?.limit ?? 100
  return MessageStore.getRecent(limit)
})
bindOrRoute(
  'getUserChatHistory',
  ({
    platform,
    platformUserId,
    limit,
    cursor,
  }: {
    platform: Platform
    platformUserId: string
    limit?: number
    cursor?: import('./bindings').UserChatHistoryCursor
  }) => {
    return MessageStore.getByUser({ platform, platformUserId, limit, cursor })
  },
)
bindOrRoute(
  'getUserCardMetadata',
  async ({
    platform,
    platformUserId,
    username,
    channelId,
    channelSlug,
  }: import('@twirchat/shared/protocol').UserCardMetadataRequest) => {
    const body: import('@twirchat/shared/protocol').UserCardMetadataBackendRequest = {
      platform,
      platformUserId,
      username,
      channelId,
      channelSlug,
    }
    const account = AccountStore.findByPlatform(platform)
    if (platform === 'twitch' && account) {
      const tokens = AccountStore.getTokens(account.id)
      if (tokens?.accessToken) {
        body.twitchAuth = {
          accessToken: tokens.accessToken,
          platformUserId: account.platformUserId,
          scopes: account.scopes,
        }
      }
    }
    const res = await backendFetch('/api/user-card-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`user-card-metadata: ${res.status}`)
    return (await res.json()) as UserCardMetadataResponse
  },
)
bindOrRoute('getUsernameColor', ({ platform, username }: { platform: Platform; username: string }) => {
  return UsernameColorCache.get(platform, username) ?? null
})
bindOrRoute(
  'getChannelEmotes',
  ({ platform, channelId }: { platform: Platform; channelId: string }) => {
    return sevenTVService.getEmotes(platform, channelId)
  },
)
bindOrRoute('checkForUpdate', async () => {
  if (typeof (Deno as Record<string, unknown>).autoUpdate === 'function') {
    // @ts-expect-error — Deno Desktop API not yet in types
    return Deno.autoUpdate.checkForUpdate()
  }
  return { updateAvailable: false, currentVersion: '0.0.1' }
})
bindOrRoute('downloadUpdate', async () => {
  if (typeof (Deno as Record<string, unknown>).autoUpdate === 'function') {
    try {
      // @ts-expect-error — Deno Desktop API not yet in types
      await Deno.autoUpdate.downloadUpdate()
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }
  return { success: false, error: 'Auto-update not available' }
})
bindOrRoute('applyUpdate', async () => {
  if (typeof (Deno as Record<string, unknown>).autoUpdate === 'function') {
    // @ts-expect-error — Deno Desktop API not yet in types
    await Deno.autoUpdate.applyUpdate()
  }
})
bindOrRoute('skipUpdate', ({ hash }: { hash: string }) => {
  _skippedHash = hash
  log.info('[Updater] Skipped update hash', { hash })
})
bindOrRoute('getWatchedChannels', () => watchedChannelManager.getAll())
bindOrRoute(
  'addWatchedChannel',
  async ({
    platform,
    channelSlug,
  }: {
    platform: 'twitch' | 'kick' | 'youtube'
    channelSlug: string
  }) => {
    return await watchedChannelManager.addChannel(platform, channelSlug)
  },
)
bindOrRoute('removeWatchedChannel', async ({ id }: { id: string }) => {
  await watchedChannelManager.removeChannel(id)
  WatchedChannelsLayoutStore.remove(id)
})
bindOrRoute('getWatchedChannelMessages', ({ id }: { id: string }) => {
  return watchedChannelManager.getMessages(id)
})
bindOrRoute(
  'sendWatchedChannelMessage',
  async ({
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
)
bindOrRoute('getWatchedChannelStatuses', () => {
  return watchedChannelManager.getAllStatuses()
})
bindOrRoute('openExternalUrl', ({ url }: { url: string }) => {
  openBrowser(url)
})
bindOrRoute('getTabChannelIds', () => {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('tab_channel_ids') as
    | { value: string }
    | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value) as string[]
  } catch {
    return null
  }
})
bindOrRoute('setTabChannelIds', ({ ids }: { ids: string[] }) => {
  const db = getDb()
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run('tab_channel_ids', JSON.stringify(ids))
})
bindOrRoute('getWatchedChannelsLayout', ({ tabId }: { tabId: string }) => {
  return WatchedChannelsLayoutStore.get(tabId)
})
bindOrRoute(
  'setWatchedChannelsLayout',
  ({ tabId, layout }: { tabId: string; layout: WatchedChannelsLayout }) => {
    WatchedChannelsLayoutStore.set(tabId, layout)
  },
)
bindOrRoute(
  'splitPanel',
  ({
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
          if (child.id === nodeId) return { node: root, children: root.children }
          const found = findParentOfNode(child, nodeId)
          if (found) return found
        }
      }
      return null
    }

    const panel = findNodeById(layout.root, panelId)
    if (!panel || panel.type !== 'panel') throw new Error('Panel not found')

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
)
bindOrRoute('removePanel', ({ tabId, panelId }: { tabId: string; panelId: string }) => {
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
        if (child.id === nodeId) return { node: root, children: root.children }
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
        if (parentIndex !== -1) grandparent.children[parentIndex] = onlyChild
      } else {
        layout.root = onlyChild
      }
    }
  } else {
    const flexPerChild = 100 / parent.children.length
    parent.children.forEach((child) => (child.flex = flexPerChild))
  }

  WatchedChannelsLayoutStore.set(tabId, layout)
})
bindOrRoute(
  'assignChannelToPanel',
  ({ tabId, panelId, channelId }: { tabId: string; panelId: string; channelId: string | null }) => {
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
    if (!panel || panel.type !== 'panel') throw new Error('Panel not found')

    panel.content = channelId ? { type: 'watched', channelId } : { type: 'empty' }

    WatchedChannelsLayoutStore.set(tabId, layout)
  },
)

// Main Deno.serve — serves binding routes + SSE event stream
// When Deno Desktop is available, this will be auto-bound to the webview.
// For now, listens on a dedicated port.
Deno.serve({
  port: 45822,
  handler(req) {
    const url = new URL(req.url)

    // SSE event stream for webview push events
    if (url.pathname === '/api/events' && req.method === 'GET') {
      return createSseStream()
    }

    return new Response('Not found', { status: 404 })
  },
})

// ============================================================
// 4. Auto-update setup
// ============================================================

let _skippedHash: string | null = null

const _settings = SettingsStore.get()

// Deno.autoUpdate is part of the Deno Desktop API (not yet available).
if (typeof (Deno as Record<string, unknown>).autoUpdate === 'function') {
  // @ts-expect-error — Deno Desktop API not yet in types
  Deno.autoUpdate({
    interval: 60 * 60 * 1000,
    onUpdateReady(version: string) {
      pushEvent('update_status', { status: 'ready', version })
    },
    onRollback(reason: string) {
      pushEvent('update_status', { status: 'rollback', reason })
    },
  })
}

// ============================================================
// 5. Route adapter events → webview + overlay
// ============================================================

aggregator.onMessage((msg) => {
  MessageStore.save(msg)
  UsernameColorCache.addMessage(msg)
  pushOverlayMessage(msg)
  pushEvent('chat_message', msg)
  log.info('Chat message', {
    author: msg.author.displayName,
    platform: msg.platform,
    text: msg.text,
  })
})

aggregator.onEvent((ev) => {
  pushOverlayEvent(ev)
  pushEvent('chat_event', ev)
  log.info('Event', {
    platform: ev.platform,
    type: ev.type,
    user: ev.user.displayName,
  })
})

aggregator.onStatus((s) => {
  currentStatuses.set(s.platform, s)
  pushEvent('platform_status', s)
  log.info('Status', {
    channel: s.channelLogin,
    mode: s.mode,
    platform: s.platform,
    status: s.status,
  })
})

watchedChannelManager.onMessage((channelId, message) => {
  pushEvent('watched_channel_message', { channelId, message })
  log.info('Watched message', {
    author: message.author.displayName,
    channelId,
    platform: message.platform,
  })
})

watchedChannelManager.onStatus((channelId, status) => {
  pushEvent('watched_channel_status', { channelId, status })
  log.info('Watched status', {
    channelId,
    platform: status.platform,
    status: status.status,
  })
})

// ============================================================
// 6. Route backend messages → webview (auth flows only)
// ============================================================

backendConn.onMessage((msg) => {
  switch (msg.type) {
    case 'auth_url': {
      pushEvent('auth_url', { platform: msg.platform, url: msg.url })
      openBrowser(msg.url)
      break
    }
    case 'auth_success': {
      pushEvent('auth_success', {
        platform: msg.platform,
        username: msg.username,
        displayName: msg.displayName,
      })
      break
    }
    case 'auth_error': {
      pushEvent('auth_error', { platform: msg.platform, error: msg.error })
      break
    }
    case 'pong':
      break
    case 'error': {
      log.error('Backend error', { message: msg.message })
      break
    }
    case 'seventv_emote_set': {
      pushEvent('channel_emotes_set', {
        platform: msg.platform,
        channelId: msg.channelId,
        emotes: msg.emotes,
      })
      break
    }
    case 'seventv_emote_added': {
      pushEvent('channel_emote_added', {
        platform: msg.platform,
        channelId: msg.channelId,
        emote: msg.emote,
      })
      break
    }
    case 'seventv_emote_removed': {
      pushEvent('channel_emote_removed', {
        platform: msg.platform,
        channelId: msg.channelId,
        emoteId: msg.emoteId,
      })
      break
    }
    case 'seventv_emote_updated': {
      pushEvent('channel_emote_updated', {
        platform: msg.platform,
        channelId: msg.channelId,
        emoteId: msg.emoteId,
        newAlias: msg.alias,
      })
      break
    }
    default:
      break
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
      text: `Active emote set changed to \u00ab${msg.setName}\u00bb`,
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
      text: `Emote set \u00ab${msg.oldName}\u00bb renamed to \u00ab${msg.newName}\u00bb`,
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
      text: `Emote set \u00ab${msg.setName}\u00bb was deleted`,
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
    author: { badges: [], color: '#6441a5', displayName: '7TV', id: '7tv-system', username: '7TV' },
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
// 7. Backend connection
// ============================================================

backendConn.connect()

setInterval(() => {
  backendConn.send({ type: 'ping' })
}, 30_000)

// ============================================================
// 8. Auto-connect to persisted channels
// ============================================================

const savedChannels = ChannelStore.findAll()
const connectedPlatforms = new Set<string>()

for (const [platform, slugs] of Object.entries(savedChannels)) {
  for (const slug of slugs ?? []) {
    const adapter = aggregator.getAdapter(platform as Platform)
    if (!adapter) {
      log.warn('No adapter for platform', { action: 'AutoConnect', platform })
      continue
    }
    connectedPlatforms.add(platform)
    log.info('Connecting to channel', { action: 'AutoConnect', platform, slug })
    adapter
      .connect(slug)
      .then(() => {
        log.info('Connected', { action: 'AutoConnect', platform, slug })
        let sevenTvChannelId = slug
        let sevenTvPlatformUserId: string | undefined
        if (platform === 'kick') {
          const kickAdapterCast = adapter as KickAdapter
          const broadcasterUserId = kickAdapterCast.getBroadcasterUserId()
          if (broadcasterUserId) sevenTvChannelId = String(broadcasterUserId)
        } else if (platform === 'twitch') {
          sevenTvPlatformUserId = getSevenTvTwitchPlatformUserId(slug)
        }
        sevenTVService
          .subscribeToChannel(platform as Platform, sevenTvChannelId, [slug], sevenTvPlatformUserId)
          .catch((error) => {
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

const accounts = AccountStore.findAll()
for (const account of accounts) {
  if (account.platform === 'youtube' || account.platform === 'kick') {
    if (connectedPlatforms.has(account.platform)) continue

    const adapter = aggregator.getAdapter(account.platform)
    if (!adapter) {
      log.warn('No adapter for platform', {
        action: 'AutoConnectAccount',
        platform: account.platform,
      })
      continue
    }

    const channelSlug = account.username
    log.info("Auto-connecting to user's channel", {
      action: 'AutoConnectAccount',
      channel: channelSlug,
      platform: account.platform,
    })

    ChannelStore.save(account.platform, channelSlug)

    adapter
      .connect(channelSlug)
      .then(() => {
        log.info("Connected to user's channel", {
          action: 'AutoConnectAccount',
          channel: channelSlug,
          platform: account.platform,
        })
        let sevenTvChannelId = channelSlug
        let sevenTvPlatformUserId: string | undefined
        if (account.platform === 'kick') {
          const kickAdapterCast = adapter as KickAdapter
          const broadcasterUserId = kickAdapterCast.getBroadcasterUserId()
          if (broadcasterUserId) sevenTvChannelId = String(broadcasterUserId)
        } else if (account.platform === 'twitch') {
          sevenTvPlatformUserId = getSevenTvTwitchPlatformUserId(channelSlug)
        }
        sevenTVService
          .subscribeToChannel(
            account.platform,
            sevenTvChannelId,
            [channelSlug],
            sevenTvPlatformUserId,
          )
          .catch((error) => {
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
// 9. Auto-connect watched channels
// ============================================================

watchedChannelManager.autoConnect().catch((error) => {
  log.error('Failed to auto-connect watched channels', { error: String(error) })
})

log.info('Ready')

// ============================================================
// Helpers
// ============================================================

function openBrowser(url: string): void {
  Deno.open(url).catch(() => {
    log.error('Failed to open browser', { action: 'auth', url })
    log.info('Please open manually', { action: 'auth', url })
  })
}
