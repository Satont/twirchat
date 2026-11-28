import type { Platform, BackendToDesktopMessage } from '@twirchat/shared'
import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { isTwitchUserId, resolveTwitchUserId } from '../api/twitch-users.ts'
import { sevenTVCache, type CachedEmoteSet } from './cache'
import { sevenTVChannelKey, type SevenTVChannelKey } from './channel-key'
import { getEmoteSetById, getUserByConnection } from './client'
import {
  createSevenTvEmote,
  createSevenTvEmoteFromEventValue,
  removeSetEmote,
  selectPreferredSevenTvImageUrl,
  updateSetEmote,
} from './emote'
import type { SevenTVEmote } from './emote'
import { sevenTVEventClient, type SevenTVEventClient } from './event-client'
import type { EmoteSetDeleteEvent, UserUpdateEvent, SevenTVEvent } from './event-client'

const log = logger('seventv:manager')
const emoteSetEvents = ['emote_set.update', 'emote_set.delete']
const userEvents = ['user.update']
const BACKFILL_CONCURRENCY = 3
const BACKFILL_REQUEST_TIMEOUT_MS = 10_000
interface SubscriptionRequest {
  platform: Platform
  channelId: string
  platformUserId?: string
}

interface ChannelSubscription {
  readonly key: SevenTVChannelKey
  readonly platform: Platform
  readonly channelId: string
  clients: Set<string>
  emoteSet: CachedEmoteSet
  switchRequest: { readonly target: string; readonly controller: AbortController } | undefined
  revision: number
}

interface JoinLookups {
  pending: number
  retired?: ChannelSubscription
}

export class SevenTVSubscriptionManager {
  private joinLookups = new Map<SevenTVChannelKey, JoinLookups>()
  private pendingByClient = new Map<string, Map<SevenTVChannelKey, AbortController>>()
  private clientSubscriptions = new Map<string, Set<ChannelSubscription>>()
  private channels = new Map<SevenTVChannelKey, ChannelSubscription>()
  private emoteSetSubscriptions = new Map<string, Set<ChannelSubscription>>()
  private userSubscriptions = new Map<string, Set<ChannelSubscription>>()

  private backfillController: AbortController | undefined
  private backfillRunning = false

  // Callback to send messages to desktop clients
  sendToClient: ((clientSecret: string, message: BackendToDesktopMessage) => void) | null = null

  constructor(private readonly eventClient: SevenTVEventClient = sevenTVEventClient) {
    eventClient.onEvent = (event) => this.handleEvent(event)
    eventClient.onConnected = (reconnected) => {
      if (!reconnected) return
      this.backfillController?.abort()
      this.backfillController = new AbortController()
      this.startBackfill()
    }
    eventClient.onDisconnected = () => {
      this.backfillController?.abort()
      this.backfillController = undefined
    }
  }

  private startBackfill(): void {
    if (this.backfillRunning || !this.backfillController) return
    this.backfillRunning = true
    const controller = this.backfillController
    const channels = [...this.channels.values()]
    const iterator = channels.values()
    const worker = async () => {
      for (const channel of iterator) {
        if (controller.signal.aborted) return
        // eslint-disable-next-line no-await-in-loop -- Each worker owns one request slot.
        await this.reconcileChannel(channel, controller.signal)
      }
    }
    void Promise.all(
      Array.from({ length: Math.min(channels.length, BACKFILL_CONCURRENCY) }, worker),
    )
      .finally(() => {
        this.backfillRunning = false
        if (this.backfillController === controller) this.backfillController = undefined
        this.startBackfill()
      })
      .catch((error: unknown) =>
        log.error('7TV reconnect reconciliation failed', { error: String(error) }),
      )
  }

  private async reconcileChannel(channel: ChannelSubscription, signal: AbortSignal): Promise<void> {
    const isCurrent = () =>
      !signal.aborted && this.channels.get(channel.key) === channel && !channel.switchRequest
    const budget = AbortSignal.any([signal, AbortSignal.timeout(BACKFILL_REQUEST_TIMEOUT_MS)])
    try {
      // If a dispatch wins the race, take one more snapshot without overwriting it.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!isCurrent()) return
        const revision = channel.revision
        // eslint-disable-next-line no-await-in-loop -- Retry only after the first read settles.
        const fetched = await this.fetchEmoteSet(
          channel.key,
          {
            platform: channel.platform,
            channelId: channel.channelId,
            platformUserId: channel.emoteSet.platformUserId,
          },
          budget,
        )
        budget.throwIfAborted()
        if (!isCurrent() || !fetched) return
        if (channel.revision !== revision) continue
        this.publishSnapshot(channel, fetched)
        return
      }
    } catch (error) {
      if (isCurrent())
        log.warn('7TV reconnect snapshot unavailable', {
          channelKey: channel.key,
          error: String(error),
        })
    }
  }

  async subscribeClient(
    clientSecret: string,
    subscriptions: readonly SubscriptionRequest[],
    isCurrent: () => boolean,
  ): Promise<void> {
    if (!isCurrent() || subscriptions.length === 0) return
    const pending =
      this.pendingByClient.get(clientSecret) ?? new Map<SevenTVChannelKey, AbortController>()
    this.pendingByClient.set(clientSecret, pending)
    const reservations = new Map<SevenTVChannelKey, AbortController>()
    const superseded = new Set<AbortController>()
    // Reserve the whole batch before any lookup yields to a later command.
    const batch = subscriptions.map(({ platform, channelId, platformUserId }) => {
      const key = sevenTVChannelKey(platform, channelId)
      let reservation = reservations.get(key)
      if (!reservation) {
        const previous = pending.get(key)
        if (previous) superseded.add(previous)
        reservation = new AbortController()
        reservations.set(key, reservation)
        pending.set(key, reservation)
      }
      return { key, subscription: { platform, channelId, platformUserId }, reservation }
    })
    try {
      for (const previous of superseded) previous.abort()
      for (const { key, subscription, reservation } of batch) {
        if (!isCurrent()) break
        const isPending = () =>
          isCurrent() && this.pendingByClient.get(clientSecret)?.get(key) === reservation
        if (isPending())
          await this.subscribeChannel(
            clientSecret,
            key,
            subscription,
            isPending,
            reservation.signal,
          )
      }
    } finally {
      for (const [key, reservation] of reservations) {
        if (pending.get(key) === reservation) pending.delete(key)
      }
      if (pending.size === 0 && this.pendingByClient.get(clientSecret) === pending)
        this.pendingByClient.delete(clientSecret)
    }
  }

  private async subscribeChannel(
    clientSecret: string,
    channelKey: SevenTVChannelKey,
    subscription: SubscriptionRequest,
    isCurrent: () => boolean,
    signal: AbortSignal,
  ): Promise<void> {
    if (!isCurrent()) return
    const { platform, channelId } = subscription
    log.info('Subscribing client to channel', {
      channelKey,
      clientSecret: clientSecret.slice(0, 8),
    })

    const active = this.channels.get(channelKey)
    if (active?.clients.has(clientSecret)) return
    if (active && (active.switchRequest || !sevenTVCache.isExpired(channelKey))) {
      this.attachClient(clientSecret, active)
      return
    }
    const cached = sevenTVCache.get(channelKey)
    let emoteSet = cached
    if (!cached || sevenTVCache.isExpired(channelKey)) {
      const cohort: JoinLookups = this.joinLookups.get(channelKey) ?? { pending: 0 }
      cohort.pending++
      this.joinLookups.set(channelKey, cohort)
      const baseline = active ?? cohort.retired
      const revision = baseline?.revision
      const snapshot = baseline?.emoteSet
      const newerRetiredSnapshot = () => {
        const retired = cohort.retired
        if (retired && (retired.emoteSet !== snapshot || retired.revision !== revision))
          return retired.emoteSet
        return undefined
      }
      try {
        const fetched = await this.fetchEmoteSet(channelKey, subscription, signal)
        if (!isCurrent()) return
        const current = this.channels.get(channelKey)
        if (current) {
          if (
            fetched &&
            current === active &&
            current.revision === revision &&
            !current.switchRequest
          ) {
            this.publishSnapshot(current, fetched)
          }
          this.attachClient(clientSecret, current)
          return
        }
        const latest = sevenTVCache.get(channelKey)
        emoteSet =
          newerRetiredSnapshot() ??
          (latest && latest !== cached && !sevenTVCache.isExpired(channelKey)
            ? latest
            : (fetched ?? latest ?? baseline?.emoteSet))
        // A fresh channel with no set does not consume a user subscription slot.
        if (emoteSet === fetched && fetched?.id === null && !cached && !active) return
        if (fetched && emoteSet === fetched) sevenTVCache.set(channelKey, fetched)
      } catch (error) {
        if (!isCurrent()) return
        const current = this.channels.get(channelKey)
        if (current) {
          this.attachClient(clientSecret, current)
          return
        }
        log.error('Failed to fetch emote set', { channelId, channelKey, error: String(error) })
        const latest = sevenTVCache.get(channelKey)
        emoteSet = newerRetiredSnapshot() ?? latest
        if (!latest || sevenTVCache.isExpired(channelKey)) {
          const fallback = emoteSet ?? cached
          if (fallback) this.sendEmoteSetToClient(clientSecret, platform, channelId, fallback)
          return
        }
      } finally {
        if (--cohort.pending === 0) this.joinLookups.delete(channelKey)
      }
    }
    if (!emoteSet) {
      log.error('No emote set found after fetch', { channelKey })
      return
    }
    const retired = this.joinLookups.get(channelKey)?.retired
    const channel: ChannelSubscription = {
      key: channelKey,
      platform,
      channelId,
      clients: new Set(),
      emoteSet,
      switchRequest: undefined,
      revision: retired?.emoteSet === emoteSet ? retired.revision : 0,
    }
    this.channels.set(channelKey, channel)
    if (emoteSet.id !== null)
      this.retain(this.emoteSetSubscriptions, emoteSet.id, channel, emoteSetEvents)
    if (emoteSet.userId) this.retain(this.userSubscriptions, emoteSet.userId, channel, userEvents)
    this.attachClient(clientSecret, channel)
  }

  unsubscribeClient(clientSecret: string, platform: Platform, channelId: string): void {
    const channelKey = sevenTVChannelKey(platform, channelId)
    const pending = this.pendingByClient.get(clientSecret)
    const reservation = pending?.get(channelKey)
    pending?.delete(channelKey)
    if (pending?.size === 0) this.pendingByClient.delete(clientSecret)
    log.info('Unsubscribing client from channel', {
      channelKey,
      clientSecret: clientSecret.slice(0, 8),
    })

    const channel = this.channels.get(channelKey)
    if (channel) this.detachClient(clientSecret, channel)
    reservation?.abort()
  }

  cancelPendingClient(clientSecret: string): void {
    const pending = this.pendingByClient.get(clientSecret)
    this.pendingByClient.delete(clientSecret)
    for (const reservation of pending?.values() ?? []) reservation.abort()
  }

  cleanupClient(clientSecret: string): void {
    this.cancelPendingClient(clientSecret)
    for (const channel of this.clientSubscriptions.get(clientSecret) ?? [])
      this.detachClient(clientSecret, channel)
  }

  private attachClient(client: string, channel: ChannelSubscription): void {
    if (channel.clients.has(client)) return
    channel.clients.add(client)
    let subscriptions = this.clientSubscriptions.get(client)
    if (!subscriptions) {
      subscriptions = new Set()
      this.clientSubscriptions.set(client, subscriptions)
    }
    subscriptions.add(channel)
    this.sendEmoteSetToClient(client, channel.platform, channel.channelId, channel.emoteSet)
  }

  private detachClient(client: string, channel: ChannelSubscription): void {
    if (!channel.clients.delete(client)) return
    const subscriptions = this.clientSubscriptions.get(client)
    subscriptions?.delete(channel)
    if (subscriptions?.size === 0) this.clientSubscriptions.delete(client)
    if (channel.clients.size !== 0) return
    const lookups = this.joinLookups.get(channel.key)
    if (lookups) lookups.retired = channel
    this.channels.delete(channel.key)
    const request = channel.switchRequest
    channel.switchRequest = undefined
    if (channel.emoteSet.id !== null)
      this.release(this.emoteSetSubscriptions, channel.emoteSet.id, channel, emoteSetEvents)
    if (channel.emoteSet.userId)
      this.release(this.userSubscriptions, channel.emoteSet.userId, channel, userEvents)
    request?.controller.abort()
  }

  private async fetchEmoteSet(
    channelKey: SevenTVChannelKey,
    { platform, channelId, platformUserId }: SubscriptionRequest,
    signal: AbortSignal,
  ): Promise<CachedEmoteSet | null> {
    log.info('Fetching emote set from 7TV', { channelKey })

    // Convert platform to 7TV Platform enum
    if (platform === 'youtube') return null
    const sevenTVPlatform = platform === 'twitch' ? 'TWITCH' : 'KICK'

    let sevenTVPlatformId = channelId
    if (platform === 'twitch') {
      const twitchIdentifier = isTwitchUserId(platformUserId) ? platformUserId : channelId
      const resolvedPlatformId = await resolveTwitchUserId(twitchIdentifier, signal)
      if (!resolvedPlatformId) {
        throw new Error(`Twitch user not found for identifier: ${twitchIdentifier}`)
      }

      sevenTVPlatformId = resolvedPlatformId
      log.info('Resolved Twitch user for 7TV lookup', {
        channelId,
        channelKey,
        platformUserId,
        sevenTVPlatformId,
      })
    }

    signal.throwIfAborted()
    const result = await getUserByConnection(sevenTVPlatform, sevenTVPlatformId, signal)

    const user = result.users?.userByConnection
    if (!user) {
      throw new Error(`User not found on 7TV for ${platform}:${sevenTVPlatformId}`)
    }

    const emoteSet = user.style.activeEmoteSet
    if (emoteSet === undefined) {
      throw new Error('No active emote set found')
    }

    return this.createSnapshot(emoteSet, {
      userId: user.id,
      platformUserId: sevenTVPlatformId,
    })
  }

  private createSnapshot(
    emoteSet: NonNullable<Awaited<ReturnType<typeof getEmoteSetById>>['emoteSets']['emoteSet']>,
    identity: Pick<CachedEmoteSet, 'userId' | 'platformUserId'>,
  ): CachedEmoteSet & { id: string }
  private createSnapshot(
    emoteSet: NonNullable<
      Awaited<ReturnType<typeof getEmoteSetById>>['emoteSets']['emoteSet']
    > | null,
    identity: Pick<CachedEmoteSet, 'userId' | 'platformUserId'>,
  ): CachedEmoteSet
  private createSnapshot(
    emoteSet: NonNullable<
      Awaited<ReturnType<typeof getEmoteSetById>>['emoteSets']['emoteSet']
    > | null,
    { userId, platformUserId }: Pick<CachedEmoteSet, 'userId' | 'platformUserId'>,
  ): CachedEmoteSet {
    const emotes = new Map<string, SevenTVEmote>()

    for (const item of emoteSet?.emotes?.items ?? []) {
      emotes.set(
        item.alias,
        createSevenTvEmote({
          alias: item.alias,
          animated: item.emote.flags?.animated ?? false,
          aspectRatio: item.emote.aspectRatio ?? 1,
          id: item.emote.id,
          imageUrl: selectPreferredSevenTvImageUrl(item.emote.images),
          name: item.emote.defaultName,
          zeroWidth: item.flags?.zeroWidth ?? false,
        }),
      )
    }

    return {
      emotes,
      ...(emoteSet ? { id: emoteSet.id, name: emoteSet.name } : { id: null, name: null }),
      userId,
      platformUserId,
    }
  }

  private async fetchEmoteSetById(
    id: string,
    channel: ChannelSubscription,
    signal: AbortSignal,
  ): Promise<CachedEmoteSet & { id: string }> {
    const result = await getEmoteSetById(id, signal)
    signal.throwIfAborted()
    const emoteSet = result.emoteSets?.emoteSet
    if (!emoteSet) throw new Error(`Emote set ${id} not found on 7TV`)
    return this.createSnapshot(emoteSet, channel.emoteSet)
  }

  private retain(
    index: Map<string, Set<ChannelSubscription>>,
    id: string,
    channel: ChannelSubscription,
    events: readonly string[],
  ): void {
    const existing = index.get(id)
    if (existing) {
      existing.add(channel)
      return
    }
    index.set(id, new Set([channel]))
    for (const type of events) this.eventClient.subscribe(type, { object_id: id })
    if (!this.eventClient.isConnected) {
      this.eventClient
        .connect()
        .catch((error: unknown) => log.error('Connection failed', { error: String(error) }))
    }
  }

  private release(
    index: Map<string, Set<ChannelSubscription>>,
    id: string,
    channel: ChannelSubscription,
    events: readonly string[],
  ): void {
    const channels = index.get(id)
    if (!channels?.delete(channel) || channels.size !== 0) return
    index.delete(id)
    for (const type of events) this.eventClient.unsubscribe(type, { object_id: id })
  }

  private handleEvent(event: SevenTVEvent): void {
    log.info('handleEvent called', { eventType: event.type, hasBody: Boolean(event.body) })

    if (event.type === 'user.update') {
      this.handleUserUpdateEvent(event.body).catch((error: unknown) =>
        log.error('User update failed', { error: String(error) }),
      )
      return
    }

    if (event.type === 'emote_set.delete') {
      this.handleEmoteSetDeleteEvent(event.body)
      return
    }

    if (event.type !== 'emote_set.update') {
      return
    }

    const body = event.body
    const emoteSetSub = this.emoteSetSubscriptions.get(body.id)

    if (!emoteSetSub) {
      log.debug('Received event for unknown emote set', {
        emoteSetId: body.id,
      })
      return
    }

    log.info('Received emote set update', {
      emoteSetId: body.id,
      pulled: body.pulled?.length ?? 0,
      pushed: body.pushed?.length ?? 0,
      updated: body.updated?.length ?? 0,
    })

    const actorName = body.actor?.display_name ?? body.actor?.username
    for (const push of body.pushed ?? []) {
      if (push.key === 'emotes') {
        const emote = createSevenTvEmoteFromEventValue(push.value)

        log.info('7TV emote ADDED', {
          alias: emote.alias,
          emoteId: emote.id,
          emoteSetId: body.id,
          name: emote.name,
        })

        for (const channel of emoteSetSub) {
          const { platform, channelId } = channel
          channel.revision++
          channel.emoteSet.emotes.set(emote.alias, { ...emote })

          this.broadcastToChannel(channel, {
            channelId,
            emote,
            platform,
            type: 'seventv_emote_added',
          })

          this.broadcastToChannel(channel, {
            action: 'added',
            actorName,
            channelId,
            emote,
            platform,
            type: 'seventv_system_message',
          })
        }
      }
    }

    for (const pull of body.pulled ?? []) {
      if (pull.key === 'emotes') {
        const emote = createSevenTvEmoteFromEventValue(pull.old_value)

        log.info('7TV emote REMOVED', {
          alias: emote.alias,
          emoteId: emote.id,
          emoteSetId: body.id,
          name: emote.name,
        })

        for (const channel of emoteSetSub) {
          const { platform, channelId } = channel
          channel.revision++
          removeSetEmote(channel.emoteSet.emotes, emote.id)

          this.broadcastToChannel(channel, {
            channelId,
            emoteId: emote.id,
            platform,
            type: 'seventv_emote_removed',
          })

          this.broadcastToChannel(channel, {
            action: 'removed',
            actorName,
            channelId,
            emote,
            platform,
            type: 'seventv_system_message',
          })
        }
      }
    }

    for (const update of body.updated ?? []) {
      if (update.kind === 'field' && update.key === 'name' && typeof update.value === 'string') {
        const newName = update.value
        const oldName = typeof update.old_value === 'string' ? update.old_value : ''

        log.info('7TV emote set RENAMED', {
          emoteSetId: body.id,
          newName,
          oldName,
        })

        for (const channel of emoteSetSub) {
          if (channel.emoteSet.id !== body.id) continue
          const { platform, channelId } = channel
          channel.revision++
          channel.emoteSet.name = newName

          this.broadcastToChannel(channel, {
            action: 'set_renamed',
            channelId,
            newName,
            oldName,
            platform,
            type: 'seventv_system_message',
          })
        }
      }

      if (update.kind === 'emote') {
        const newValue = update.value
        const oldValue = update.old_value

        log.info('7TV emote UPDATED', {
          emoteId: newValue.id,
          emoteSetId: body.id,
          newAlias: newValue.name,
          oldAlias: oldValue.name,
        })

        for (const channel of emoteSetSub) {
          const { platform, channelId } = channel
          channel.revision++
          const emoteForMessage =
            updateSetEmote(channel.emoteSet.emotes, newValue.id, { alias: newValue.name }) ??
            createSevenTvEmoteFromEventValue(newValue)
          this.broadcastToChannel(channel, {
            alias: newValue.name,
            channelId,
            emoteId: newValue.id,
            platform,
            type: 'seventv_emote_updated',
          })

          this.broadcastToChannel(channel, {
            action: 'updated',
            channelId,
            emote: emoteForMessage,
            oldAlias: oldValue.name,
            platform,
            type: 'seventv_system_message',
          })
        }
      }
    }
  }

  private handleEmoteSetDeleteEvent(body: EmoteSetDeleteEvent): void {
    const emoteSetSub = this.emoteSetSubscriptions.get(body.id)
    if (!emoteSetSub) {
      log.debug('Received delete event for unknown emote set', { emoteSetId: body.id })
      return
    }

    log.info('7TV emote set DELETED', { emoteSetId: body.id })

    for (const channel of emoteSetSub) {
      const { platform, channelId } = channel
      channel.revision++
      const setName = channel.emoteSet.name
      if (setName === null) continue

      this.broadcastToChannel(channel, {
        action: 'set_deleted',
        channelId,
        platform,
        setName,
        type: 'seventv_system_message',
      })
    }
  }

  private async handleUserUpdateEvent(body: UserUpdateEvent): Promise<void> {
    const channels = this.userSubscriptions.get(body.id)
    if (!channels) return
    for (const update of body.updated ?? []) {
      if (update.key !== 'connections' || !Array.isArray(update.value)) continue
      const fields = z.array(z.object({ key: z.string(), value: z.unknown() })).parse(update.value)
      for (const field of fields) {
        if (field.key !== 'emote_set_id' || typeof field.value !== 'string' || !field.value)
          continue
        const target = field.value
        return Promise.all(
          [...channels].map((channel) => this.switchEmoteSet(channel, target)),
        ).then(() => undefined)
      }
    }
  }

  private async switchEmoteSet(channel: ChannelSubscription, id: string): Promise<void> {
    const previous = channel.switchRequest
    if (previous?.target === id || this.channels.get(channel.key) !== channel) return
    const request =
      channel.emoteSet.id === id ? undefined : { target: id, controller: new AbortController() }
    channel.revision++
    channel.switchRequest = request
    previous?.controller.abort()
    if (!request || channel.switchRequest !== request) return
    const { key, platform, channelId } = channel
    let emoteSet: Awaited<ReturnType<SevenTVSubscriptionManager['fetchEmoteSetById']>>
    try {
      emoteSet = await this.fetchEmoteSetById(id, channel, request.controller.signal)
    } catch (error) {
      if (channel.switchRequest !== request) return
      channel.switchRequest = undefined
      log.error('Failed to fetch new emote set after active set change', {
        channelKey: key,
        error: String(error),
      })
      return
    }
    if (this.channels.get(key) !== channel || channel.switchRequest !== request) return
    channel.switchRequest = undefined
    this.publishSnapshot(channel, emoteSet)
    this.broadcastToChannel(channel, {
      action: 'set_changed',
      channelId,
      platform,
      setName: emoteSet.name,
      type: 'seventv_system_message',
    })
  }

  private publishSnapshot(channel: ChannelSubscription, emoteSet: CachedEmoteSet): void {
    this.replaceSnapshot(channel, emoteSet)
    for (const client of channel.clients)
      this.sendEmoteSetToClient(client, channel.platform, channel.channelId, emoteSet)
  }

  private replaceSnapshot(channel: ChannelSubscription, emoteSet: CachedEmoteSet): void {
    const previous = channel.emoteSet
    channel.revision++
    channel.emoteSet = emoteSet
    sevenTVCache.set(channel.key, emoteSet)
    if (previous.id !== emoteSet.id) {
      if (previous.id !== null)
        this.release(this.emoteSetSubscriptions, previous.id, channel, emoteSetEvents)
      if (emoteSet.id !== null)
        this.retain(this.emoteSetSubscriptions, emoteSet.id, channel, emoteSetEvents)
    }
    if (previous.userId !== emoteSet.userId) {
      if (previous.userId)
        this.release(this.userSubscriptions, previous.userId, channel, userEvents)
      if (emoteSet.userId) this.retain(this.userSubscriptions, emoteSet.userId, channel, userEvents)
    }
  }

  private sendEmoteSetToClient(
    clientSecret: string,
    platform: Platform,
    channelId: string,
    emoteSet: Pick<CachedEmoteSet, 'emotes'>,
  ): void {
    this.sendToClient?.(clientSecret, {
      channelId,
      emotes: Array.from(emoteSet.emotes.values()),
      platform,
      type: 'seventv_emote_set',
    })
  }

  private broadcastToChannel(channel: ChannelSubscription, message: BackendToDesktopMessage): void {
    for (const client of channel.clients) this.sendToClient?.(client, message)
  }

  getStats(): {
    connectedClients: number
    emoteSetSubscriptions: number
    eventClientConnected: boolean
  } {
    return {
      connectedClients: this.clientSubscriptions.size,
      emoteSetSubscriptions: this.emoteSetSubscriptions.size,
      eventClientConnected: this.eventClient.isConnected,
    }
  }
}

export const sevenTVManager = new SevenTVSubscriptionManager()
