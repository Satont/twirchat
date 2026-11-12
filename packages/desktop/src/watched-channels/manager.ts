import type { ChatClear, RoomState } from '@twirchat/shared/channel-tools'
import { logger } from '@twirchat/shared/logger'
/**
 * WatchedChannelManager
 *
 * Manages a pool of platform adapters for "watched" (external) channels.
 * Each watched channel gets its own adapter instance and isolated message buffer.
 *
 * - On add: persist the channel in the saved catalog
 * - On activation: connect channels referenced by open layouts
 * - On remove: disconnect adapter, clear buffer
 * - On sendMessage: route to correct adapter
 */
import type {
  Account,
  ChatSendReceipt,
  Emote,
  NormalizedChatMessage,
  NormalizedEvent,
  PlatformStatusInfo,
  WatchedChannel,
  ModerationOutcome,
} from '@twirchat/shared/types'

import { parseMessageWithEmotes } from '../platforms/7tv/emote-parser'
import type { IPlatformAdapter } from '../platforms/base-adapter'
import { KickAdapter } from '../platforms/kick/adapter'
import { TwitchAdapter } from '../platforms/twitch/adapter'
import { VkPlayAdapter } from '../platforms/vkplay/adapter'
import { YouTubeAdapter } from '../platforms/youtube/adapter'
import { runInBackground } from '../services/background-task'
import { chatSender, separateSender } from '../services/chat-accounts'
import { sevenTVService } from '../seventv'
import { AccountStore } from '../store/account-store'
import { getDb } from '../store/db'
import { WatchedChannelsLayoutStore } from '../store/watched-channels-layout-store'
import { WatchedChannelStore } from '../store/watched-channels-store'
import type { ChatAccountSender } from './account-sender'

const log = logger('watched-channels')

const MAX_BUFFER = 200

export type WatchedChannelMessageHandler = (channelId: string, msg: NormalizedChatMessage) => void

export type WatchedChannelStatusHandler = (channelId: string, status: PlatformStatusInfo) => void

interface WatchedEntry {
  watchedChannel: WatchedChannel
  /** Accounts whose own connections send in this chat, while they differ from the reading one. */
  senderIds: Set<string>
  adapter: IPlatformAdapter
  messages: NormalizedChatMessage[]
  status: PlatformStatusInfo | null
  sevenTvChannelId: string
  sevenTvPlatformUserId?: string
  cleanup?: () => void
}

export class WatchedChannelManager {
  constructor(
    private readonly enrich: (message: NormalizedChatMessage) => NormalizedChatMessage = (
      message,
    ) => message,
    private readonly createAdapter?: (channel: WatchedChannel) => IPlatformAdapter | undefined,
    private readonly accountSender?: ChatAccountSender,
  ) {}
  /** Chat ID → accounts its live panes chose for themselves. */
  private paneAccounts = new Map<string, readonly string[]>()
  private reconnectQueues = new Map<string, Promise<void>>()
  private entries = new Map<string, WatchedEntry>() // Keyed by WatchedChannel.id
  private activeIds = new Set<string>()
  private activationRevision = 0

  private eventHandlers = new Set<(channelId: string, event: NormalizedEvent) => void>()
  private messageHandlers = new Set<WatchedChannelMessageHandler>()
  private noticeHandlers = new Set<WatchedChannelMessageHandler>()
  private statusHandlers = new Set<WatchedChannelStatusHandler>()
  private moderationHandlers = new Set<(outcome: ModerationOutcome) => void>()
  private roomStateHandlers = new Set<(state: RoomState) => void>()
  private clearHandlers = new Set<(clear: ChatClear) => void>()
  private activeChannelsHandlers = new Set<() => void>()

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  async setActiveChannels(ids: readonly string[]): Promise<void> {
    const channels = WatchedChannelStore.findAll()
    const requested = new Set(ids)
    this.activeIds = new Set(
      channels.filter((channel) => requested.has(channel.id)).map((channel) => channel.id),
    )
    const revision = ++this.activationRevision
    this.notifyActiveChannels()
    const stopping = [...this.entries.keys()]
      .filter((id) => !this.activeIds.has(id))
      .map((id) => this.stopChannel(id))
    const starting = channels.filter(
      (channel) => this.activeIds.has(channel.id) && !this.entries.has(channel.id),
    )
    let index = 0
    await Promise.all([
      ...stopping,
      ...Array.from({ length: Math.min(4, starting.length) }, async () => {
        while (revision === this.activationRevision) {
          const channel = starting[index++]
          if (!channel) return
          await this.startChannel(channel)
        }
      }),
    ])
  }

  /** Saved channels connect only after an open layout references them. */
  async addChannel(
    platform: WatchedChannel['platform'],
    channelSlug: string,
    displayName?: string,
  ): Promise<WatchedChannel> {
    const slug = platform === 'youtube' ? channelSlug.trim() : channelSlug.toLowerCase()
    const name = displayName ?? slug
    return WatchedChannelStore.upsert(platform, slug, name)
  }

  async removeChannel(id: string): Promise<void> {
    getDb().transaction(() => {
      WatchedChannelStore.remove(id)
      WatchedChannelsLayoutStore.cleanupRemovedChannel(id)
    })()
    if (this.activeIds.delete(id)) this.notifyActiveChannels()
    await this.stopChannel(id)
  }

  private async stopChannel(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry) {
      this.entries.delete(id)
      this.unbindAdapter(entry)
      for (const senderId of entry.senderIds)
        this.accountSender?.release(senderId, entry.watchedChannel)
      sevenTVService
        .unsubscribeFromChannel(
          entry.watchedChannel.platform,
          entry.sevenTvChannelId,
          `watched:${id}`,
        )
        .catch((error) => {
          log.error('Failed to unsubscribe from 7TV for watched channel', {
            id,
            platform: entry.watchedChannel.platform,
            channelSlug: entry.watchedChannel.channelSlug,
            error: String(error),
            action: '7tv',
          })
        })
      await entry.adapter.disconnect().catch((error) => {
        log.error('Error disconnecting watched channel', { id, error: String(error) })
      })
    }
  }

  /** Get all current watched channels */
  getAll(): WatchedChannel[] {
    return WatchedChannelStore.findAll()
  }

  /** Channels an open layout references, whether or not their chat has connected yet. */
  getActiveChannels(): WatchedChannel[] {
    return this.getAll().filter((channel) => this.activeIds.has(channel.id))
  }

  onActiveChannelsChange(handler: () => void): () => void {
    this.activeChannelsHandlers.add(handler)
    return () => {
      this.activeChannelsHandlers.delete(handler)
    }
  }

  private notifyActiveChannels(): void {
    for (const handler of this.activeChannelsHandlers) handler()
  }

  findActiveChannelId(
    platform: WatchedChannel['platform'],
    channelSlug: string,
  ): string | undefined {
    for (const { watchedChannel } of this.entries.values()) {
      if (watchedChannel.platform === platform && watchedChannel.channelSlug === channelSlug)
        return watchedChannel.id
    }
    return undefined
  }

  /** Delivers a 7TV notice to every connected chat that subscribed with this 7TV channel ID. */
  injectSevenTvNotice(
    platform: WatchedChannel['platform'],
    sevenTvChannelId: string,
    message: NormalizedChatMessage,
  ): void {
    const key = platform === 'youtube' ? sevenTvChannelId : sevenTvChannelId.toLowerCase()
    for (const entry of this.entries.values()) {
      const { watchedChannel } = entry
      if (watchedChannel.platform !== platform) continue
      const entryKey =
        platform === 'youtube' ? entry.sevenTvChannelId : entry.sevenTvChannelId.toLowerCase()
      if (entryKey !== key) continue
      const notice = this.enrich({ ...message, channelId: watchedChannel.channelSlug })
      entry.messages = [notice, ...entry.messages].slice(0, MAX_BUFFER)
      for (const handler of this.messageHandlers) handler(watchedChannel.id, notice)
    }
  }

  /** Get buffered messages for a specific watched channel */
  getMessages(id: string): NormalizedChatMessage[] {
    return this.entries.get(id)?.messages ?? []
  }

  /** Get current status for a specific watched channel */
  getStatus(id: string): PlatformStatusInfo | null {
    return this.entries.get(id)?.status ?? null
  }

  /** Get current statuses for all watched channels */
  getAllStatuses(): { channelId: string; status: PlatformStatusInfo }[] {
    const result: { channelId: string; status: PlatformStatusInfo }[] = []
    for (const [id, entry] of this.entries) {
      if (entry.status) {
        result.push({ channelId: id, status: entry.status })
      }
    }
    return result
  }

  /**
   * Reconnect all watched channels for a given platform.
   * Called after login/logout so adapters pick up the new auth state.
   */
  async reconnectByPlatform(platform: string): Promise<void> {
    const matching = [...this.entries.values()].filter(
      (e) => e.watchedChannel.platform === platform,
    )

    let index = 0
    const failures: string[] = []
    await Promise.all(
      Array.from({ length: Math.min(4, matching.length) }, async () => {
        while (index < matching.length) {
          const entry = matching[index++]
          if (!entry) return
          try {
            await this.reconnect(entry.watchedChannel.id)
          } catch (error) {
            if (this.entries.get(entry.watchedChannel.id) === entry)
              failures.push(`${entry.watchedChannel.channelSlug}: ${String(error)}`)
          }
        }
      }),
    )
    if (failures.length)
      throw new Error(`Watched chats could not reconnect: ${failures.join('; ')}`)
  }

  reconnect(id: string): Promise<void> {
    const next = (this.reconnectQueues.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const entry = this.entries.get(id)
        if (!entry) throw new Error('This watched channel is no longer connected.')
        this.unbindAdapter(entry)
        await entry.adapter.disconnect()
        if (this.entries.get(id) !== entry) return
        this.bindAdapter(entry)
        await entry.adapter.connect(entry.watchedChannel.channelSlug)
        // The default account may have changed and now be the chat's chosen account.
        if (this.entries.get(id) === entry) this.syncSender(entry)
      })
    this.reconnectQueues.set(id, next)
    runInBackground(
      next
        .finally(() => {
          if (this.reconnectQueues.get(id) === next) this.reconnectQueues.delete(id)
        })
        .catch(() => {}),
      'manager background operation failed',
    )
    return next
  }

  /**
   * Chooses the saved account a chat sends with (`null` = the default account). The chat keeps
   * reading over its current connection; another account gets its own sending connection.
   */
  setChannelAccount(id: string, accountId: string | null): WatchedChannel {
    const channel = WatchedChannelStore.findById(id)
    if (!channel) throw new Error('This chat is no longer saved.')
    WatchedChannelStore.setAccount(id, accountId)
    const updated = WatchedChannelStore.findById(id) ?? channel
    const entry = this.entries.get(id)
    if (entry) {
      entry.watchedChannel = updated
      this.syncSender(entry)
    }
    return updated
  }

  /** Returns chats bound to a forgotten account to the default account. */
  releaseAccount(accountId: string): void {
    for (const id of WatchedChannelStore.releaseAccount(accountId)) {
      const entry = this.entries.get(id)
      const updated = WatchedChannelStore.findById(id)
      if (!entry || !updated) continue
      entry.watchedChannel = updated
      this.syncSender(entry)
    }
  }

  /** Accounts chosen by the live panes of each chat; connections no pane uses are released. */
  setPaneAccounts(accounts: Record<string, readonly string[]>): void {
    const previous = this.paneAccounts
    this.paneAccounts = new Map(Object.entries(accounts))
    for (const [id, entry] of this.entries) {
      const before = previous.get(id) ?? []
      const after = this.paneAccounts.get(id) ?? []
      if (before.length !== after.length || before.some((accountId, i) => accountId !== after[i]))
        this.syncSender(entry)
    }
  }

  /** Opens every chosen account's sending connection early so first messages are not delayed. */
  private syncSender(entry: WatchedEntry): void {
    const channel = entry.watchedChannel
    const desired = new Map<string, Account>()
    const chosen = chatSender(channel)
    if (chosen) desired.set(chosen.id, chosen)
    for (const accountId of this.paneAccounts.get(channel.id) ?? []) {
      const account = AccountStore.findById(accountId)
      if (account?.platform === channel.platform && account.id !== chosen?.id) {
        const sender = chatSender({ platform: channel.platform, accountId: account.id })
        if (sender) desired.set(sender.id, sender)
      }
    }
    for (const senderId of entry.senderIds)
      if (!desired.has(senderId)) this.accountSender?.release(senderId, channel)
    for (const [senderId, sender] of desired) {
      if (entry.senderIds.has(senderId) || !this.accountSender) continue
      runInBackground(
        this.accountSender.prepare(sender, channel),
        'Could not prepare the chat account',
      )
    }
    entry.senderIds = new Set(desired.keys())
  }

  /** Opens the default account's sending connection; other accounts are prepared by `syncSender`. */
  prepareSend(id: string, accountId?: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const sender = accountId
      ? separateSender(entry.watchedChannel, accountId)
      : chatSender(entry.watchedChannel)
    if (!sender) entry.adapter.prepareSend?.()
  }

  /**
   * Sends in the watched chat. `accountId` is the pane's account; without it the chat's own
   * account sends. The default account sends through the adapter; others use the account sender.
   */
  async sendMessage(
    id: string,
    text: string,
    replyTo?: string,
    accountId?: string,
  ): Promise<void | ChatSendReceipt> {
    const entry = this.entries.get(id)
    if (!entry) {
      throw new Error(`Watched channel ${id} not found`)
    }
    const sender = accountId
      ? separateSender(entry.watchedChannel, accountId)
      : chatSender(entry.watchedChannel)
    if (!sender) return entry.adapter.sendMessage(entry.watchedChannel.channelSlug, text, replyTo)
    if (!this.accountSender) throw new Error('Sending as another account is unavailable.')
    return this.accountSender.send(sender, entry.watchedChannel, entry.adapter, text, replyTo)
  }

  /** Register a handler for incoming messages */
  onMessage(handler: WatchedChannelMessageHandler): void {
    this.messageHandlers.add(handler)
  }

  onNotice(handler: WatchedChannelMessageHandler): () => void {
    this.noticeHandlers.add(handler)
    return () => this.noticeHandlers.delete(handler)
  }

  /** Register a handler for status changes */
  onStatus(handler: WatchedChannelStatusHandler): void {
    this.statusHandlers.add(handler)
  }

  onEvent(handler: (channelId: string, event: NormalizedEvent) => void): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  onModeration(handler: (outcome: ModerationOutcome) => void): () => void {
    this.moderationHandlers.add(handler)
    return () => this.moderationHandlers.delete(handler)
  }

  onRoomState(handler: (state: RoomState) => void): () => void {
    this.roomStateHandlers.add(handler)
    return () => this.roomStateHandlers.delete(handler)
  }

  onChatClear(handler: (clear: ChatClear) => void): () => void {
    this.clearHandlers.add(handler)
    return () => this.clearHandlers.delete(handler)
  }

  getRoomState(platform: string, channelSlug: string): RoomState | undefined {
    for (const entry of this.entries.values()) {
      if (
        entry.watchedChannel.platform === platform &&
        entry.watchedChannel.channelSlug.toLowerCase() === channelSlug.toLowerCase() &&
        entry.adapter instanceof TwitchAdapter
      )
        return entry.adapter.getRoomState()
    }
    return undefined
  }

  // ----------------------------------------------------------------
  // Private
  // ----------------------------------------------------------------

  private async startChannel(ch: WatchedChannel): Promise<void> {
    if (!this.activeIds.has(ch.id) || this.entries.has(ch.id)) return
    const adapter: IPlatformAdapter =
      this.createAdapter?.(ch) ??
      (ch.platform === 'twitch'
        ? new TwitchAdapter()
        : ch.platform === 'youtube'
          ? new YouTubeAdapter()
          : ch.platform === 'vkplay'
            ? new VkPlayAdapter()
            : new KickAdapter())

    const entry: WatchedEntry = {
      adapter,
      messages: [],
      sevenTvChannelId: ch.channelSlug,
      sevenTvPlatformUserId: undefined,
      senderIds: new Set(),
      status: null,
      watchedChannel: ch,
    }

    this.entries.set(ch.id, entry)
    this.bindAdapter(entry)
    this.syncSender(entry)

    log.info('Connecting watched channel', {
      id: ch.id,
      platform: ch.platform,
      slug: ch.channelSlug,
    })

    await adapter.connect(ch.channelSlug).catch((error) => {
      log.error('Failed to start watched channel adapter', {
        id: ch.id,
        error: String(error),
      })
    })
    if (this.entries.get(ch.id) !== entry || !this.activeIds.has(ch.id)) return

    if (ch.platform === 'kick') {
      const broadcasterUserId = adapter.getBroadcasterUserId?.()
      if (broadcasterUserId) {
        entry.sevenTvChannelId = String(broadcasterUserId)
      }
    } else if (ch.platform === 'twitch') {
      const twitchAccount = AccountStore.findByPlatform('twitch')
      if (twitchAccount && twitchAccount.username.toLowerCase() === ch.channelSlug.toLowerCase()) {
        entry.sevenTvPlatformUserId = twitchAccount.platformUserId
      }
    }

    if (ch.platform !== 'vkplay')
      sevenTVService
        .subscribeToChannel(
          ch.platform,
          entry.sevenTvChannelId,
          [ch.channelSlug],
          entry.sevenTvPlatformUserId,
          `watched:${ch.id}`,
        )
        .catch((error) => {
          log.error('Failed to subscribe to 7TV for watched channel', {
            id: ch.id,
            platform: ch.platform,
            channelSlug: entry.sevenTvChannelId,
            error: String(error),
            action: '7tv',
          })
        })
  }

  private bindAdapter(entry: WatchedEntry): void {
    const { adapter, watchedChannel } = entry

    const onMessage = (msg: NormalizedChatMessage) => {
      const parsed = parseMessageWithEmotes(msg.text, msg.platform, entry.sevenTvChannelId)
      const sevenTVEmoteMap = new Map<string, Emote>()
      for (const e of parsed.emotes) {
        const emote: Emote = {
          aspectRatio: e.aspectRatio,
          animated: e.animated,
          zeroWidth: e.zeroWidth,
          source: 'seventv',
          provider: 'seventv',
          id: e.id,
          imageUrl: e.imageUrl,
          name: e.name,
          positions: [{ end: e.end, start: e.start }],
        }
        const existing = sevenTVEmoteMap.get(emote.id)
        if (existing) {
          existing.positions.push(...emote.positions)
        } else {
          sevenTVEmoteMap.set(emote.id, emote)
        }
      }

      const existingIds = new Set(msg.emotes.map((e) => e.id))
      const mergedEmotes = [...msg.emotes]
      for (const emote of sevenTVEmoteMap.values()) {
        if (!existingIds.has(emote.id)) {
          mergedEmotes.push(emote)
          existingIds.add(emote.id)
        }
      }

      const enrichedMsg = this.enrich({ ...msg, emotes: mergedEmotes })

      entry.messages = [enrichedMsg, ...entry.messages].slice(0, MAX_BUFFER)
      for (const h of this.messageHandlers) {
        h(watchedChannel.id, enrichedMsg)
      }
    }

    const onStatus = (status: PlatformStatusInfo) => {
      entry.status = status
      for (const h of this.statusHandlers) {
        h(watchedChannel.id, status)
      }
    }

    const onEvent = (event: NormalizedEvent) => {
      for (const handler of this.eventHandlers)
        handler(watchedChannel.id, {
          ...event,
          data: {
            ...event.data,
            channelId: watchedChannel.channelSlug,
            sourceWatchedChannelId: watchedChannel.id,
          },
        })
    }
    const onNotice = (notice: NormalizedChatMessage) => {
      for (const handler of this.noticeHandlers) handler(watchedChannel.id, notice)
    }
    adapter.on('event', onEvent)
    adapter.on('message', onMessage)
    adapter.on('notice', onNotice)
    adapter.on('status', onStatus)
    const onModeration = (outcome: ModerationOutcome) => {
      for (const handler of this.moderationHandlers) handler(outcome)
    }
    const onRoomState = (state: RoomState) => {
      for (const handler of this.roomStateHandlers) handler(state)
    }
    const onChatClear = (clear: ChatClear) => {
      entry.messages = []
      for (const handler of this.clearHandlers) handler(clear)
    }
    adapter.on('moderation', onModeration)
    adapter.on('room_state', onRoomState)
    adapter.on('chat_clear', onChatClear)
    entry.cleanup = () => {
      adapter.off('event', onEvent)
      adapter.off('message', onMessage)
      adapter.off('notice', onNotice)
      adapter.off('status', onStatus)
      adapter.off('moderation', onModeration)
      adapter.off('room_state', onRoomState)
      adapter.off('chat_clear', onChatClear)
    }
  }

  private unbindAdapter(entry: WatchedEntry): void {
    entry.cleanup?.()
    entry.cleanup = undefined
  }
}
