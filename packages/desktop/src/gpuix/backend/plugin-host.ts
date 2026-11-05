import type { NormalizedChatMessage, Platform, PlatformStatusInfo } from '@twirchat/shared/types'

import type { PluginChannel, PluginEventMap } from '../../plugins/api'
import { platformSchema } from '../../services/persisted-schemas'
import {
  isPluginWatchedChannel,
  type PluginWatchedChannel,
} from '../../watched-channels/plugin-channel-types'
import type { createPluginChannels } from '../../watched-channels/plugin-channels'
import type { DesktopApi } from './api'
import type { DesktopEvents } from './events'

type PluginChannels = ReturnType<typeof createPluginChannels>
type PluginSubscriptions = {
  [K in keyof PluginEventMap]: (listener: (event: PluginEventMap[K]) => void) => () => void
}
const PLUGIN_SYSTEM_AUTHOR = 'twirchat:plugin'

function builtinChannel(platform: Platform, id: string): PluginChannel {
  return { platform, id, name: id }
}

interface PluginHostDependencies {
  events: DesktopEvents
  getApi: () => DesktopApi
  getPluginChannels: () => PluginChannels
}

export function pluginWatchedTarget(channel: PluginWatchedChannel): PluginChannel {
  return {
    platform: channel.platform,
    id: channel.channelSlug,
    name: channel.displayName,
    watchedChannelId: channel.id,
  }
}

function chatMessage(
  message: NormalizedChatMessage,
  watchedChannelId?: string,
): PluginEventMap['message'] {
  return {
    channel: {
      platform: message.platform,
      id: message.channelId,
      name: message.channelId,
      watchedChannelId,
    },
    id: message.id,
    author: {
      id: message.author.id,
      name: message.author.displayName,
      username: message.author.username,
    },
    text: message.text,
    timestamp: message.timestamp.getTime(),
    type: message.type,
  }
}

function channelStatus(
  status: PlatformStatusInfo,
  watchedChannelId?: string,
): PluginEventMap['channelStatus'] | null {
  const id = status.channelId ?? status.channelLogin ?? watchedChannelId
  if (!id) return null
  return {
    channel: {
      platform: status.platform,
      id,
      name: status.channelLogin ?? id,
      watchedChannelId,
    },
    status: status.status,
    error: status.error,
  }
}

export function createPluginHost({ events, getApi, getPluginChannels }: PluginHostDependencies) {
  const subscriptions: PluginSubscriptions = {
    message(listener) {
      const own = events.on('chat_message', (message) => {
        if (message.author.id !== PLUGIN_SYSTEM_AUTHOR) listener(chatMessage(message))
      })
      const watched = events.on('watched_channel_message', ({ channelId, message }) => {
        if (message.author.id !== PLUGIN_SYSTEM_AUTHOR) listener(chatMessage(message, channelId))
      })
      const custom = events.on('plugin_channel_message', ({ channel, message }) => {
        listener({
          ...message,
          channel: pluginWatchedTarget(channel),
          timestamp: message.timestamp ?? Date.now(),
          type: 'message',
        })
      })
      return () => {
        own()
        watched()
        custom()
      }
    },
    channelStatus(listener) {
      const notify = (status: PlatformStatusInfo, watchedChannelId?: string) => {
        const update = channelStatus(status, watchedChannelId)
        if (update) listener(update)
      }
      const own = events.on('platform_status', (status) => notify(status))
      const watched = events.on('watched_channel_status', ({ channelId, status }) =>
        notify(status, channelId),
      )
      const custom = events.on('plugin_channel_status', ({ channel, status }) =>
        listener({ channel: pluginWatchedTarget(channel), ...status }),
      )
      return () => {
        own()
        watched()
        custom()
      }
    },
    chatEvent(listener) {
      return events.on('chat_event', (event) => {
        const id = event.data.channelId
        listener({
          id: event.id,
          channel: typeof id === 'string' ? builtinChannel(event.platform, id) : null,
          type: event.type,
          user: { id: event.user.id, name: event.user.displayName },
          timestamp: event.timestamp.getTime(),
        })
      })
    },
    roomState(listener) {
      return events.on('channel_room_state', ({ platform, channelId, ...state }) =>
        listener({ channel: builtinChannel(platform, channelId), ...state }),
      )
    },
    moderation(listener) {
      return events.on('chat_moderation', ({ platform, channelId, ...outcome }) =>
        listener({ channel: builtinChannel(platform, channelId), ...outcome }),
      )
    },
    chatCleared(listener) {
      return events.on('chat_clear', ({ platform, channelId }) =>
        listener({ channel: builtinChannel(platform, channelId) }),
      )
    },
  }

  async function resolveWatched(channel: PluginChannel) {
    const watched = (await getApi().getWatchedChannels()).find(
      (candidate) => candidate.id === channel.watchedChannelId,
    )
    if (!watched || watched.platform !== channel.platform)
      throw new Error('This watched channel is no longer available.')
    return watched
  }

  return {
    subscribe<K extends keyof PluginEventMap>(
      event: K,
      listener: (payload: PluginEventMap[K]) => void,
    ) {
      return subscriptions[event](listener)
    },
    async getChannels(): Promise<PluginChannel[]> {
      const api = getApi()
      const [own, watched] = await Promise.all([api.getChannels(), api.getWatchedChannels()])
      return [
        ...Object.entries(own).flatMap(([platform, channels]) =>
          channels.map((id) => ({ platform, id, name: id })),
        ),
        ...watched.map((channel) => ({
          platform: channel.platform,
          id: channel.channelSlug,
          name: channel.displayName,
          watchedChannelId: channel.id,
        })),
      ]
    },
    async sendMessage(channel: PluginChannel, text: string): Promise<void> {
      const api = getApi()
      if (channel.watchedChannelId) {
        const watched = await resolveWatched(channel)
        if (isPluginWatchedChannel(watched)) await getPluginChannels().sendMessage(watched.id, text)
        else await api.sendWatchedChannelMessage({ id: watched.id, text })
        return
      }
      const platform = platformSchema.parse(channel.platform)
      await api.sendMessage({ platform, channelId: channel.id, text })
    },
    async addSystemMessage(channel: PluginChannel, text: string): Promise<void> {
      const watched = channel.watchedChannelId ? await resolveWatched(channel) : null
      if (watched && isPluginWatchedChannel(watched)) {
        getPluginChannels().addSystemMessage(watched.id, text)
        return
      }
      const message: NormalizedChatMessage = {
        id: `plugin:${crypto.randomUUID()}`,
        platform: platformSchema.parse(channel.platform),
        channelId: watched?.channelSlug ?? channel.id,
        author: { id: PLUGIN_SYSTEM_AUTHOR, displayName: 'Plugin', badges: [] },
        text,
        emotes: [],
        timestamp: new Date(),
        type: 'system',
      }
      if (watched) events.emit('watched_channel_message', { channelId: watched.id, message })
      else events.emit('chat_message', message)
    },
  }
}
