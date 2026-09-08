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

import type { NormalizedChatMessage, Platform, PlatformStatusInfo } from '@twirchat/shared/types'
import type { DesktopToBackendMessage } from '@twirchat/shared'
import { logger } from '@twirchat/shared/logger'

import { initDb } from '../../store/db'
import { getClientSecret } from '../../store/client-secret'
import { AccountStore, ChannelStore, MessageStore, UsernameColorCache } from '../../store'
import { BackendConnection } from '../../backend-connection'
import { ChatAggregator } from '../../chat/aggregator'
import { pushOverlayEvent, pushOverlayMessage, startOverlayServer } from '../../overlay-server'
import { TwitchAdapter } from '../../platforms/twitch/adapter'
import { KickAdapter } from '../../platforms/kick/adapter'
import { YouTubeAdapter } from '../../platforms/youtube/adapter'
import { sevenTVService } from '../../seventv'
import { WatchedChannelManager } from '../../watched-channels/manager'
import { setAuthServerRpcSender, setOnAuthSuccessCallback, startAuthServer } from '../../auth'
import { setRuntimeConfig } from '../../runtime-config'
import type { WebviewSender } from '../../shared/rpc'

import { createDesktopEvents, type DesktopEvents } from './events'
import { createDesktopApi, type DesktopApi } from './api'

const log = logger('gpuix-backend')

export interface DesktopBackend {
  api: DesktopApi
  events: DesktopEvents
}

/** Open a URL in the system default browser (replaces Electrobun Utils.openExternal). */
function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url.replaceAll('&', '^&')]
        : ['xdg-open', url]
  try {
    Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' }).unref()
  } catch (error) {
    log.error('Failed to open browser', { url, error: String(error) })
    log.info('Please open manually', { url })
  }
}

function boot(): DesktopBackend {
  log.info('Starting GPUIX backend...')

  // Runtime config: env-based (Bun auto-loads .env). Defaults target a local backend.
  const nodeEnv = process.env.NODE_ENV ?? 'development'
  setRuntimeConfig({
    backendUrl: process.env.CHATRIX_BACKEND_URL ?? 'http://127.0.0.1:3000',
    backendWsUrl: process.env.CHATRIX_BACKEND_WS_URL ?? 'ws://127.0.0.1:3000/ws',
    nodeEnv,
  })

  initDb()
  log.info('Database ready')

  const clientSecret = getClientSecret()
  setRuntimeConfig({ clientSecret })

  const events = createDesktopEvents()
  const backendConn = new BackendConnection(clientSecret)
  const aggregator = new ChatAggregator(500)
  const currentStatuses = new Map<string, PlatformStatusInfo>()

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

  // ── Auth flow wiring ──────────────────────────────────────────────────────

  setOnAuthSuccessCallback(async (platform, channelSlug) => {
    log.info('Authentication successful, reconnecting adapter', { platform })

    const adapter = aggregator.getAdapter(platform)
    if (!adapter) return

    const targetChannel = channelSlug || ChannelStore.findByPlatform(platform)[0]
    if (!targetChannel) return

    try {
      await adapter.disconnect()
      await adapter.connect(targetChannel)
      subscribeSevenTvFor(platform, targetChannel, aggregator)
    } catch (error) {
      log.error('Failed to reconnect adapter after auth', { platform, error: String(error) })
    }

    await watchedChannelManager.reconnectByPlatform(platform).catch((error) => {
      log.error('Failed to reconnect watched channels after auth', {
        platform,
        error: String(error),
      })
    })
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
  } as unknown as WebviewSender)

  startAuthServer()

  const api = createDesktopApi({
    aggregator,
    backendConn,
    watchedChannelManager,
    currentStatuses,
    events,
    openBrowser,
  })

  // ── Adapter events → stores / overlay / UI ────────────────────────────────

  aggregator.onMessage((msg) => {
    MessageStore.save(msg)
    UsernameColorCache.addMessage(msg)
    pushOverlayMessage(msg)
    events.emit('chat_message', msg)
  })

  aggregator.onEvent((ev) => {
    pushOverlayEvent(ev)
    events.emit('chat_event', ev)
  })

  aggregator.onStatus((s) => {
    currentStatuses.set(s.platform, s)
    events.emit('platform_status', s)
  })

  watchedChannelManager.onMessage((channelId, message) => {
    events.emit('watched_channel_message', { channelId, message })
  })

  watchedChannelManager.onStatus((channelId, status) => {
    events.emit('watched_channel_status', { channelId, status })
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
        events.emit('channel_emotes_set', {
          platform: msg.platform,
          channelId: msg.channelId,
          emotes: msg.emotes,
        })
        break
      }
      case 'seventv_emote_added': {
        sevenTVService.handleEmoteAdded(msg.platform, msg.channelId, msg.emote)
        events.emit('channel_emote_added', {
          platform: msg.platform,
          channelId: msg.channelId,
          emote: msg.emote,
        })
        break
      }
      case 'seventv_emote_removed': {
        sevenTVService.handleEmoteRemoved(msg.platform, msg.channelId, msg.emoteId)
        events.emit('channel_emote_removed', {
          platform: msg.platform,
          channelId: msg.channelId,
          emoteId: msg.emoteId,
        })
        break
      }
      case 'seventv_emote_updated': {
        sevenTVService.handleEmoteUpdated(msg.platform, msg.channelId, msg.emoteId, msg.alias)
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
    const systemMsg = buildSevenTvSystemMessage(msg)
    if (systemMsg) aggregator.injectMessage(systemMsg)
  })

  backendConn.connect()
  setInterval(() => {
    backendConn.send({ type: 'ping' })
  }, 30_000)

  // ── Auto-connect persisted channels + authenticated own channels ──────────

  const savedChannels = ChannelStore.findAll()
  const connectedPlatforms = new Set<string>()

  for (const [platform, slugs] of Object.entries(savedChannels)) {
    for (const slug of slugs ?? []) {
      const adapter = aggregator.getAdapter(platform as Platform)
      if (!adapter) continue
      connectedPlatforms.add(platform)
      adapter
        .connect(slug)
        .then(() => subscribeSevenTvFor(platform as Platform, slug, aggregator))
        .catch((error) => {
          log.error('Auto-connect failed', { platform, slug, error: String(error) })
        })
    }
  }

  for (const account of AccountStore.findAll()) {
    if (account.platform !== 'youtube' && account.platform !== 'kick') continue
    if (connectedPlatforms.has(account.platform)) continue

    const adapter = aggregator.getAdapter(account.platform)
    if (!adapter) continue

    const channelSlug = account.username
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

  watchedChannelManager.autoConnect().catch((error) => {
    log.error('Failed to auto-connect watched channels', { error: String(error) })
  })

  // Dev-only chat injection endpoint (same as the Electrobun build, port 45824).
  if (nodeEnv !== 'production') {
    Bun.serve({
      port: 45824,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/dev/inject-chat' && req.method === 'POST') {
          const body = (await req.json()) as NormalizedChatMessage
          events.emit('chat_message', { ...body, timestamp: new Date(body.timestamp) })
          return new Response('ok')
        }
        if (url.pathname === '/dev/hook' && req.method === 'POST') {
          // Dev-only: let the UI layer register debug actions (see main.tsx).
          const body = (await req.json()) as { action: string; payload?: unknown }
          const hook = (
            globalThis as {
              __twirchatDevHook?: (action: string, payload?: unknown) => Promise<unknown>
            }
          ).__twirchatDevHook
          if (!hook) return new Response('no hook', { status: 404 })
          const result = await hook(body.action, body.payload)
          return new Response(JSON.stringify(result ?? null), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response('not found', { status: 404 })
      },
    })
    log.info('[Dev] Test injection endpoint listening on port 45824')
  }

  log.info('GPUIX backend ready')
  return { api, events }
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
    const broadcasterUserId = (adapter as KickAdapter).getBroadcasterUserId()
    if (broadcasterUserId) sevenTvChannelId = String(broadcasterUserId)
  } else if (platform === 'twitch') {
    const twitchAccount = AccountStore.findByPlatform('twitch')
    if (twitchAccount && twitchAccount.username.toLowerCase() === channelSlug.toLowerCase()) {
      sevenTvPlatformUserId = twitchAccount.platformUserId
    }
  }
  sevenTVService
    .subscribeToChannel(platform, sevenTvChannelId, [channelSlug], sevenTvPlatformUserId)
    .catch((error) => {
      log.error('Failed to subscribe to 7TV', { platform, channelSlug, error: String(error) })
    })
}

function buildSevenTvSystemMessage(msg: {
  action: string
  platform: Platform
  channelId: string
  setName?: string
  oldName?: string
  newName?: string
  emote?: { id: string; alias: string; aspectRatio?: number }
  oldAlias?: string
}): NormalizedChatMessage | null {
  const author = {
    badges: [],
    color: '#6441a5',
    displayName: '7TV',
    id: '7tv-system',
    username: '7TV',
  }
  const base = {
    author,
    channelId: msg.channelId,
    emotes: [] as NormalizedChatMessage['emotes'],
    id: `7tv-system-${Date.now()}-${Math.random()}`,
    platform: msg.platform,
    timestamp: new Date(),
    type: 'system' as const,
  }

  if (msg.action === 'set_changed') {
    return { ...base, text: `Active emote set changed to «${msg.setName}»` }
  }
  if (msg.action === 'set_renamed') {
    return { ...base, text: `Emote set «${msg.oldName}» renamed to «${msg.newName}»` }
  }
  if (msg.action === 'set_deleted') {
    return { ...base, text: `Emote set «${msg.setName}» was deleted` }
  }
  if (!msg.emote) return null

  const actionText =
    msg.action === 'added' ? 'added to' : msg.action === 'removed' ? 'removed from' : 'renamed in'
  const oldAliasText = msg.oldAlias ? ` (was ${msg.oldAlias})` : ''
  const emoteWithColons = `:${msg.emote.alias}:`
  const textBeforeEmote = 'Emote '
  const startPos = textBeforeEmote.length

  return {
    ...base,
    emotes: [
      {
        id: msg.emote.id,
        name: msg.emote.alias,
        imageUrl: sevenTVService.getImageUrl(msg.emote.id),
        positions: [{ start: startPos, end: startPos + emoteWithColons.length - 1 }],
        aspectRatio: msg.emote.aspectRatio,
      },
    ],
    text: `${textBeforeEmote}${emoteWithColons}${oldAliasText} ${actionText} the channel`,
  }
}

// ── Singleton (survives `bun --hot` reloads) ────────────────────────────────

const globalKey = '__twirchatGpuixBackend'

interface GpuixGlobal {
  [globalKey]?: DesktopBackend
}

export function getDesktopBackend(): DesktopBackend {
  const g = globalThis as GpuixGlobal
  if (!g[globalKey]) {
    g[globalKey] = boot()
  }
  return g[globalKey]
}
