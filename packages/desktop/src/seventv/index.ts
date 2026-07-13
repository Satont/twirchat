import type { Platform, SevenTVEmote } from '@twirchat/shared'
import { getBackendUrl } from '../runtime-config'

interface EmoteSetData {
  platform: Platform
  channelId: string
  emotes: Map<string, SevenTVEmote> // Alias -> emote
}

interface ChannelSubscription {
  platform: Platform
  channelId: string
  platformUserId?: string
  lookupIds: Set<string>
}

class DesktopSevenTVService {
  private emoteSets = new Map<string, EmoteSetData>() // ChannelKey -> emoteSet
  private subscriptions = new Map<string, ChannelSubscription>()
  private lookupToChannelKey = new Map<string, string>()
  private _backendUrl: string | null = null

  private getChannelKey(platform: Platform, channelId: string): string {
    return `${platform}:${channelId}`
  }

  private rememberLookupIds(
    platform: Platform,
    channelId: string,
    lookupIds: Iterable<string>,
    platformUserId?: string,
  ): ChannelSubscription {
    const channelKey = this.getChannelKey(platform, channelId)
    let subscription = this.subscriptions.get(channelKey)

    if (!subscription) {
      subscription = {
        channelId,
        lookupIds: new Set<string>(),
        platform,
        platformUserId,
      }
      this.subscriptions.set(channelKey, subscription)
    }

    if (platformUserId) {
      subscription.platformUserId = platformUserId
    }

    for (const lookupId of lookupIds) {
      const lookupKey = this.getChannelKey(platform, lookupId)
      this.lookupToChannelKey.set(lookupKey, channelKey)
      subscription.lookupIds.add(lookupId)
    }

    return subscription
  }

  private resolveChannelKey(platform: Platform, channelId: string): string {
    const channelKey = this.getChannelKey(platform, channelId)
    return this.lookupToChannelKey.get(channelKey) ?? channelKey
  }

  private get backendUrl(): string {
    if (!this._backendUrl) {
      this._backendUrl = getBackendUrl()
    }
    return this._backendUrl
  }

  // Subscribe to 7TV emotes for a channel (called when joining a channel)
  async subscribeToChannel(
    platform: Platform,
    channelId: string,
    lookupIds: string[] = [],
    platformUserId?: string,
  ): Promise<void> {
    const subscription = this.rememberLookupIds(
      platform,
      channelId,
      [channelId, ...lookupIds],
      platformUserId,
    )
    subscription.platformUserId = platformUserId

    // Send via backend WebSocket
    const message = {
      channelId,
      platform,
      platformUserId,
      type: 'seventv_subscribe' as const,
    }

    // This will be sent via the existing backend connection
    this.sendToBackend(message)
  }

  // Unsubscribe when leaving channel
  async unsubscribeFromChannel(platform: Platform, channelId: string): Promise<void> {
    const channelKey = this.resolveChannelKey(platform, channelId)
    const subscription = this.subscriptions.get(channelKey)
    const backendChannelId = subscription?.channelId ?? channelId

    // Remove from local cache
    this.emoteSets.delete(channelKey)
    this.subscriptions.delete(channelKey)

    if (subscription) {
      for (const lookupId of subscription.lookupIds) {
        this.lookupToChannelKey.delete(this.getChannelKey(platform, lookupId))
      }
    } else {
      this.lookupToChannelKey.delete(this.getChannelKey(platform, channelId))
    }

    // Send via backend WebSocket
    const message = {
      channelId: backendChannelId,
      platform,
      type: 'seventv_unsubscribe' as const,
    }

    this.sendToBackend(message)
  }

  // Called on reconnect - resubscribe to all channels
  async resubscribeToChannels(
    subscriptions: { platform: Platform; channelId: string; platformUserId?: string }[],
  ): Promise<void> {
    const message = {
      subscriptions,
      type: 'seventv_resubscribe' as const,
    }

    this.sendToBackend(message)
  }

  // Handle incoming emote set from backend
  handleEmoteSet(platform: Platform, channelId: string, emotes: SevenTVEmote[]): void {
    const channelKey = this.getChannelKey(platform, channelId)
    this.rememberLookupIds(platform, channelId, [channelId])
    const emoteMap = new Map<string, SevenTVEmote>()

    for (const emote of emotes) {
      emoteMap.set(emote.alias.toLowerCase(), emote)
    }

    this.emoteSets.set(channelKey, {
      channelId,
      emotes: emoteMap,
      platform,
    })
  }

  // Handle emote added
  handleEmoteAdded(platform: Platform, channelId: string, emote: SevenTVEmote): void {
    const channelKey = this.getChannelKey(platform, channelId)
    const emoteSet = this.emoteSets.get(channelKey)

    if (emoteSet) {
      emoteSet.emotes.set(emote.alias.toLowerCase(), emote)
    }
  }

  // Handle emote removed
  handleEmoteRemoved(platform: Platform, channelId: string, emoteId: string): void {
    const channelKey = this.getChannelKey(platform, channelId)
    const emoteSet = this.emoteSets.get(channelKey)

    if (emoteSet) {
      // Find and remove by ID
      for (const [alias, emote] of emoteSet.emotes) {
        if (emote.id === emoteId) {
          emoteSet.emotes.delete(alias)
          break
        }
      }
    }
  }

  // Handle emote updated (renamed)
  handleEmoteUpdated(
    platform: Platform,
    channelId: string,
    emoteId: string,
    newAlias: string,
  ): void {
    const channelKey = this.getChannelKey(platform, channelId)
    const emoteSet = this.emoteSets.get(channelKey)

    if (emoteSet) {
      // Find by ID and update alias
      for (const [alias, emote] of emoteSet.emotes) {
        if (emote.id === emoteId) {
          emoteSet.emotes.delete(alias)
          emote.alias = newAlias.toLowerCase()
          emoteSet.emotes.set(emote.alias, emote)
          break
        }
      }
    }
  }

  // Get proxied image URL
  getImageUrl(emoteId: string, size: string = '4x'): string {
    return `${this.backendUrl}/proxy/7tv/${emoteId}?size=${size}`
  }

  // Lookup emote by alias for a channel
  getEmote(platform: Platform, channelId: string, alias: string): SevenTVEmote | undefined {
    const channelKey = this.resolveChannelKey(platform, channelId)
    const emoteSet = this.emoteSets.get(channelKey)

    if (!emoteSet) {
      return undefined
    }

    return emoteSet.emotes.get(alias.toLowerCase())
  }

  // Get all emotes for a channel
  getEmotes(platform: Platform, channelId: string): SevenTVEmote[] {
    const channelKey = this.resolveChannelKey(platform, channelId)
    const emoteSet = this.emoteSets.get(channelKey)

    if (!emoteSet) {
      return []
    }

    return [...emoteSet.emotes.values()]
  }

  // Get all subscribed channels
  getSubscribedChannels(): { platform: Platform; channelId: string; platformUserId?: string }[] {
    return [...this.subscriptions.values()].map((subscription) => ({
      channelId: subscription.channelId,
      platform: subscription.platform,
      platformUserId: subscription.platformUserId,
    }))
  }

  getLookupChannelIds(platform: Platform, channelId: string): string[] {
    const channelKey = this.resolveChannelKey(platform, channelId)
    const subscription = this.subscriptions.get(channelKey)

    if (!subscription) {
      return [channelId]
    }

    return [...subscription.lookupIds]
  }

  // This will be set by the backend connection module
  sendToBackend: (message: unknown) => void = () => {
    console.warn('[7TV] sendToBackend not initialized')
  }
}

// Export singleton instance
export const sevenTVService = new DesktopSevenTVService()
