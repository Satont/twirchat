import type { DesktopApi } from '../../backend/api'
import { activeWatchedTabStore, watchedChannelsStore } from '../../state/app'
import { openChannelChatTab, type ChatTabApi } from '../../state/chat-tabs'
import { setMainTab } from '../../state/settings-session'
import { clearTabUnread } from '../../state/tab-unread'

type JoinApi = Pick<DesktopApi, 'addWatchedChannel' | 'getWatchedChannels'> & ChatTabApi
let joins: Promise<void> = Promise.resolve()
const pending = new Map<string, Promise<void>>()

/** Joining from Following must update both persisted tabs and frontend selection. */
export function joinFollowedChannel(api: JoinApi, login: string): Promise<void> {
  const key = login.trim().toLowerCase()
  if (!/^[a-z0-9_]{1,25}$/.test(key))
    return Promise.reject(new Error('A valid Twitch channel name is required.'))
  const current = pending.get(key)
  if (current) return current
  const request = joins
    .catch(() => {})
    .then(async () => {
      const existing = watchedChannelsStore
        .get()
        .find(
          (channel) => channel.platform === 'twitch' && channel.channelSlug.toLowerCase() === key,
        )
      const channel =
        existing ?? (await api.addWatchedChannel({ platform: 'twitch', channelSlug: key }))
      watchedChannelsStore.set(await api.getWatchedChannels())
      const tabId = await openChannelChatTab({ api }, channel)
      clearTabUnread(tabId)
      activeWatchedTabStore.set(tabId)
      setMainTab('chat')
    })
    .finally(() => pending.delete(key))
  joins = request
  pending.set(key, request)
  return request
}
