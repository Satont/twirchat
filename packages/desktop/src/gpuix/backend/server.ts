import { dirname, join } from 'node:path'

import { DEV_SERVER_PORT } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import { normalizeMessageChannel } from '@twirchat/shared/message-identity'
import type { TwitchActivitySnapshotPart } from '@twirchat/shared/twitch-activities'
import type { Platform, PlatformStatusInfo } from '@twirchat/shared/types'
/**
 * GPUIX backend bridge — process bootstrap.
 *
 * Ports the Electrobun main process boot (src/bun/index.ts) into a plain
 * Bun module: SQLite, platform adapters, chat aggregator, backend WS,
 * 7TV service, watched channels, auth server, OBS overlay server.
 *
 * Instead of an Electrobun RPC boundary it returns `{ api, events }`, an
 * in-process equivalent of the Wails gateway contract.
 *
 * The result is cached on `globalThis` so `bun --hot` reloads re-mount the
 * React tree without re-booting (and re-connecting) the whole backend.
 */
import { z } from 'zod'

import { setAuthServerRpcSender, setOnAuthSuccessCallback, startAuthServer } from '../../auth'
import { BackendConnection } from '../../backend-connection'
import { APP_ENV, BACKEND_URL, BACKEND_WS_URL } from '../../build-info'
import { ChatAggregator } from '../../chat/aggregator'
import {
  pushOverlayEvent,
  pushOverlayMessage,
  pushOverlayPluginMessage,
  startOverlayServer,
} from '../../overlay-server'
import { KickAdapter } from '../../platforms/kick/adapter'
import { TwitchAdapter } from '../../platforms/twitch/adapter'
import { YouTubeAdapter, configureYouTubeChatRelay } from '../../platforms/youtube/adapter'
import { createYouTubeChatRelay } from '../../platforms/youtube/relay'
import { createPluginManager } from '../../plugins/manager'
import { getDbPath, setRuntimeConfig } from '../../runtime-config'
import { createAccountSessions } from '../../services/account-sessions'
import {
  createChannelActions,
  DEFAULT_PLAYER_SETTINGS,
  PLAYER_SETTINGS_KEY,
  validatePlayerSettings,
  spawnChannelPlayer,
} from '../../services/channel-actions'
import { normalizedChatMessageSchema } from '../../services/persisted-schemas'
import { createDesktopProviderRuntime } from '../../services/provider-runtime'
import { buildSevenTvSystemMessage } from '../../services/seventv-system-message'
import { createStreamerModeService } from '../../services/streamer-mode'
import { TwitchActivityRefreshClient } from '../../services/twitch-activity-refresh'
import { TwitchEventSubClient } from '../../services/twitch-eventsub'
import { sevenTVService } from '../../seventv'
import { AccountStore, ChannelStore, SettingsStore } from '../../store'
import { getClientSecret } from '../../store/client-secret'
import { getDb } from '../../store/db'
import { initDb } from '../../store/db'
import { TwitchWebSessionStore } from '../../store/twitch-web-session-store'
import {
  HOME_PLUGIN_CHANNELS_KEY,
  readHomePluginChannelIds,
} from '../../watched-channels/home-plugin-preference'
import { WatchedChannelManager } from '../../watched-channels/manager'
import { createPluginChannels } from '../../watched-channels/plugin-channels'
import {
  createDesktopApi,
  twitchActivitiesRequest,
  requestTwitchActivitiesSnapshot,
  type DesktopApi,
} from './api'
import { twitchEventSubscriptionSchema } from './api-schemas'
import { recordChatMessage } from './chat-history'
import { createDesktopEvents, type DesktopEvents } from './events'
import { readUiState } from './layout-api'
import { browserCommand } from './open-url'
import { createPluginHost } from './plugin-host'
import { createTwitchHistoryRuntime } from './twitch-history'
import { createUpdater } from './updater'

const log = logger('gpuix-backend')

export interface DesktopBackend {
  api: DesktopApi
  events: DesktopEvents
  plugins?: Pick<
    ReturnType<typeof createPluginManager>,
    | 'list'
    | 'install'
    | 'checkForUpdate'
    | 'setEnabled'
    | 'remove'
    | 'hasCommand'
    | 'runCommand'
    | 'commandNames'
  >
  dispose?: () => void
  shutdownPlugins?: () => Promise<void>
}

/** Open a URL in the system default browser (replaces Electrobun Utils.openExternal). */
function openBrowser(url: string): void {
  try {
    Bun.spawn(browserCommand(url), { stdout: 'ignore', stderr: 'ignore' }).unref()
  } catch (error) {
    log.error('Failed to open browser', { url, error: String(error) })
    log.info('Please open manually', { url })
  }
}

function boot(): DesktopBackend {
  log.info('Starting GPUIX backend...')

  // Runtime config: baked in at release build (--define), env overridable in dev.
  const nodeEnv = APP_ENV
  setRuntimeConfig({
    backendUrl: BACKEND_URL,
    backendWsUrl: BACKEND_WS_URL,
    nodeEnv,
  })

  initDb()
  log.info('Database ready')

  const clientSecret = getClientSecret()
  setRuntimeConfig({ clientSecret })

  const events = createDesktopEvents()
  const providerRuntime = createDesktopProviderRuntime(
    (platform, channelId, emotes) =>
      events.emit('channel_emote_catalog', { platform, channelId, emotes }),
    (platform, authorId, emotes) =>
      events.emit('author_emote_catalog', { platform, authorId, emotes }),
  )
  providerRuntime.start()
  const backendConn = new BackendConnection(clientSecret)
  configureYouTubeChatRelay(createYouTubeChatRelay(backendConn))
  const aggregator = new ChatAggregator(500, (message) => providerRuntime.enrich(message))
  const currentStatuses = new Map<string, PlatformStatusInfo>()

  sevenTVService.sendToBackend = (message) => {
    backendConn.send(message)
  }

  const twitchAdapter = new TwitchAdapter()
  const kickAdapter = new KickAdapter()
  const youtubeAdapter = new YouTubeAdapter()
  aggregator.registerAdapter(twitchAdapter)
  aggregator.registerAdapter(kickAdapter)
  aggregator.registerAdapter(youtubeAdapter)

  startOverlayServer()

  const watchedChannelManager = new WatchedChannelManager((message) =>
    providerRuntime.enrich(message),
  )
  let twitchEventSubConnected = false
  let twitchActivityRefresh: TwitchActivityRefreshClient | undefined
  const twitchEventSub = new TwitchEventSubClient({
    hasAccount: () => !!AccountStore.findByPlatform('twitch'),
    subscribe: (sessionId, channelSlug) =>
      twitchActivitiesRequest(
        'subscribe',
        { sessionId, channelSlug },
        z.object({
          subscriptions: z.array(twitchEventSubscriptionSchema),
          errors: z.array(z.string()),
        }),
      ),
    unsubscribe: async (ids) => {
      await twitchActivitiesRequest('unsubscribe', { ids }, z.object({ success: z.boolean() }))
    },
    activity: (event) => {
      if (event.eventType === 'stream.online' || event.eventType === 'stream.offline')
        twitchActivityRefresh?.setChannelOnline(
          event.channelId,
          event.eventType === 'stream.online',
        )
      events.emit('twitch_activity', event)
    },
    autoMod: (event) => events.emit('twitch_automod', event),
    moderationNotice: (message) => {
      if (AccountStore.findByPlatform('twitch')?.username.toLowerCase() === message.channelId)
        events.emit('twitch_chat_notice', { message })
      const watchedChannelId = watchedChannelManager.findActiveChannelId(
        'twitch',
        message.channelId,
      )
      if (watchedChannelId) events.emit('twitch_chat_notice', { message, watchedChannelId })
    },
    whisper: (event) => events.emit('twitch_whisper', event),
    status: (status) => {
      twitchEventSubConnected = status.status === 'connected'
      events.emit('twitch_eventsub_status', status)
    },
  })
  twitchActivityRefresh = new TwitchActivityRefreshClient({
    async plan(channelSlug) {
      const account = AccountStore.findByPlatform('twitch')
      if (!account)
        return {
          mode: 'unavailable',
          snapshotSections: [],
          error: 'Connect Twitch to load channel activities.',
        }
      const own = channelSlug.toLowerCase() === account.username.toLowerCase()
      const web = await TwitchWebSessionStore.status()
      const hasWeb = web.configured && web.userId === account.platformUserId
      const allowed = (...names: string[]) => names.some((scope) => account.scopes.includes(scope))
      const polls = own && allowed('channel:read:polls', 'channel:manage:polls')
      const predictions = own && allowed('channel:read:predictions', 'channel:manage:predictions')
      const rewards = own && allowed('channel:read:redemptions', 'channel:manage:redemptions')
      const eventsub = own && twitchEventSubConnected
      const sections: TwitchActivitySnapshotPart[] = ['pinnedMessage']
      if ((hasWeb || polls) && !(eventsub && polls)) sections.push('polls')
      if ((hasWeb || predictions) && !(eventsub && predictions)) sections.push('predictions')
      if ((hasWeb || rewards) && !(eventsub && rewards)) sections.push('rewards')
      if (hasWeb) sections.push('pointsBalance')
      return {
        mode: eventsub && (polls || predictions || rewards) ? 'eventsub' : 'snapshot',
        snapshotSections: sections,
        intervalMs: 15000,
        ...(!hasWeb && !(polls && predictions && rewards)
          ? {
              error:
                'Save a Twitch web session for viewer polls, predictions, rewards and points. Pin snapshots remain available.',
            }
          : {}),
      }
    },
    snapshot: (channelSlug, sections) => requestTwitchActivitiesSnapshot({ channelSlug, sections }),
    publish: (update) => events.emit('twitch_activity_snapshot', update),
    capability: (capability) => events.emit('twitch_activity_capability', capability),
  })
  let ownActivityChannel = AccountStore.findByPlatform('twitch')?.username
  if (ownActivityChannel)
    void twitchEventSub
      .watch(ownActivityChannel, true)
      .catch((error) =>
        events.emit('twitch_eventsub_status', { status: 'error', message: String(error) }),
      )
  else twitchEventSub.start()

  const refreshTwitchEvents = async () => {
    const next = AccountStore.findByPlatform('twitch')?.username
    twitchEventSub.stop()
    if (ownActivityChannel && ownActivityChannel !== next)
      await twitchEventSub.watch(ownActivityChannel, false)
    if (next && next !== ownActivityChannel) await twitchEventSub.watch(next, true)
    else twitchEventSub.start()
    ownActivityChannel = next
    twitchActivityRefresh?.restart()
  }

  const accountSessions = createAccountSessions({
    find: (id) => AccountStore.findById(id),
    active: (platform) => AccountStore.findByPlatform(platform),
    select: (platform, id) => AccountStore.setActive(platform, id),
    remove: (id) => AccountStore.delete(id),
    removeSession: async (account) => {
      if (account.platform === 'twitch')
        await TwitchWebSessionStore.clearForUser(account.platformUserId)
    },
    disconnect: async (platform) => {
      const channel = currentStatuses.get(platform)?.channelLogin
      await aggregator.getAdapter(platform)?.disconnect()
      providerRuntime.setJoined(`own:${platform}`, platform, null)
      if (channel) await sevenTVService.unsubscribeFromChannel(platform, channel, `own:${platform}`)
    },
    refreshIdentity: async (platform) => {
      providerRuntime.refreshAccounts()
      if (platform === 'twitch') await refreshTwitchEvents()
    },
    connectOwn: async (platform, account) => {
      if (!account) return
      const adapter = aggregator.getAdapter(platform)
      if (!adapter) return
      ChannelStore.save(platform, account.username)
      await adapter.connect(account.username)
      const status = currentStatuses.get(platform)
      if (status?.status === 'error')
        throw new Error(status.error ?? 'The account chat could not connect.')
      subscribeSevenTvFor(platform, account.username, aggregator)
    },
    reconnectWatched: (platform) => watchedChannelManager.reconnectByPlatform(platform),
    changed: (platform, identityChanged) =>
      events.emit('accounts_changed', { platform, identityChanged }),
  })

  // OAuth saves and selects atomically, then rejoins through the manual-switch queue.
  setOnAuthSuccessCallback(async (platform, _channelSlug, accountId) => {
    if (!accountId) return
    try {
      await accountSessions.select(platform, accountId, true)
    } catch (error) {
      log.error('Account saved but reconnection failed', { platform, error: String(error) })
      events.emit('auth_error', { platform, error: String(error) })
    }
  })

  // Auth server pushes into the event bus through a WebviewSender-shaped adapter.
  const forward = <K extends keyof import('./events').DesktopEventMap>(
    name: K,
  ): ((payload: import('./events').DesktopEventMap[K]) => void) => {
    return (payload) => events.emit(name, payload)
  }
  setAuthServerRpcSender({
    chat_message: forward('chat_message'),
    chat_event: forward('chat_event'),
    platform_status: forward('platform_status'),
    auth_url: forward('auth_url'),
    auth_success: forward('auth_success'),
    auth_error: forward('auth_error'),
    update_status: forward('update_status'),
    watched_channel_message: forward('watched_channel_message'),
    watched_channel_status: forward('watched_channel_status'),
    channel_emotes_set: forward('channel_emotes_set'),
    channel_emote_added: forward('channel_emote_added'),
    channel_emote_removed: forward('channel_emote_removed'),
    channel_emote_updated: forward('channel_emote_updated'),
  })

  startAuthServer()

  const channelActions = createChannelActions({
    activeAccounts: () => AccountStore.findAllActive(),
    reconnectOwn: (platform) => accountSessions.reconnectOwn(platform),
    reconnectWatched: (id) => watchedChannelManager.reconnect(id),
    reloadEmotes: (platform, channel, kind) => providerRuntime.reload(platform, channel, kind),
    readPlayerSettings: () => {
      const row = getDb()
        .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
        .get(`gpuix_ui_${PLAYER_SETTINGS_KEY}`)
      return row
        ? validatePlayerSettings(JSON.parse(row.value))
        : structuredClone(DEFAULT_PLAYER_SETTINGS)
    },
    writePlayerSettings: (settings) => {
      getDb().run(
        'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        [`gpuix_ui_${PLAYER_SETTINGS_KEY}`, JSON.stringify(settings)],
      )
    },
    openBrowser: (url) => openBrowser(url),
    spawnPlayer: spawnChannelPlayer,
  })
  const streamerMode = createStreamerModeService({
    read: () => {
      const row = getDb()
        .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key=?')
        .get('gpuix_ui_streamer_mode_v1')
      return row ? JSON.parse(row.value) : null
    },
    write: (value) => {
      getDb().run(
        'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        ['gpuix_ui_streamer_mode_v1', JSON.stringify(value)],
      )
    },
    publish: (status) => events.emit('streamer_mode_changed', status),
  })
  streamerMode.start()
  const twitchHistory = createTwitchHistoryRuntime({
    channels: () => [
      ...AccountStore.findAllActive()
        .filter((account) => account.platform === 'twitch')
        .map((account) => account.username),
      ...watchedChannelManager
        .getAll()
        .filter((channel) => channel.platform === 'twitch')
        .map((channel) => channel.channelSlug),
    ],
    warmChannel: (channel) => providerRuntime.warm('twitch', channel),
    publish: (channelId, messages) => {
      const own = currentStatuses.get('twitch')
      if (
        own?.status === 'connected' &&
        normalizeMessageChannel('twitch', own.channelLogin ?? '') === channelId
      ) {
        events.emit('chat_history_snapshot', { channelId, messages })
      }
      for (const channel of watchedChannelManager.getAll()) {
        if (
          channel.platform === 'twitch' &&
          normalizeMessageChannel('twitch', channel.channelSlug) === channelId
        ) {
          events.emit('chat_history_snapshot', {
            channelId,
            messages,
            watchedChannelId: channel.id,
          })
        }
      }
    },
  })
  const refreshTwitchHistory = (channel: string) => {
    void twitchHistory
      .refresh(channel)
      .catch((error) => log.debug('Twitch history unavailable', { channel, error: String(error) }))
  }
  const plugins: ReturnType<typeof createPluginManager> = createPluginManager({
    directory: join(dirname(getDbPath()), 'plugins'),
    host: createPluginHost({ events, getApi: () => api, getPluginChannels: () => pluginChannels }),
    onChange: () => {
      pluginChannels.transportChanged()
      events.emit('plugins_changed', plugins.list())
    },
  })
  let homePluginChannelIds = readHomePluginChannelIds(readUiState(HOME_PLUGIN_CHANNELS_KEY))
  const pluginChannels: ReturnType<typeof createPluginChannels> = createPluginChannels({
    manager: plugins,
    onMessage: (channel, message) => {
      if (homePluginChannelIds.has(channel.id)) pushOverlayPluginMessage(channel, message)
      events.emit('plugin_channel_message', { channel, message })
    },
    onStatus: (channel, status) => events.emit('plugin_channel_status', { channel, status }),
  })
  const updater = createUpdater(events)
  const api: DesktopApi = createDesktopApi({
    updater,
    twitchHistory,
    streamerMode,
    channelActions,
    accountSessions,
    providerRuntime,
    twitchActivityRefresh,
    twitchEventSub,
    aggregator,
    backendConn,
    watchedChannelManager,
    pluginChannels,
    onUiStateSaved: (key, value) => {
      if (key === HOME_PLUGIN_CHANNELS_KEY) homePluginChannelIds = readHomePluginChannelIds(value)
    },
    currentStatuses,
    events,
    openBrowser,
  })
  let pluginShutdown: Promise<void> | undefined
  function shutdownPlugins(): Promise<void> {
    return (pluginShutdown ??= Promise.allSettled([
      plugins.dispose(),
      pluginChannels.dispose(),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected')
          log.warn('Plugin shutdown failed', { error: String(result.reason) })
      }
    }))
  }

  const stopAutoChecks = updater.startAutoChecks(
    () => SettingsStore.get().autoCheckUpdates === true,
  )

  // ── Adapter events → stores / overlay / UI ────────────────────────────────

  aggregator.onMessage((msg) => {
    recordChatMessage(msg)
    pushOverlayMessage(msg)
    events.emit('chat_message', msg)
  })
  aggregator.onNotice((message) => events.emit('twitch_chat_notice', { message }))
  watchedChannelManager.onNotice((watchedChannelId, message) =>
    events.emit('twitch_chat_notice', { message, watchedChannelId }),
  )

  const seenChatEvents = new Set<string>()
  const emitChatEvent = (event: Parameters<typeof pushOverlayEvent>[0]) => {
    const channelId =
      typeof event.data.channelId === 'string'
        ? event.data.channelId
        : (AccountStore.findByPlatform(event.platform)?.username ?? '')
    const key = JSON.stringify([
      event.platform,
      event.platform === 'youtube' && channelId.startsWith('UC')
        ? channelId
        : channelId.replace(/^@/, '').toLowerCase(),
      event.id,
    ])
    if (seenChatEvents.has(key)) return
    seenChatEvents.add(key)
    if (seenChatEvents.size > 10000) seenChatEvents.delete(seenChatEvents.values().next().value!)
    events.emit('chat_event', event)
  }
  aggregator.onEvent((ev) => {
    pushOverlayEvent(ev)
    emitChatEvent(ev)
  })
  watchedChannelManager.onEvent((_channelId, event) => emitChatEvent(event))

  aggregator.onStatus((s) => {
    providerRuntime.setJoined(
      `own:${s.platform}`,
      s.platform,
      s.status === 'connected' ? (s.channelLogin ?? null) : null,
    )
    currentStatuses.set(s.platform, s)
    events.emit('platform_status', s)
    if (s.platform === 'twitch' && s.status === 'connected' && s.channelLogin)
      refreshTwitchHistory(s.channelLogin)
  })
  aggregator.onModeration((outcome) => events.emit('chat_moderation', outcome))
  aggregator.onRoomState((state) => events.emit('channel_room_state', state))
  aggregator.onChatClear((clear) => events.emit('chat_clear', clear))
  watchedChannelManager.onModeration((outcome) => events.emit('chat_moderation', outcome))
  watchedChannelManager.onRoomState((state) => events.emit('channel_room_state', state))
  watchedChannelManager.onChatClear((clear) => events.emit('chat_clear', clear))

  watchedChannelManager.onMessage((channelId, message) => {
    recordChatMessage(message)
    events.emit('watched_channel_message', { channelId, message })
  })

  watchedChannelManager.onStatus((channelId, status) => {
    const channel = watchedChannelManager.getAll().find((candidate) => candidate.id === channelId)
    if (channel)
      providerRuntime.setJoined(
        `watched:${channelId}`,
        channel.platform,
        status.status === 'connected' ? channel.channelSlug : null,
      )
    events.emit('watched_channel_status', { channelId, status })
    if (channel?.platform === 'twitch' && status.status === 'connected')
      refreshTwitchHistory(channel.channelSlug)
  })

  // ── Backend WS → UI / services ────────────────────────────────────────────

  backendConn.onMessage((msg) => {
    switch (msg.type) {
      case 'auth_url': {
        events.emit('auth_url', { platform: msg.platform, url: msg.url })
        openBrowser(msg.url)
        break
      }
      case 'auth_success': {
        events.emit('auth_success', {
          platform: msg.platform,
          username: msg.username,
          displayName: msg.displayName,
        })
        break
      }
      case 'auth_error': {
        events.emit('auth_error', { platform: msg.platform, error: msg.error })
        break
      }
      case 'seventv_emote_set': {
        sevenTVService.handleEmoteSet(msg.platform, msg.channelId, msg.emotes)
        providerRuntime.refreshChannel(msg.platform, msg.channelId)
        events.emit('channel_emotes_set', {
          platform: msg.platform,
          channelId: msg.channelId,
          emotes: msg.emotes,
        })
        break
      }
      case 'seventv_emote_added': {
        sevenTVService.handleEmoteAdded(msg.platform, msg.channelId, msg.emote)
        providerRuntime.refreshChannel(msg.platform, msg.channelId)
        events.emit('channel_emote_added', {
          platform: msg.platform,
          channelId: msg.channelId,
          emote: msg.emote,
        })
        break
      }
      case 'seventv_emote_removed': {
        sevenTVService.handleEmoteRemoved(msg.platform, msg.channelId, msg.emoteId)
        providerRuntime.refreshChannel(msg.platform, msg.channelId)
        events.emit('channel_emote_removed', {
          platform: msg.platform,
          channelId: msg.channelId,
          emoteId: msg.emoteId,
        })
        break
      }
      case 'seventv_emote_updated': {
        sevenTVService.handleEmoteUpdated(msg.platform, msg.channelId, msg.emoteId, msg.alias)
        providerRuntime.refreshChannel(msg.platform, msg.channelId)
        events.emit('channel_emote_updated', {
          platform: msg.platform,
          channelId: msg.channelId,
          emoteId: msg.emoteId,
          newAlias: msg.alias,
        })
        break
      }
      case 'pong':
        break
      case 'error': {
        log.error('Backend error', { message: msg.message })
        break
      }
      default:
        break
    }
  })

  backendConn.onSystemMessage((msg) => {
    aggregator.injectMessage(
      buildSevenTvSystemMessage(msg, {
        id: `7tv-system-${Date.now()}-${Math.random()}`,
        timestamp: new Date(),
      }),
    )
  })

  backendConn.connect()
  setInterval(() => {
    backendConn.send({ type: 'ping' })
  }, 30_000)

  // ── Connect authenticated own channels; watched chats follow open layouts ──

  for (const account of AccountStore.findAllActive()) {
    const adapter = aggregator.getAdapter(account.platform)
    if (!adapter) continue

    const channelSlug = account.username
    providerRuntime.setJoined(`own:${account.platform}`, account.platform, channelSlug)
    ChannelStore.save(account.platform, channelSlug)
    adapter
      .connect(channelSlug)
      .then(() => subscribeSevenTvFor(account.platform, channelSlug, aggregator))
      .catch((error) => {
        log.error("Auto-connect to account's channel failed", {
          platform: account.platform,
          channelSlug,
          error: String(error),
        })
      })
  }

  // Dev-only chat injection endpoint.
  if (nodeEnv !== 'production') {
    Bun.serve({
      port: DEV_SERVER_PORT,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/dev/inject-chat' && req.method === 'POST') {
          const parsed = normalizedChatMessageSchema.safeParse(await req.json().catch(() => null))
          if (!parsed.success) return new Response('Invalid chat message', { status: 400 })
          events.emit('chat_message', parsed.data)
          return new Response('ok')
        }
        if (url.pathname === '/dev/hook' && req.method === 'POST') {
          // Dev-only: let the UI layer register debug actions (see main.tsx).
          const parsed = z
            .object({ action: z.string(), payload: z.unknown().optional() })
            .safeParse(await req.json().catch(() => null))
          if (!parsed.success) return new Response('Invalid debug action', { status: 400 })
          const body = parsed.data
          const hook = globalThis.__twirchatDevHook
          if (!hook) return new Response('no hook', { status: 404 })
          const result = await hook(body.action, body.payload)
          return new Response(JSON.stringify(result ?? null), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response('not found', { status: 404 })
      },
    })
    log.info(`[Dev] Test injection endpoint listening on port ${DEV_SERVER_PORT}`)
  }

  void plugins.initialize().catch((error) => {
    log.error('Could not load installed plugins', { error: String(error) })
  })
  log.info('GPUIX backend ready')
  return {
    api,
    events,
    plugins,
    shutdownPlugins,
    dispose: () => {
      stopAutoChecks()
      void shutdownPlugins().catch((error) => {
        log.warn('Plugin shutdown failed', { error: String(error) })
      })
      twitchHistory.dispose()
      streamerMode.stop()
      providerRuntime.stop()
      twitchEventSub.stop()
      twitchActivityRefresh?.stop()
    },
  }
}

function subscribeSevenTvFor(
  platform: Platform,
  channelSlug: string,
  aggregator: ChatAggregator,
): void {
  const adapter = aggregator.getAdapter(platform)
  let sevenTvChannelId = channelSlug
  let sevenTvPlatformUserId: string | undefined
  if (platform === 'kick' && adapter) {
    const broadcasterUserId =
      adapter instanceof KickAdapter ? adapter.getBroadcasterUserId() : undefined
    if (broadcasterUserId) sevenTvChannelId = String(broadcasterUserId)
  } else if (platform === 'twitch') {
    const twitchAccount = AccountStore.findByPlatform('twitch')
    if (twitchAccount && twitchAccount.username.toLowerCase() === channelSlug.toLowerCase()) {
      sevenTvPlatformUserId = twitchAccount.platformUserId
    }
  }
  sevenTVService
    .subscribeToChannel(
      platform,
      sevenTvChannelId,
      [channelSlug],
      sevenTvPlatformUserId,
      `own:${platform}`,
    )
    .catch((error) => {
      log.error('Failed to subscribe to 7TV', { platform, channelSlug, error: String(error) })
    })
}

// ── Singleton (survives `bun --hot` reloads) ────────────────────────────────

declare global {
  var __twirchatGpuixBackend: DesktopBackend | undefined
  var __twirchatDevHook: ((action: string, payload?: unknown) => Promise<unknown>) | undefined
}

export function getDesktopBackend(): DesktopBackend {
  return (globalThis.__twirchatGpuixBackend ??= boot())
}
