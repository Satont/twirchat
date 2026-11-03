import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import { deleteOldestEntry } from '../../services/bounded-cache'
import { filterHomeChatMessages } from '../../views/main/utils/chat-send-targets'
import type { DesktopBackend } from '../backend/server'
import { chatMessageKey } from '../chat-tools'
import { compileMessageRules } from '../message-rules'
import {
  accountsStore,
  activeTabStore,
  activeWatchedTabStore,
  tabChannelIdsStore,
  watchedChannelsStore,
} from './app'
import { chatRulesStore } from './chat-rules'
import type { Store } from './create-store'
import { createStore } from './create-store'
import { allPanels, layoutStore } from './layout'
import { getMessageSimilarity, messageSimilarityStore } from './message-similarity'
import { persistentResource } from './persistent-resources'
import { streamerModeStore } from './streamer-mode'

export interface TabUnread {
  unread: number
  mentions: number
  color?: string
}

export const tabUnreadStore = persistentResource('tabUnread', () =>
  createStore<Map<string, TabUnread>>(new Map()),
)
const clearListeners = new Set<(tabId: string) => void>()

/** Clear both published counts and a burst waiting for the next frame. */
export function clearTabUnread(tabId: string): void {
  for (const listener of clearListeners) listener(tabId)
  tabUnreadStore.modify((current) => {
    if (!current.has(tabId)) return current
    const next = new Map(current)
    next.delete(tabId)
    return next
  })
}

function isVisible(tabId: string): boolean {
  return activeTabStore.get() === 'chat' && activeWatchedTabStore.get() === tabId
}

/** Wire once with the backend singleton; counts survive UI remounts. */
export function wireTabUnread(backend: Pick<DesktopBackend, 'events'>): () => void {
  const pending = new Map<string, TabUnread>()
  const seen = new Map<string, true>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let previousLayouts: ReturnType<typeof layoutStore.get> | undefined
  let previousTabs: string[] | undefined
  let previousWatched: ReturnType<typeof watchedChannelsStore.get> | undefined
  let watchedRoutes = new Map<string, Set<string>>()
  let homeRoutes = new Set(['home'])
  let previousAccounts: Account[] | undefined
  let previousRules = chatRulesStore.get().value
  let ruleEngine = compileMessageRules(previousRules, [])

  const refreshRouting = () => {
    const layouts = layoutStore.get()
    const tabs = tabChannelIdsStore.get()
    const watched = watchedChannelsStore.get()
    if (layouts === previousLayouts && tabs === previousTabs && watched === previousWatched) return
    previousLayouts = layouts
    previousTabs = tabs
    previousWatched = watched
    watchedRoutes = new Map()
    homeRoutes = new Set(['home'])
    const available = new Set(watched.map((channel) => channel.id))
    const add = (channelId: string, tabId: string) => {
      if (!available.has(channelId)) return
      let routes = watchedRoutes.get(channelId)
      if (!routes) {
        routes = new Set()
        watchedRoutes.set(channelId, routes)
      }
      routes.add(tabId)
    }
    for (const tabId of tabs) {
      const layout = layouts.get(tabId)?.layout
      if (!layout) {
        add(tabId, tabId)
        continue
      }
      for (const panel of allPanels(layout)) {
        if (panel.content.type === 'watched') add(panel.content.channelId, tabId)
        else if (panel.content.type === 'main') homeRoutes.add(tabId)
      }
    }
  }

  const flush = () => {
    timer = undefined
    if (pending.size === 0) return
    tabUnreadStore.modify((current) => {
      let next = current
      for (const [tabId, counts] of pending) {
        if (isVisible(tabId)) continue
        if (next === current) next = new Map(current)
        const existing = current.get(tabId)
        next.set(tabId, {
          unread: (existing?.unread ?? 0) + counts.unread,
          mentions: (existing?.mentions ?? 0) + counts.mentions,
          color: counts.color ?? existing?.color,
        })
      }
      return next
    })
    pending.clear()
  }

  const receive = (message: NormalizedChatMessage, tabs: Set<string> | undefined) => {
    if (!tabs?.size || message.type === 'system') return
    const accounts = accountsStore.get()
    if (accounts !== previousAccounts || previousRules !== chatRulesStore.get().value) {
      previousAccounts = accounts
      previousRules = chatRulesStore.get().value
      ruleEngine = compileMessageRules(previousRules, accounts, (message) => ({
        similar: getMessageSimilarity(message)?.similar,
      }))
    }
    const classification = ruleEngine.classify(message)
    if (classification.hidden) return
    const similarity = getMessageSimilarity(message)
    if (similarity?.similar && messageSimilarityStore.get().value.hideSimilar) return
    const streamer = streamerModeStore.get()
    const alertAllowed =
      similarity?.triggerHighlights !== false &&
      !(streamer.effectiveEnabled && streamer.settings.muteMentions)
    const mentioned = classification.mention && alertAllowed
    for (const tabId of tabs) {
      const key = `${tabId}:${chatMessageKey(message)}`
      if (seen.has(key)) continue
      seen.set(key, true)
      if (seen.size > 8000) deleteOldestEntry(seen)
      if (isVisible(tabId)) continue
      const existing = pending.get(tabId)
      pending.set(tabId, {
        unread: (existing?.unread ?? 0) + 1,
        mentions: (existing?.mentions ?? 0) + (mentioned ? 1 : 0),
        color:
          classification.highlighted && alertAllowed
            ? (classification.color ?? '#a78bfa')
            : existing?.color,
      })
    }
    if (pending.size > 0) timer ??= setTimeout(flush, 16)
  }

  const clearPending = (tabId: string) => pending.delete(tabId)
  clearListeners.add(clearPending)
  const clearVisible = () => {
    if (disposed) return
    if (activeTabStore.get() === 'chat') clearTabUnread(activeWatchedTabStore.get())
  }
  const subscriptions = [
    backend.events.on('chat_message', (message) => {
      if (filterHomeChatMessages([message], accountsStore.get()).length === 0) return
      refreshRouting()
      receive(message, homeRoutes)
    }),
    backend.events.on('watched_channel_message', ({ channelId, message }) => {
      refreshRouting()
      receive(message, watchedRoutes.get(channelId))
    }),
    activeTabStore.subscribe(clearVisible),
    activeWatchedTabStore.subscribe(clearVisible),
    tabChannelIdsStore.subscribe(() => {
      if (disposed) return
      const tabs = new Set(['home', ...tabChannelIdsStore.get()])
      for (const tabId of pending.keys()) if (!tabs.has(tabId)) pending.delete(tabId)
      for (const tabId of tabUnreadStore.get().keys()) if (!tabs.has(tabId)) clearTabUnread(tabId)
    }),
  ]
  clearVisible()

  return () => {
    disposed = true
    for (const unsubscribe of subscriptions) unsubscribe()
    clearListeners.delete(clearPending)
    clearTimeout(timer)
    pending.clear()
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    tabUnread: Store<Map<string, TabUnread>>
  }
}
