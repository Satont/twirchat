import type { Platform } from '@twirchat/shared'
import { logger } from '@twirchat/shared/logger'
import { sevenTVCache } from './cache'
import type { SevenTVEmote } from './cache'
import { sevenTVEventClient } from './event-client'
import type { EmoteSetUpdateEvent, EmoteSetDeleteEvent, UserUpdateEvent } from './event-client'
import { getEmoteSetById, getUserByConnection } from './client'

const log = logger('seventv:manager')

interface ClientSubscription {
  platform: Platform
  channelId: string
  emoteSetId: string
}

interface EmoteSetSubscription {
  emoteSetId: string
  channelKeys: Set<string> // "platform:channelId"
  clientSecrets: Set<string>
}

export class SevenTVSubscriptionManager {
  private clientSubscriptions = new Map<string, Set<ClientSubscription>>() // ClientSecret -> subscriptions
  private emoteSetSubscriptions = new Map<string, EmoteSetSubscription>() // EmoteSetId -> subscription
  private userSubscriptions = new Map<string, Set<string>>()
  private channelKeyToUserId = new Map<string, string>()

  // Callback to send messages to desktop clients
  sendToClient: ((clientSecret: string, message: unknown) => void) | null = null

  constructor() {
    // Setup event handler
    sevenTVEventClient.onEvent = (event) => this.handleEvent(event)
  }

  async subscribeClient(
    clientSecret: string,
    platform: Platform,
    channelId: string,
  ): Promise<boolean> {
    const channelKey = `${platform}:${channelId}`
    log.info('Subscribing client to channel', {
      channelKey,
      clientSecret: clientSecret.slice(0, 8),
    })

    // Check if client already subscribed to this channel
    const clientSubs = this.clientSubscriptions.get(clientSecret)
    if (clientSubs) {
      const existing = [...clientSubs].find(
        (s) => s.platform === platform && s.channelId === channelId,
      )
      if (existing) {
        log.debug('Client already subscribed to channel', {
          channelKey,
          clientSecret: clientSecret.slice(0, 8),
        })
        return true
      }
    }

    // Check cache first
    const cached = sevenTVCache.get(platform, channelId)
    const isExpired = sevenTVCache.isExpired(platform, channelId)

    if (cached && !isExpired) {
      log.debug('Using cached emote set', { channelKey })
      this.sendEmoteSetToClient(clientSecret, platform, channelId, cached)
    }

    // If no cache or expired, fetch from 7TV
    let userId: string | null = this.channelKeyToUserId.get(channelKey) ?? null
    if (!cached || isExpired) {
      try {
        userId = await this.fetchAndCacheEmoteSet(platform, channelId)
        if (userId) {
          this.channelKeyToUserId.set(channelKey, userId)
        }
      } catch (error) {
        log.error('Failed to fetch emote set', {
          channelId,
          channelKey,
          error: String(error),
        })

        if (cached) {
          log.warn('Using stale cache', { channelId, channelKey })
          this.sendEmoteSetToClient(clientSecret, platform, channelId, cached)
        }

        return false
      }
    }

    // Get the emote set ID from cache
    const emoteSet = sevenTVCache.get(platform, channelId)
    if (!emoteSet) {
      log.error('No emote set found after fetch', { channelKey })
      return false
    }

    // Register subscription
    this.registerSubscription(clientSecret, platform, channelId, emoteSet.id)

    this.subscribeToEmoteSetUpdates(emoteSet.id, channelKey, clientSecret)

    if (userId) {
      this.subscribeToUserUpdates(userId, channelKey)
    }

    // Send emote set to client
    this.sendEmoteSetToClient(clientSecret, platform, channelId, emoteSet)

    return true
  }

  unsubscribeClient(clientSecret: string, platform: Platform, channelId: string): void {
    const channelKey = `${platform}:${channelId}`
    log.info('Unsubscribing client from channel', {
      channelKey,
      clientSecret: clientSecret.slice(0, 8),
    })

    // Remove from client subscriptions
    const clientSubs = this.clientSubscriptions.get(clientSecret)
    if (clientSubs) {
      const sub = [...clientSubs].find((s) => s.platform === platform && s.channelId === channelId)

      if (sub) {
        clientSubs.delete(sub)

        // Remove from emote set subscription
        const emoteSetSub = this.emoteSetSubscriptions.get(sub.emoteSetId)
        if (emoteSetSub) {
          emoteSetSub.channelKeys.delete(channelKey)
          emoteSetSub.clientSecrets.delete(clientSecret)

          // If no more clients, unsubscribe from 7TV
          if (emoteSetSub.clientSecrets.size === 0) {
            log.info('Unsubscribing from 7TV EventAPI', {
              emoteSetId: sub.emoteSetId,
            })
            sevenTVEventClient.unsubscribe('emote_set.update', {
              object_id: sub.emoteSetId,
            })
            sevenTVEventClient.unsubscribe('emote_set.delete', {
              object_id: sub.emoteSetId,
            })
            this.emoteSetSubscriptions.delete(sub.emoteSetId)
          }
        }

        const userId = this.channelKeyToUserId.get(channelKey)
        if (userId) {
          this.unsubscribeFromUserUpdates(userId, channelKey)
        }
      }

      // Clean up empty client subscriptions
      if (clientSubs.size === 0) {
        this.clientSubscriptions.delete(clientSecret)
      }
    }
  }

  cleanupClient(clientSecret: string): void {
    log.info('Cleaning up client subscriptions', {
      clientSecret: clientSecret.slice(0, 8),
    })

    const clientSubs = this.clientSubscriptions.get(clientSecret)
    if (!clientSubs) {
      return
    }

    for (const sub of Array.from(clientSubs)) {
      this.unsubscribeClient(clientSecret, sub.platform, sub.channelId)
    }
  }

  private async fetchAndCacheEmoteSet(
    platform: Platform,
    channelId: string,
  ): Promise<string | null> {
    const channelKey = `${platform}:${channelId}`
    log.info('Fetching emote set from 7TV', { channelKey })

    // Convert platform to 7TV Platform enum
    const sevenTVPlatform = platform.toUpperCase()

    const result = await getUserByConnection(sevenTVPlatform as 'TWITCH' | 'KICK', channelId)

    const user = result.users?.userByConnection
    if (!user) {
      throw new Error('User not found on 7TV')
    }

    const emoteSet = user.style?.activeEmoteSet
    if (!emoteSet) {
      throw new Error('No active emote set found')
    }

    // Convert to cache format
    const emotes = new Map<string, SevenTVEmote>()

    for (const item of emoteSet.emotes?.items ?? []) {
      const alias = item.alias.toLowerCase()
      const image = item.emote.images?.[0]

      emotes.set(alias, {
        alias: alias,
        animated: item.emote.flags?.animated ?? false,
        aspectRatio: item.emote.aspectRatio ?? 1,
        id: item.emote.id,
        imageUrl: image?.url ?? ``,
        name: item.emote.defaultName,
        zeroWidth: item.flags?.zeroWidth ?? false,
      })
    }

    sevenTVCache.set(platform, channelId, {
      channelId,
      emotes,
      fetchedAt: Date.now(),
      id: emoteSet.id,
      name: emoteSet.name,
      platform,
      ttl: 5 * 60 * 1000,
    })

    log.info('Emote set cached', {
      channelKey,
      emoteCount: emotes.size,
      emoteSetId: emoteSet.id,
    })

    return user.id ?? null
  }

  private async fetchAndCacheEmoteSetById(
    emoteSetId: string,
    platform: Platform,
    channelId: string,
  ): Promise<string> {
    const channelKey = `${platform}:${channelId}`
    log.info('Fetching emote set by ID from 7TV', { channelKey, emoteSetId })

    const result = await getEmoteSetById(emoteSetId)
    const emoteSet = result.emoteSets?.emoteSet
    if (!emoteSet) {
      throw new Error(`Emote set ${emoteSetId} not found on 7TV`)
    }

    const emotes = new Map<string, SevenTVEmote>()
    for (const item of emoteSet.emotes?.items ?? []) {
      const alias = item.alias.toLowerCase()
      const image = item.emote.images?.[0]
      emotes.set(alias, {
        alias,
        animated: item.emote.flags?.animated ?? false,
        aspectRatio: item.emote.aspectRatio ?? 1,
        id: item.emote.id,
        imageUrl: image?.url ?? '',
        name: item.emote.defaultName,
        zeroWidth: item.flags?.zeroWidth ?? false,
      })
    }

    sevenTVCache.set(platform, channelId, {
      channelId,
      emotes,
      fetchedAt: Date.now(),
      id: emoteSet.id,
      name: emoteSet.name,
      platform,
      ttl: 5 * 60 * 1000,
    })

    log.info('Emote set cached by ID', {
      channelKey,
      emoteCount: emotes.size,
      emoteSetId: emoteSet.id,
    })

    return emoteSet.name
  }

  private registerSubscription(
    clientSecret: string,
    platform: Platform,
    channelId: string,
    emoteSetId: string,
  ): void {
    let clientSubs = this.clientSubscriptions.get(clientSecret)
    if (!clientSubs) {
      clientSubs = new Set()
      this.clientSubscriptions.set(clientSecret, clientSubs)
    }

    clientSubs.add({ channelId, emoteSetId, platform })
  }

  private subscribeToEmoteSetUpdates(
    emoteSetId: string,
    channelKey: string,
    clientSecret: string,
  ): void {
    let sub = this.emoteSetSubscriptions.get(emoteSetId)

    if (!sub) {
      sub = {
        channelKeys: new Set(),
        clientSecrets: new Set(),
        emoteSetId,
      }
      this.emoteSetSubscriptions.set(emoteSetId, sub)

      // Subscribe to 7TV EventAPI
      log.info('SUBSCRIBING TO 7TV', {
        channelKey,
        emoteSetId,
        type: 'emote_set.update',
      })
      sevenTVEventClient.subscribe('emote_set.update', {
        object_id: emoteSetId,
      })
      sevenTVEventClient.subscribe('emote_set.delete', {
        object_id: emoteSetId,
      })

      // Ensure connection is established
      if (!sevenTVEventClient.isConnected) {
        sevenTVEventClient.connect()
      }
    }

    sub.channelKeys.add(channelKey)
    sub.clientSecrets.add(clientSecret)
  }

  private subscribeToUserUpdates(userId: string, channelKey: string): void {
    let channelKeys = this.userSubscriptions.get(userId)
    if (!channelKeys) {
      channelKeys = new Set()
      this.userSubscriptions.set(userId, channelKeys)
      log.info('Subscribing to 7TV user.update', { channelKey, userId })
      sevenTVEventClient.subscribe('user.update', { object_id: userId })
      if (!sevenTVEventClient.isConnected) {
        sevenTVEventClient.connect()
      }
    }
    channelKeys.add(channelKey)
  }

  private unsubscribeFromUserUpdates(userId: string, channelKey: string): void {
    const channelKeys = this.userSubscriptions.get(userId)
    if (!channelKeys) {
      return
    }
    channelKeys.delete(channelKey)
    this.channelKeyToUserId.delete(channelKey)
    if (channelKeys.size === 0) {
      this.userSubscriptions.delete(userId)
      log.info('Unsubscribing from 7TV user.update', { userId })
      sevenTVEventClient.unsubscribe('user.update', { object_id: userId })
    }
  }

  private handleEvent(event: {
    type: string
    body: EmoteSetUpdateEvent | EmoteSetDeleteEvent | UserUpdateEvent
  }): void {
    log.info('handleEvent called', { eventType: event.type, hasBody: Boolean(event.body) })

    if (event.type === 'user.update') {
      this.handleUserUpdateEvent(event.body as UserUpdateEvent)
      return
    }

    if (event.type === 'emote_set.delete') {
      this.handleEmoteSetDeleteEvent(event.body as EmoteSetDeleteEvent)
      return
    }

    if (event.type !== 'emote_set.update') {
      return
    }

    const body = event.body as EmoteSetUpdateEvent
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

    for (const push of body.pushed ?? []) {
      if (push.key === 'emotes') {
        const valueData = push.value as any
        const emoteData = valueData.data
        const hostUrl = emoteData?.host?.url || ''
        const files = emoteData?.host?.files || []

        const image = files.find((f: any) => f.name === '1x.webp' || f.name === '1x.avif')
        const imageUrl = hostUrl ? `https:${hostUrl}/${image?.name || '1x.webp'}` : ''

        const emote: SevenTVEmote = {
          alias: valueData.name.toLowerCase(),
          animated: emoteData?.animated ?? false,
          aspectRatio: 1,
          id: valueData.id,
          imageUrl,
          name: valueData.name,
          zeroWidth: false,
        }

        log.info('7TV emote ADDED', {
          alias: emote.alias,
          emoteId: emote.id,
          emoteSetId: body.id,
          name: emote.name,
        })

        for (const channelKey of emoteSetSub.channelKeys) {
          const [platform, channelId] = channelKey.split(':') as [Platform, string]
          sevenTVCache.addEmote(platform, channelId, emote)

          this.broadcastToChannel(channelKey, {
            channelId,
            emote,
            platform,
            type: 'seventv_emote_added',
          })

          this.broadcastToChannel(channelKey, {
            action: 'added',
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
        const oldValueData = pull.old_value as any
        const emoteData = oldValueData.data
        const hostUrl = emoteData?.host?.url || ''
        const files = emoteData?.host?.files || []

        const image = files.find((f: any) => f.name === '1x.webp' || f.name === '1x.avif')
        const imageUrl = hostUrl ? `https:${hostUrl}/${image?.name || '1x.webp'}` : ''

        log.info('7TV emote REMOVED', {
          alias: oldValueData.name,
          emoteId: oldValueData.id,
          emoteSetId: body.id,
          name: oldValueData.name,
        })

        for (const channelKey of emoteSetSub.channelKeys) {
          const [platform, channelId] = channelKey.split(':') as [Platform, string]
          sevenTVCache.removeEmote(platform, channelId, oldValueData.id)

          this.broadcastToChannel(channelKey, {
            channelId,
            emoteId: oldValueData.id,
            platform,
            type: 'seventv_emote_removed',
          })

          this.broadcastToChannel(channelKey, {
            action: 'removed',
            channelId,
            emote: {
              alias: oldValueData.name.toLowerCase(),
              animated: emoteData?.animated ?? false,
              aspectRatio: 1,
              id: oldValueData.id,
              imageUrl,
              name: oldValueData.name,
              zeroWidth: false,
            },
            platform,
            type: 'seventv_system_message',
          })
        }
      }
    }

    for (const update of body.updated ?? []) {
      if (update.key === 'name' && typeof update.value === 'string') {
        const newName = update.value
        const oldName = typeof update.old_value === 'string' ? update.old_value : ''

        log.info('7TV emote set RENAMED', {
          emoteSetId: body.id,
          newName,
          oldName,
        })

        for (const channelKey of emoteSetSub.channelKeys) {
          const [platform, channelId] = channelKey.split(':') as [Platform, string]

          const cachedSet = sevenTVCache.get(platform, channelId)
          if (cachedSet) {
            cachedSet.name = newName
          }

          this.broadcastToChannel(channelKey, {
            action: 'set_renamed',
            channelId,
            newName,
            oldName,
            platform,
            type: 'seventv_system_message',
          })
        }
      }

      if (update.key === 'emotes') {
        const newValue = update.value as any
        const oldValue = update.old_value as any

        log.info('7TV emote UPDATED', {
          emoteId: newValue.id,
          emoteSetId: body.id,
          newAlias: newValue.name,
          oldAlias: oldValue.name,
        })

        for (const channelKey of emoteSetSub.channelKeys) {
          const [platform, channelId] = channelKey.split(':') as [Platform, string]
          sevenTVCache.updateEmote(platform, channelId, newValue.id, {
            alias: newValue.name,
          })

          this.broadcastToChannel(channelKey, {
            alias: newValue.name,
            channelId,
            emoteId: newValue.id,
            platform,
            type: 'seventv_emote_updated',
          })

          const cachedSet = sevenTVCache.get(platform, channelId)
          let emoteForMessage: SevenTVEmote = {
            alias: newValue.name.toLowerCase(),
            animated: false,
            aspectRatio: 1,
            id: newValue.id,
            imageUrl: '',
            name: newValue.name,
            zeroWidth: false,
          }

          if (cachedSet) {
            for (const [, cachedEmote] of cachedSet.emotes) {
              if (cachedEmote.id === newValue.id) {
                emoteForMessage = cachedEmote
                break
              }
            }
          }

          this.broadcastToChannel(channelKey, {
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

    for (const channelKey of emoteSetSub.channelKeys) {
      const [platform, channelId] = channelKey.split(':') as [Platform, string]
      const cachedSet = sevenTVCache.get(platform, channelId)
      const setName = cachedSet?.name ?? body.id

      this.broadcastToChannel(channelKey, {
        action: 'set_deleted',
        channelId,
        platform,
        setName,
        type: 'seventv_system_message',
      })
    }
  }

  private async handleUserUpdateEvent(body: UserUpdateEvent): Promise<void> {
    log.info('[handleUserUpdateEvent] called', {
      updatedKeys: body.updated?.map((u) => u.key),
      userId: body.id,
    })

    const channelKeys = this.userSubscriptions.get(body.id)
    if (!channelKeys) {
      log.info('[handleUserUpdateEvent] no channelKeys for userId — ignoring', { userId: body.id })
      return
    }

    log.info('[handleUserUpdateEvent] found channelKeys', {
      channelKeys: [...channelKeys],
      userId: body.id,
    })

    let newEmoteSetId: string | null = null
    for (const update of body.updated ?? []) {
      log.info('[handleUserUpdateEvent] processing update', {
        isArray: Array.isArray(update.value),
        key: update.key,
        valueType: typeof update.value,
      })
      if (update.key !== 'connections') {
        continue
      }
      const nested = Array.isArray(update.value)
        ? (update.value as { key: string; value: unknown }[])
        : []
      log.info('[handleUserUpdateEvent] connections nested fields', {
        count: nested.length,
        fields: nested.map((f) => ({ key: f.key, value: f.value, valueType: typeof f.value })),
      })
      for (const field of nested) {
        if (field.key === 'emote_set_id' && typeof field.value === 'string') {
          newEmoteSetId = field.value
          break
        }
      }
      if (newEmoteSetId) {
        break
      }
    }

    if (!newEmoteSetId) {
      log.info('[handleUserUpdateEvent] no emote_set_id string found in update — ignoring', {
        userId: body.id,
      })
      return
    }

    log.info('Active emote set changed', {
      newEmoteSetId,
      userId: body.id,
    })

    for (const channelKey of channelKeys) {
      const [platform, channelId] = channelKey.split(':') as [Platform, string]

      const existing = this.findClientSubscriptionForChannel(platform, channelId)
      if (!existing) {
        log.info('[handleUserUpdateEvent] no client subscription for channel — skipping', {
          channelKey,
        })
        continue
      }

      const oldEmoteSetId = existing.emoteSetId
      if (oldEmoteSetId === newEmoteSetId) {
        log.info('[handleUserUpdateEvent] emoteSetId unchanged — skipping', {
          channelKey,
          oldEmoteSetId,
        })
        continue
      }

      log.info('[handleUserUpdateEvent] swapping emote set', {
        channelKey,
        newEmoteSetId,
        oldEmoteSetId,
      })

      const oldEmoteSetSub = this.emoteSetSubscriptions.get(oldEmoteSetId)
      if (oldEmoteSetSub) {
        oldEmoteSetSub.channelKeys.delete(channelKey)
        for (const [clientSecret, subs] of this.clientSubscriptions) {
          for (const sub of subs) {
            if (sub.platform === platform && sub.channelId === channelId) {
              oldEmoteSetSub.clientSecrets.delete(clientSecret)
            }
          }
        }
        if (oldEmoteSetSub.clientSecrets.size === 0) {
          log.info('[handleUserUpdateEvent] unsubscribing from old emote_set.update', {
            oldEmoteSetId,
          })
          sevenTVEventClient.unsubscribe('emote_set.update', { object_id: oldEmoteSetId })
          sevenTVEventClient.unsubscribe('emote_set.delete', { object_id: oldEmoteSetId })
          this.emoteSetSubscriptions.delete(oldEmoteSetId)
        }
      }

      let newSetName: string
      try {
        newSetName = await this.fetchAndCacheEmoteSetById(newEmoteSetId, platform, channelId)
      } catch (error) {
        log.error('Failed to fetch new emote set after active set change', {
          channelKey,
          error: String(error),
        })
        continue
      }

      const affectedClientSecrets: string[] = []
      for (const [clientSecret, subs] of this.clientSubscriptions) {
        for (const sub of subs) {
          if (sub.platform === platform && sub.channelId === channelId) {
            sub.emoteSetId = newEmoteSetId
            affectedClientSecrets.push(clientSecret)
          }
        }
      }

      log.info('[handleUserUpdateEvent] subscribing to new emote set for clients', {
        channelKey,
        clientCount: affectedClientSecrets.length,
        newEmoteSetId,
      })
      for (const clientSecret of affectedClientSecrets) {
        this.subscribeToEmoteSetUpdates(newEmoteSetId, channelKey, clientSecret)
      }

      const newEmoteSet = sevenTVCache.get(platform, channelId)
      if (newEmoteSet) {
        log.info('[handleUserUpdateEvent] sending new emote set to clients', {
          channelKey,
          clientCount: affectedClientSecrets.length,
          newEmoteSetId,
        })
        for (const clientSecret of affectedClientSecrets) {
          this.sendEmoteSetToClient(clientSecret, platform, channelId, newEmoteSet)
        }
      } else {
        log.error(
          '[handleUserUpdateEvent] emote set not in cache after fetch — cannot push to clients',
          { channelKey, newEmoteSetId },
        )
      }

      this.broadcastToChannel(channelKey, {
        action: 'set_changed',
        channelId,
        platform,
        setName: newSetName,
        type: 'seventv_system_message',
      })
    }
  }

  private findClientSubscriptionForChannel(
    platform: Platform,
    channelId: string,
  ): ClientSubscription | null {
    for (const subs of this.clientSubscriptions.values()) {
      for (const sub of subs) {
        if (sub.platform === platform && sub.channelId === channelId) {
          return sub
        }
      }
    }
    return null
  }

  private sendEmoteSetToClient(
    clientSecret: string,
    platform: Platform,
    channelId: string,
    emoteSet: { id: string; emotes: Map<string, SevenTVEmote> },
  ): void {
    this.sendToClient?.(clientSecret, {
      channelId,
      emotes: Array.from(emoteSet.emotes.values()),
      platform,
      type: 'seventv_emote_set',
    })
  }

  private broadcastToChannel(channelKey: string, message: unknown): void {
    const [platform, channelId] = channelKey.split(':') as [Platform, string]

    // Find all clients subscribed to this channel
    let foundClients = 0
    for (const [clientSecret, subs] of this.clientSubscriptions) {
      for (const sub of subs) {
        if (sub.platform === platform && sub.channelId === channelId) {
          this.sendToClient?.(clientSecret, message)
          foundClients++
          break
        }
      }
    }

    log.info('Broadcast result', {
      channelKey,
      clientCount: foundClients,
      messageType: (message as any).type,
    })
  }

  getStats(): {
    connectedClients: number
    emoteSetSubscriptions: number
    eventClientConnected: boolean
  } {
    return {
      connectedClients: this.clientSubscriptions.size,
      emoteSetSubscriptions: this.emoteSetSubscriptions.size,
      eventClientConnected: sevenTVEventClient.isConnected,
    }
  }
}

export const sevenTVManager = new SevenTVSubscriptionManager()
