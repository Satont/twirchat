import { dirname, join } from 'node:path'

import {
  donationChannelKey,
  SHAREABLE_DONATION_PROVIDERS,
  type DonationShareIdentity,
} from '@twirchat/shared/donations'
import { logger } from '@twirchat/shared/logger'
import { normalizeMessageChannel } from '@twirchat/shared/message-identity'
import type {
  Account,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
} from '@twirchat/shared/types'
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

import { setAuthServerRpcSender, setOnAuthSuccessCallback, startAuthServer } from '../../auth'
import { checkTwitchSession } from '../../auth/twitch'
import { BackendConnection } from '../../backend-connection'
import { APP_ENV, BACKEND_URL, BACKEND_WS_URL } from '../../build-info'
import { ChatAggregator } from '../../chat/aggregator'
import { createDonationService } from '../../donations/service'
import { createDonationShareClient } from '../../donations/share-client'
import { setLanguage, t } from '../../i18n'
import {
  pushOverlayEvent,
  pushOverlayMessage,
  pushOverlayPluginMessage,
  startOverlayServer,
} from '../../overlay-server'
import { KickAdapter } from '../../platforms/kick/adapter'
import { TwitchAdapter, type TwitchModerationEvents } from '../../platforms/twitch/adapter'
import { createTwitchBadgeCatalog } from '../../platforms/twitch/badge-catalog'
import { createDefaultTwitchSenderPool } from '../../platforms/twitch/sender-pool'
import { VkPlayAdapter } from '../../platforms/vkplay/adapter'
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
import { channelAccount } from '../../services/chat-accounts'
import { createDesktopProviderRuntime } from '../../services/provider-runtime'
import { buildSevenTvSystemMessage } from '../../services/seventv-system-message'
import { createStreamerModeService } from '../../services/streamer-mode'
import { TwitchActivityRefreshClient } from '../../services/twitch-activity-refresh'
import { TwitchEventSubClient } from '../../services/twitch-eventsub'
import { createTwitchEventSubAccounts } from '../../services/twitch-eventsub-accounts'
import { createTwitchHistoryClient } from '../../services/twitch-history'
import { parseTwitchRewardNotice } from '../../services/twitch-reward-notice'
import { sevenTVService } from '../../seventv'
import { AccountStore, ChannelStore, SettingsStore } from '../../store'
import { getClientSecret } from '../../store/client-secret'
import { getDb } from '../../store/db'
import { initDb } from '../../store/db'
import { createTwitchBadgeCatalogStore } from '../../store/twitch-badge-catalog-store'
import {
  TwitchPointsSessionStore,
  TwitchWebSessionStore,
} from '../../store/twitch-web-session-store'
import { createChatAccountSender } from '../../watched-channels/account-sender'
import {
  HOME_PLUGIN_CHANNELS_KEY,
  readHomePluginChannelIds,
} from '../../watched-channels/home-plugin-preference'
import { WatchedChannelManager } from '../../watched-channels/manager'
import { createPluginChannels } from '../../watched-channels/plugin-channels'
import {
  createDesktopApi,
  planTwitchActivitySnapshot,
  subscribeTwitchActivities,
  unsubscribeTwitchActivities,
  requestTwitchActivitiesSnapshot,
  type DesktopApi,
} from './api'
import { flushChatLogs, recordChatMessage } from './chat-history'
import type { DesktopBackend } from './contract'
import { startDesktopDevServer } from './dev-server'
import { createDesktopEvents, type DesktopEvents } from './events'
import { readUiState } from './layout-api'
import { browserCommand } from './open-url'
import { createPluginHost } from './plugin-host'
import { createTwitchHistoryRuntime } from './twitch-history'
import { createUpdater } from './updater'

const log = logger('gpuix-backend')
const isHomeTwitchChannel = (channel: string) =>
  AccountStore.findByPlatform('twitch')?.username.toLowerCase() === channel

function accountWithTwitchToken(account: Account | null): Account | null {
  return account && AccountStore.getTokens(account.id) ? account : null
}

interface DesktopRuntime extends DesktopBackend {
  events: DesktopEvents
  dispose(): Promise<void>
  shutdownPlugins(): Promise<void>
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

function boot(scheduleUpdateExit?: () => void): DesktopRuntime {
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
  // Before any window, adapter or notice produces text: everything after this speaks the saved language.
  setLanguage(SettingsStore.get().language)

  const clientSecret = getClientSecret()
  setRuntimeConfig({ clientSecret })

  const events = createDesktopEvents()
  const donations = createDonationService({
    db: getDb(),
    openBrowser: async (url) => {
      const browser = Bun.spawn(browserCommand(url), { stdout: 'ignore', stderr: 'ignore' })
      if ((await browser.exited) !== 0) throw new Error('Could not open the browser.')
    },
    onConnections: (connections) => {
      events.emit('donation_connections', connections)
      updateDonationSharing()
    },
    onDonation: (event) => events.emit('donation_received', event),
    onSharing: (sharing) => {
      events.emit('donation_sharing', sharing)
      updateDonationSharing()
    },
    onShare: (event) => donationShare.share(event),
  })
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

  const twitchSenders = createDefaultTwitchSenderPool()
  const twitchBadges = createTwitchBadgeCatalog({ storage: createTwitchBadgeCatalogStore() })
  // Channel Moderate repeats IRC bans and timeouts with the acting moderator.
  const twitchModerationEvents: TwitchModerationEvents = {
    hasModerationEvents: (channelSlug) => twitchEventSub.hasModerationEvents(channelSlug),
  }
  const twitchAdapter = new TwitchAdapter(twitchSenders, twitchBadges, twitchModerationEvents)
  const kickAdapter = new KickAdapter()
  const youtubeAdapter = new YouTubeAdapter()
  const vkPlayAdapter = new VkPlayAdapter()
  const ownAdapters = [twitchAdapter, kickAdapter, youtubeAdapter, vkPlayAdapter]
  for (const adapter of ownAdapters) aggregator.registerAdapter(adapter)

  const overlayServer = startOverlayServer()

  const watchedChannelManager = new WatchedChannelManager(
    (message) => providerRuntime.enrich(message),
    (channel) =>
      channel.platform === 'twitch'
        ? new TwitchAdapter(twitchSenders, twitchBadges, twitchModerationEvents)
        : undefined,
    createChatAccountSender(twitchSenders),
  )
  const donationShare = createDonationShareClient({
    send: (message) => backendConn.send(message),
    isConnected: () => backendConn.isConnected,
    identities: () =>
      AccountStore.findAllActive().flatMap((account): DonationShareIdentity[] => {
        if (account.platform === 'youtube' || account.platform === 'vkplay') return []
        const accessToken = AccountStore.getTokens(account.id)?.accessToken
        return accessToken ? [{ platform: account.platform, accessToken }] : []
      }),
    watched: () =>
      watchedChannelManager
        .getActiveChannels()
        .flatMap((channel) =>
          channel.platform === 'youtube' || channel.platform === 'vkplay'
            ? []
            : [{ platform: channel.platform, channel: channel.channelSlug }],
        ),
  })
  function updateDonationSharing() {
    const sharing = donations.getSharing()
    const connections = donations.getConnections()
    donationShare.setEnabled(
      SHAREABLE_DONATION_PROVIDERS.some(
        (provider) => sharing[provider] && connections[provider].status !== 'disconnected',
      ),
    )
  }
  watchedChannelManager.onActiveChannelsChange(() => donationShare.syncWatched())
  backendConn.onConnectionStatus((connected) => {
    if (connected) donationShare.connected()
  })
  events.on('accounts_changed', () => donationShare.syncIdentities())
  let twitchEventSubConnected = false
  const emitTwitchNotice = (
    message: NormalizedChatMessage,
    destination: { home: boolean; watched: boolean },
  ) => {
    if (destination.home) events.emit('twitch_chat_notice', { message })
    if (destination.watched) {
      const watchedChannelId = watchedChannelManager.findActiveChannelId(
        'twitch',
        message.channelId,
      )
      if (watchedChannelId) events.emit('twitch_chat_notice', { message, watchedChannelId })
    }
  }
  const twitchEventSub = createTwitchEventSubAccounts({
    activeAccount: () => accountWithTwitchToken(AccountStore.findByPlatform('twitch')),
    channelAccount: (channelSlug) => accountWithTwitchToken(channelAccount('twitch', channelSlug)),
    clearAutoMod: (channelSlug) => events.emit('twitch_automod', { type: 'clear', channelSlug }),
    createClient(account, primary): TwitchEventSubClient {
      const ownsChannel = (channel: string) => twitchEventSub.ownsChannel(account.id, channel)
      return new TwitchEventSubClient({
        hasAccount: () => !!AccountStore.getTokens(account.id),
        senderUserId: account.platformUserId,
        receiveWhispers: primary,
        subscribe: (sessionId, channelSlug) =>
          subscribeTwitchActivities(account.id, sessionId, channelSlug),
        unsubscribe: (ids) => unsubscribeTwitchActivities(account.id, ids),
        activity: (event) => {
          if (event.eventType === 'stream.online' || event.eventType === 'stream.offline')
            twitchActivityRefresh.setChannelOnline(
              event.channelId,
              event.eventType === 'stream.online',
            )
          events.emit('twitch_activity', event)
          if (event.type === 'redemption' && event.channelId === account.platformUserId) {
            const message = parseTwitchRewardNotice(event)
            if (message)
              emitTwitchNotice(message, {
                home: primary && isHomeTwitchChannel(message.channelId),
                watched: ownsChannel(message.channelId),
              })
          }
        },
        autoMod: (event) => {
          if (event.channelSlug && ownsChannel(event.channelSlug))
            events.emit('twitch_automod', event)
        },
        senderNotice: (message) =>
          emitTwitchNotice(message, {
            home: primary && isHomeTwitchChannel(message.channelId),
            watched: ownsChannel(message.channelId),
          }),
        moderationNotice: (message) => {
          if (ownsChannel(message.channelId))
            emitTwitchNotice(message, {
              home: isHomeTwitchChannel(message.channelId),
              watched: true,
            })
        },
        whisper: (event) => events.emit('twitch_whisper', event),
        status: (status) => {
          if (status.status === 'error')
            log.warn('Twitch EventSub reported an error', { accountId: account.id })
          if (!primary) return
          twitchEventSubConnected = status.status === 'connected'
          events.emit('twitch_eventsub_status', status)
        },
      })
    },
  })
  const twitchActivityRefresh = new TwitchActivityRefreshClient({
    plan: (channelSlug) => planTwitchActivitySnapshot(channelSlug, twitchEventSubConnected),
    snapshot: (channelSlug, sections) => requestTwitchActivitiesSnapshot({ channelSlug, sections }),
    publish: (update) => events.emit('twitch_activity_snapshot', update),
    capability: (capability) => events.emit('twitch_activity_capability', capability),
  })
  twitchEventSub.refresh()

  const refreshTwitchEvents = () => {
    twitchEventSub.refresh(true)
    twitchActivityRefresh.restart()
  }

  const accountSessions = createAccountSessions({
    find: (id) => AccountStore.findById(id),
    active: (platform) => AccountStore.findByPlatform(platform),
    select: (platform, id) => AccountStore.setActive(platform, id),
    remove: (id) => AccountStore.delete(id),
    removeSession: async (account) => {
      if (account.platform === 'twitch')
        await Promise.all([
          TwitchWebSessionStore.clearForUser(account.platformUserId),
          TwitchPointsSessionStore.clearForUser(account.platformUserId),
        ])
    },
    disconnect: async (platform) => {
      const owner = `own:${platform}`
      try {
        await aggregator.getAdapter(platform)?.disconnect()
      } finally {
        providerRuntime.setJoined(owner, platform, null)
        await sevenTVService.unsubscribeOwner(owner)
      }
    },
    refreshIdentity: async (platform) => {
      providerRuntime.refreshAccounts()
      if (platform === 'twitch') refreshTwitchEvents()
    },
    connectOwn: async (platform, account, signal) => {
      if (!account) return
      const adapter = aggregator.getAdapter(platform)
      if (!adapter) return
      ChannelStore.save(platform, account.username)
      await adapter.connect(account.username)
      signal?.throwIfAborted()
      const status = currentStatuses.get(platform)
      if (status?.status === 'error')
        throw new Error(status.error ?? t('runtime.server.accountChatConnectFailed'))
      subscribeSevenTvFor(platform, account.username, aggregator)
    },
    reconnectWatched: (platform, signal) =>
      watchedChannelManager.reconnectByPlatform(platform, signal),
    changed: (platform, identityChanged) =>
      events.emit('accounts_changed', { platform, identityChanged }),
  })

  let validatingTwitchSessions = false
  let disposed = false
  async function validateTwitchSessions() {
    if (validatingTwitchSessions) return
    validatingTwitchSessions = true
    try {
      const accounts = AccountStore.findAllSaved().filter(
        (account) => account.platform === 'twitch',
      )
      const results = await Promise.allSettled(
        accounts.map(async (account) => {
          const ended = await checkTwitchSession(account.id, () => disposed)
          if (
            !ended ||
            disposed ||
            AccountStore.getTokens(account.id) ||
            !AccountStore.findById(account.id)
          )
            return
          twitchSenders.invalidate(account.id)
          twitchEventSub.refresh()
          events.emit('auth_error', {
            platform: 'twitch',
            error: t('runtime.auth.twitchReconnect', { username: account.username }),
          })
          if (AccountStore.findByPlatform('twitch')?.id === account.id) {
            const reconnects = await Promise.allSettled([
              accountSessions.reconnectOwn('twitch'),
              watchedChannelManager.reconnectByPlatform('twitch'),
            ])
            if (reconnects.some((result) => result.status === 'rejected'))
              log.warn('Could not reconnect some Twitch chats after authorization ended')
          }
        }),
      )
      const failed = results.filter((result) => result.status === 'rejected').length
      if (failed) log.warn('Could not validate some Twitch sessions', { failed })
    } finally {
      validatingTwitchSessions = false
    }
  }
  const checkTwitchSessions = () => {
    validateTwitchSessions().catch(() => log.warn('Could not validate Twitch sessions'))
  }
  checkTwitchSessions()
  const twitchValidationTimer = setInterval(checkTwitchSessions, 60 * 60 * 1000)

  // OAuth saves and selects atomically, then rejoins through the manual-switch queue.
  setOnAuthSuccessCallback(async (platform, _channelSlug, accountId, signal) => {
    if (!accountId) return
    try {
      await accountSessions.select(platform, accountId, true, signal)
    } catch (error) {
      if (signal?.aborted) return
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

  const authServer = startAuthServer()

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
    client: createTwitchHistoryClient({ badges: twitchBadges }),
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
  const updater = createUpdater(events, scheduleUpdateExit)
  const api: DesktopApi = createDesktopApi({
    donations,
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
      case 'shared_donation': {
        events.emit('shared_donation', {
          channelKey: donationChannelKey(msg.channel),
          donation: msg.donation,
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
    const notice = buildSevenTvSystemMessage(msg, {
      id: `7tv-system-${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
    })
    aggregator.injectMessage(notice)
    watchedChannelManager.injectSevenTvNotice(msg.platform, msg.channelId, notice)
  })

  backendConn.connect()

  // ── Connect authenticated own channels; watched chats follow open layouts ──

  for (const account of AccountStore.findAllActive()) {
    const adapter = aggregator.getAdapter(account.platform)
    if (!adapter) continue

    const channelSlug = account.username
    providerRuntime.setJoined(`own:${account.platform}`, account.platform, channelSlug)
    ChannelStore.save(account.platform, channelSlug)
    accountSessions
      .connectAtStartup(account, {
        connect: () => adapter.connect(channelSlug),
        onConnected: () => subscribeSevenTvFor(account.platform, channelSlug, aggregator),
      })
      .catch((error) => {
        log.error("Auto-connect to account's channel failed", {
          platform: account.platform,
          channelSlug,
          error: String(error),
        })
      })
  }

  const devServer =
    nodeEnv !== 'production'
      ? startDesktopDevServer({ events, getDebugHook: () => globalThis.__twirchatDevHook })
      : undefined
  if (devServer) log.info(`[Dev] Test injection endpoint listening on port ${devServer.port}`)

  void plugins.initialize().catch((error) => {
    log.error('Could not load installed plugins', { error: String(error) })
  })
  donations.start()
  log.info('GPUIX backend ready')
  return {
    api,
    events,
    plugins,
    shutdownPlugins,
    dispose: async () => {
      try {
        twitchActivityRefresh.stop()
        twitchEventSub.stop()
        accountSessions.stopStartupConnections()
        await authServer.stop().catch((error: unknown) => {
          log.warn('OAuth server shutdown failed', { error: String(error) })
        })
        disposed = true
        const stopOverlay = overlayServer.stop().catch((error: unknown) => {
          log.warn('OBS overlay server shutdown failed', { error: String(error) })
        })
        void devServer?.stop().catch((error) => {
          log.warn('Desktop dev server shutdown failed', { error: String(error) })
        })
        clearInterval(twitchValidationTimer)
        donations.dispose()
        stopAutoChecks()
        void shutdownPlugins().catch((error) => {
          log.warn('Plugin shutdown failed', { error: String(error) })
        })
        await Promise.all([
          accountSessions.dispose(ownAdapters.map(({ platform }) => platform)),
          watchedChannelManager.dispose(),
        ])
        twitchHistory.dispose()
        twitchBadges.dispose()
        twitchSenders.dispose()
        streamerMode.stop()
        providerRuntime.stop()
        backendConn.disconnect()
        await stopOverlay
      } finally {
        await flushChatLogs().catch((error: unknown) => {
          log.warn('Chat log flush failed during shutdown', { error: String(error) })
        })
      }
    },
  }
}

function subscribeSevenTvFor(
  platform: Platform,
  channelSlug: string,
  aggregator: ChatAggregator,
): void {
  if (platform === 'vkplay') return
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
  var __twirchatGpuixBackend: DesktopRuntime | undefined
  var __twirchatDevHook: ((action: string, payload?: unknown) => Promise<unknown>) | undefined
}

export function getDesktopBackend(scheduleUpdateExit?: () => void): DesktopRuntime {
  return (globalThis.__twirchatGpuixBackend ??= boot(scheduleUpdateExit))
}
