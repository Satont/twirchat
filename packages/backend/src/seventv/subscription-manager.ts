import type { Platform } from "@twirchat/shared";
import { logger } from "@twirchat/shared/logger";
import { sevenTVCache, type SevenTVEmote } from "./cache";
import { sevenTVEventClient, type EmoteSetUpdateEvent } from "./event-client";
import { getUserByConnection } from "./client";

const log = logger("seventv:manager");

interface ClientSubscription {
  platform: Platform;
  channelId: string;
  emoteSetId: string;
}

interface EmoteSetSubscription {
  emoteSetId: string;
  channelKeys: Set<string>; // "platform:channelId"
  clientSecrets: Set<string>;
}

export class SevenTVSubscriptionManager {
  private clientSubscriptions = new Map<string, Set<ClientSubscription>>(); // clientSecret -> subscriptions
  private emoteSetSubscriptions = new Map<string, EmoteSetSubscription>(); // emoteSetId -> subscription

  // Callback to send messages to desktop clients
  sendToClient: ((clientSecret: string, message: unknown) => void) | null =
    null;

  constructor() {
    // Setup event handler
    sevenTVEventClient.onEvent = (event) => this.handleEvent(event);
  }

  async subscribeClient(
    clientSecret: string,
    platform: Platform,
    channelId: string,
  ): Promise<boolean> {
    const channelKey = `${platform}:${channelId}`;
    log.info("Subscribing client to channel", {
      clientSecret: clientSecret.slice(0, 8),
      channelKey,
    });

    // Check if client already subscribed to this channel
    const clientSubs = this.clientSubscriptions.get(clientSecret);
    if (clientSubs) {
      const existing = Array.from(clientSubs).find(
        (s) => s.platform === platform && s.channelId === channelId,
      );
      if (existing) {
        log.debug("Client already subscribed to channel", {
          clientSecret: clientSecret.slice(0, 8),
          channelKey,
        });
        return true;
      }
    }

    // Check cache first
    const cached = sevenTVCache.get(platform, channelId);
    const isExpired = sevenTVCache.isExpired(platform, channelId);

    if (cached && !isExpired) {
      log.debug("Using cached emote set", { channelKey });
      this.sendEmoteSetToClient(clientSecret, platform, channelId, cached);
    }

    // If no cache or expired, fetch from 7TV
    if (!cached || isExpired) {
      try {
        await this.fetchAndCacheEmoteSet(platform, channelId);
      } catch (error) {
        log.error("Failed to fetch emote set", {
          channelKey,
          channelId,
          error: String(error),
        });

        // If we have stale cache, use it
        if (cached) {
          log.warn("Using stale cache", { channelKey, channelId });
          this.sendEmoteSetToClient(clientSecret, platform, channelId, cached);
        }

        return false;
      }
    }

    // Get the emote set ID from cache
    const emoteSet = sevenTVCache.get(platform, channelId);
    if (!emoteSet) {
      log.error("No emote set found after fetch", { channelKey });
      return false;
    }

    // Register subscription
    this.registerSubscription(clientSecret, platform, channelId, emoteSet.id);

    // Subscribe to 7TV EventAPI if not already subscribed
    this.subscribeToEmoteSetUpdates(emoteSet.id, channelKey, clientSecret);

    // Send emote set to client
    this.sendEmoteSetToClient(clientSecret, platform, channelId, emoteSet);

    return true;
  }

  unsubscribeClient(
    clientSecret: string,
    platform: Platform,
    channelId: string,
  ): void {
    const channelKey = `${platform}:${channelId}`;
    log.info("Unsubscribing client from channel", {
      clientSecret: clientSecret.slice(0, 8),
      channelKey,
    });

    // Remove from client subscriptions
    const clientSubs = this.clientSubscriptions.get(clientSecret);
    if (clientSubs) {
      const sub = Array.from(clientSubs).find(
        (s) => s.platform === platform && s.channelId === channelId,
      );

      if (sub) {
        clientSubs.delete(sub);

        // Remove from emote set subscription
        const emoteSetSub = this.emoteSetSubscriptions.get(sub.emoteSetId);
        if (emoteSetSub) {
          emoteSetSub.channelKeys.delete(channelKey);
          emoteSetSub.clientSecrets.delete(clientSecret);

          // If no more clients, unsubscribe from 7TV
          if (emoteSetSub.clientSecrets.size === 0) {
            log.info("Unsubscribing from 7TV EventAPI", {
              emoteSetId: sub.emoteSetId,
            });
            sevenTVEventClient.unsubscribe("emote_set.update", {
              object_id: sub.emoteSetId,
            });
            this.emoteSetSubscriptions.delete(sub.emoteSetId);
          }
        }
      }

      // Clean up empty client subscriptions
      if (clientSubs.size === 0) {
        this.clientSubscriptions.delete(clientSecret);
      }
    }
  }

  cleanupClient(clientSecret: string): void {
    log.info("Cleaning up client subscriptions", {
      clientSecret: clientSecret.slice(0, 8),
    });

    const clientSubs = this.clientSubscriptions.get(clientSecret);
    if (!clientSubs) return;

    for (const sub of clientSubs) {
      this.unsubscribeClient(clientSecret, sub.platform, sub.channelId);
    }
  }

  private async fetchAndCacheEmoteSet(
    platform: Platform,
    channelId: string,
  ): Promise<void> {
    const channelKey = `${platform}:${channelId}`;
    log.info("Fetching emote set from 7TV", { channelKey });

    // Convert platform to 7TV Platform enum
    const sevenTVPlatform = platform.toUpperCase();

    const result = await getUserByConnection(
      sevenTVPlatform as "TWITCH" | "KICK",
      channelId,
    );

    const user = result.users?.userByConnection;
    if (!user) {
      throw new Error("User not found on 7TV");
    }

    const emoteSet = user.style?.activeEmoteSet;
    if (!emoteSet) {
      throw new Error("No active emote set found");
    }

    // Convert to cache format
    const emotes = new Map<string, SevenTVEmote>();

    for (const item of emoteSet.emotes?.items ?? []) {
      const alias = item.alias.toLowerCase();
      const image = item.emote.images?.[0];

      emotes.set(alias, {
        id: item.emote.id,
        alias: alias,
        name: item.emote.defaultName,
        animated: item.emote.flags?.animated ?? false,
        zeroWidth: item.flags?.zeroWidth ?? false,
        aspectRatio: item.emote.aspectRatio ?? 1,
        imageUrl: image?.url ?? ``,
      });
    }

    sevenTVCache.set(platform, channelId, {
      id: emoteSet.id,
      channelId,
      platform,
      emotes,
      fetchedAt: Date.now(),
      ttl: 5 * 60 * 1000,
    });

    log.info("Emote set cached", {
      channelKey,
      emoteSetId: emoteSet.id,
      emoteCount: emotes.size,
    });
  }

  private registerSubscription(
    clientSecret: string,
    platform: Platform,
    channelId: string,
    emoteSetId: string,
  ): void {
    let clientSubs = this.clientSubscriptions.get(clientSecret);
    if (!clientSubs) {
      clientSubs = new Set();
      this.clientSubscriptions.set(clientSecret, clientSubs);
    }

    clientSubs.add({ platform, channelId, emoteSetId });
  }

  private subscribeToEmoteSetUpdates(
    emoteSetId: string,
    channelKey: string,
    clientSecret: string,
  ): void {
    let sub = this.emoteSetSubscriptions.get(emoteSetId);

    if (!sub) {
      sub = {
        emoteSetId,
        channelKeys: new Set(),
        clientSecrets: new Set(),
      };
      this.emoteSetSubscriptions.set(emoteSetId, sub);

      // Subscribe to 7TV EventAPI
      log.info("SUBSCRIBING TO 7TV", { 
        type: "emote_set.update", 
        emoteSetId,
        channelKey 
      });
      sevenTVEventClient.subscribe("emote_set.update", {
        object_id: emoteSetId,
      });

      // Ensure connection is established
      if (!sevenTVEventClient.isConnected) {
        sevenTVEventClient.connect();
      }
    }

    sub.channelKeys.add(channelKey);
    sub.clientSecrets.add(clientSecret);
  }

  private handleEvent(event: {
    type: string;
    body: EmoteSetUpdateEvent;
  }): void {
    log.info("handleEvent called", { eventType: event.type, hasBody: !!event.body });
    
    if (event.type !== "emote_set.update") return;

    const { body } = event;
    const emoteSetSub = this.emoteSetSubscriptions.get(body.id);

    if (!emoteSetSub) {
      log.debug("Received event for unknown emote set", {
        emoteSetId: body.id,
      });
      return;
    }

    log.info("Received emote set update", {
      emoteSetId: body.id,
      pushed: body.pushed?.length ?? 0,
      pulled: body.pulled?.length ?? 0,
      updated: body.updated?.length ?? 0,
    });

    // Handle pushed (added) emotes
    for (const push of body.pushed ?? []) {
      if (push.key === "emotes") {
        const valueData = push.value as any;
        const emoteData = valueData.data;
        const hostUrl = emoteData?.host?.url || "";
        const files = emoteData?.host?.files || [];
        
        const image = files.find((f: any) => f.name === "1x.webp" || f.name === "1x.avif");
        const imageUrl = hostUrl ? `https:${hostUrl}/${image?.name || "1x.webp"}` : "";
        
        const emote: SevenTVEmote = {
          id: valueData.id,
          alias: valueData.name.toLowerCase(),
          name: valueData.name,
          animated: emoteData?.animated ?? false,
          zeroWidth: false,
          aspectRatio: 1,
          imageUrl,
        };

        log.info("7TV emote ADDED", {
          emoteSetId: body.id,
          emoteId: emote.id,
          alias: emote.alias,
          name: emote.name,
        });

        for (const channelKey of emoteSetSub.channelKeys) {
          const [platform, channelId] = channelKey.split(":") as [
            Platform,
            string,
          ];
          sevenTVCache.addEmote(platform, channelId, emote);

          this.broadcastToChannel(channelKey, {
            type: "seventv_emote_added",
            platform,
            channelId,
            emote,
          });

          this.broadcastToChannel(channelKey, {
            type: "seventv_system_message",
            platform,
            channelId,
            action: "added",
            emote,
          });
        }
      }
    }

    // Handle pulled (removed) emotes
    for (const pull of body.pulled ?? []) {
      if (pull.key === "emotes") {
        const oldValueData = pull.old_value as any;
        const emoteData = oldValueData.data;
        const hostUrl = emoteData?.host?.url || "";
        const files = emoteData?.host?.files || [];
        
        const image = files.find((f: any) => f.name === "1x.webp" || f.name === "1x.avif");
        const imageUrl = hostUrl ? `https:${hostUrl}/${image?.name || "1x.webp"}` : "";
        
        log.info("7TV emote REMOVED", {
          emoteSetId: body.id,
          emoteId: oldValueData.id,
          alias: oldValueData.name,
          name: oldValueData.name,
        });

        for (const channelKey of emoteSetSub.channelKeys) {
          const [platform, channelId] = channelKey.split(":") as [
            Platform,
            string,
          ];
          sevenTVCache.removeEmote(
            platform,
            channelId,
            oldValueData.id,
          );

          this.broadcastToChannel(channelKey, {
            type: "seventv_emote_removed",
            platform,
            channelId,
            emoteId: oldValueData.id,
          });

          this.broadcastToChannel(channelKey, {
            type: "seventv_system_message",
            platform,
            channelId,
            action: "removed",
            emote: {
              id: oldValueData.id,
              alias: oldValueData.name.toLowerCase(),
              name: oldValueData.name,
              animated: emoteData?.animated ?? false,
              zeroWidth: false,
              aspectRatio: 1,
              imageUrl,
            },
          });
        }
      }
    }

    // Handle updated (renamed) emotes
    for (const update of body.updated ?? []) {
      if (update.key === "emotes") {
        const newValue = update.value as any;
        const oldValue = update.old_value as any;
        
        log.info("7TV emote UPDATED", {
          emoteSetId: body.id,
          emoteId: newValue.id,
          oldAlias: oldValue.name,
          newAlias: newValue.name,
        });

        for (const channelKey of emoteSetSub.channelKeys) {
          const [platform, channelId] = channelKey.split(":") as [
            Platform,
            string,
          ];
          sevenTVCache.updateEmote(platform, channelId, newValue.id, {
            alias: newValue.name,
          });

          this.broadcastToChannel(channelKey, {
            type: "seventv_emote_updated",
            platform,
            channelId,
            emoteId: newValue.id,
            alias: newValue.name,
          });

          const cachedSet = sevenTVCache.get(platform, channelId);
          let emoteForMessage: SevenTVEmote = {
            id: newValue.id,
            alias: newValue.name.toLowerCase(),
            name: newValue.name,
            animated: false,
            zeroWidth: false,
            aspectRatio: 1,
            imageUrl: "",
          };

          if (cachedSet) {
            for (const [, cachedEmote] of cachedSet.emotes) {
              if (cachedEmote.id === newValue.id) {
                emoteForMessage = cachedEmote;
                break;
              }
            }
          }

          this.broadcastToChannel(channelKey, {
            type: "seventv_system_message",
            platform,
            channelId,
            action: "updated",
            emote: emoteForMessage,
            oldAlias: oldValue.name,
          });
        }
      }
    }
  }

  private sendEmoteSetToClient(
    clientSecret: string,
    platform: Platform,
    channelId: string,
    emoteSet: { id: string; emotes: Map<string, SevenTVEmote> },
  ): void {
    this.sendToClient?.(clientSecret, {
      type: "seventv_emote_set",
      platform,
      channelId,
      emotes: Array.from(emoteSet.emotes.values()),
    });
  }

  private broadcastToChannel(channelKey: string, message: unknown): void {
    const [platform, channelId] = channelKey.split(":") as [Platform, string];

    // Find all clients subscribed to this channel
    let foundClients = 0;
    for (const [clientSecret, subs] of this.clientSubscriptions) {
      for (const sub of subs) {
        if (sub.platform === platform && sub.channelId === channelId) {
          this.sendToClient?.(clientSecret, message);
          foundClients++;
          break;
        }
      }
    }
    
    log.info("Broadcast result", { 
      channelKey, 
      messageType: (message as any).type,
      clientCount: foundClients 
    });
  }

  getStats(): {
    connectedClients: number;
    emoteSetSubscriptions: number;
    eventClientConnected: boolean;
  } {
    return {
      connectedClients: this.clientSubscriptions.size,
      emoteSetSubscriptions: this.emoteSetSubscriptions.size,
      eventClientConnected: sevenTVEventClient.isConnected,
    };
  }
}

export const sevenTVManager = new SevenTVSubscriptionManager();
