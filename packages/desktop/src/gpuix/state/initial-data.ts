import type { Platform, PlatformStatusInfo } from '@twirchat/shared/types'

import { mergeChatMessageSnapshot } from '../../views/main/utils/chat-message-buffer'
import { isPluginWatchedChannel } from '../../watched-channels/plugin-channel-types'
import type { DesktopBackend } from '../backend/server'
import { setLanguage } from '../i18n'
import { accountsStore, savedAccountsStore } from './accounts'
import {
  aliasesLoadedStore,
  aliasesStore,
  appendHomeMessages,
  channelStatusStore,
  hydrateMessageHistory,
  settingsStore,
  startStreamStatusPolling,
  watchedChannelsStore,
  watchedMessagesStore,
  watchedStatusesStore,
} from './app'

// ── Initial data load (port of App.vue loadInitialData) ─────────────────────

export async function loadInitialData(backend: DesktopBackend): Promise<void> {
  try {
    const [accs, saved, aliases, setts, statList, watched] = await Promise.all([
      backend.api.getAccounts(),
      backend.api.getSavedAccounts(),
      backend.api.getUserAliases(),
      backend.api.getSettings(),
      backend.api.getStatuses(),
      backend.api.getWatchedChannels(),
    ])
    accountsStore.set(accs)
    savedAccountsStore.set(saved)
    aliasesStore.set(aliases)
    aliasesLoadedStore.set(true)
    settingsStore.set(setts)
    setLanguage(setts.language)
    const statusMap: Partial<Record<Platform, PlatformStatusInfo>> = {}
    for (const s of statList) statusMap[s.platform] = s
    channelStatusStore.set(statusMap)
    watchedChannelsStore.set(watched)

    const [{ initializeChatTabs }, { loadHomePluginChannels }] = await Promise.all([
      import('./chat-tabs'),
      import('./home-plugin-channels'),
    ])
    await Promise.all([initializeChatTabs(backend), loadHomePluginChannels(backend.api)])

    try {
      const watchedStats = await backend.api.getWatchedChannelStatuses()
      watchedStatusesStore.modify((current) => {
        const next = new Map(current)
        for (const { channelId, status } of watchedStats) next.set(channelId, status)
        return next
      })
    } catch {
      // not fatal
    }
  } catch (error) {
    console.warn('[state] Initial data load failed, retrying in 1s...', error)
    setTimeout(() => void loadInitialData(backend), 1000)
    return
  }

  try {
    const recent = await backend.api.getRecentMessages({})
    if (recent.length > 0) {
      hydrateMessageHistory(recent)
      appendHomeMessages(recent)
    }
  } catch (error) {
    console.warn('[state] Failed to load recent messages:', error)
  }

  for (const ch of watchedChannelsStore.get()) {
    if (isPluginWatchedChannel(ch)) continue
    try {
      const msgs = await backend.api.getWatchedChannelMessages({ id: ch.id })
      if (msgs.length > 0) {
        hydrateMessageHistory(msgs)
        watchedMessagesStore.modify((current) => {
          const next = new Map(current)
          next.set(ch.id, mergeChatMessageSnapshot(next.get(ch.id) ?? [], msgs, 200))
          return next
        })
      }
    } catch {
      // not fatal
    }
  }

  startStreamStatusPolling(backend)
}
