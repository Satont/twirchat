import type { WatchedChannelsLayout } from '@twirchat/shared/types'

import { runInBackground } from '../../services/background-task'
import { getAllPanels } from '../../views/main/utils/layout-tree'
import type { DesktopWatchedChannel } from '../../watched-channels/plugin-channel-types'
import type { DesktopApi } from '../backend/api'
import { t } from '../i18n'
import { showNotice, watchedChannelsStore } from './app'
import { chatTabsStore } from './chat-tabs'
import { chatWindowsStore } from './chat-windows'
import {
  homePluginChannelsStore,
  observeHomePluginFeed,
  selectedHomePluginChannels,
} from './home-plugin-channels'
import { layoutStore, loadLayout } from './layout'

export interface WatchedReferenceSnapshot {
  ready: boolean
  tabIds: string[]
  layouts: ReadonlyMap<string, WatchedChannelsLayout | null>
  channels: readonly DesktopWatchedChannel[]
  homePluginChannelIds?: readonly string[]
}

export function referencedWatchedChannels(snapshot: WatchedReferenceSnapshot): string[] {
  const known = new Set(snapshot.channels.map((channel) => channel.id))
  const active = new Set<string>()
  let hasMain = false
  for (const id of snapshot.tabIds) {
    const layout = snapshot.layouts.get(id)
    if (!layout) continue
    for (const panel of getAllPanels(layout.root)) {
      if (panel.content.type === 'main') hasMain = true
      if (panel.content.type === 'watched' && known.has(panel.content.channelId))
        active.add(panel.content.channelId)
    }
  }
  if (hasMain && snapshot.homePluginChannelIds?.length)
    for (const channel of selectedHomePluginChannels(
      snapshot.channels,
      snapshot.homePluginChannelIds,
    ))
      active.add(channel.id)
  return [...active].sort()
}

/**
 * Accounts the panes of live layouts chose for themselves, by chat. Closed tabs keep their saved
 * layouts, so only live ones count: a pane that is gone must not keep its account connected.
 */
export function referencedPaneAccounts(
  snapshot: WatchedReferenceSnapshot,
): Record<string, string[]> {
  const known = new Set(snapshot.channels.map((channel) => channel.id))
  const accounts = new Map<string, Set<string>>()
  for (const id of snapshot.tabIds) {
    const layout = snapshot.layouts.get(id)
    if (!layout) continue
    for (const panel of getAllPanels(layout.root)) {
      const content = panel.content
      if (content.type !== 'watched' || !content.accountId || !known.has(content.channelId))
        continue
      const ids = accounts.get(content.channelId) ?? new Set<string>()
      ids.add(content.accountId)
      accounts.set(content.channelId, ids)
    }
  }
  return Object.fromEntries(
    [...accounts]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([id, ids]) => [id, [...ids].toSorted()]),
  )
}

/** Layouts on screen: home and open tabs of the main window, plus detached windows. */
export function liveLayoutTabIds(
  tabs = chatTabsStore.get(),
  windows = chatWindowsStore.get(),
): string[] {
  const scopes = new Set<string>()
  if (windows.has('main')) {
    scopes.add('home')
    for (const id of tabs.value.openIds) scopes.add(id)
  }
  for (const window of windows.values()) if (window.tabId) scopes.add(window.tabId)
  return [...scopes]
}

export function createWatchedSubscriptionController(options: {
  read(): WatchedReferenceSnapshot
  load(tabId: string): Promise<void>
  publish(ids: string[], paneAccounts: Record<string, string[]>): Promise<void>
  failed(error: unknown): void
}) {
  const loading = new Map<string, Promise<void>>()
  let revision = 0
  let stopped = false
  let requested: string | undefined

  async function refresh(): Promise<void> {
    const current = ++revision
    const snapshot = options.read()
    if (stopped || !snapshot.ready) return
    try {
      await Promise.all(
        snapshot.tabIds.map(async (id) => {
          if (snapshot.layouts.has(id)) return
          let task = loading.get(id)
          if (!task) {
            task = options.load(id).finally(() => loading.delete(id))
            loading.set(id, task)
          }
          return task
        }),
      )
      if (stopped || current !== revision) return
      const next = options.read()
      if (!next.ready) return
      const ids = referencedWatchedChannels(next)
      const paneAccounts = referencedPaneAccounts(next)
      const key = JSON.stringify([ids, paneAccounts])
      if (key === requested) return
      requested = key
      await options.publish(ids, paneAccounts)
    } catch (error) {
      if (stopped || current !== revision) return
      requested = undefined
      options.failed(error)
    }
  }
  return {
    refresh,
    stop() {
      stopped = true
      revision++
    },
  }
}

export function wireActiveWatchedChannels(backend: {
  api: Pick<
    DesktopApi,
    | 'setActiveWatchedChannels'
    | 'getWatchedChannelsLayout'
    | 'setWatchedChannelsLayout'
    | 'observePluginChannel'
  >
}): () => void {
  const homeFeed = observeHomePluginFeed((id, listener) =>
    backend.api.observePluginChannel(id, listener),
  )
  const syncHomeFeed = () =>
    homeFeed.sync(
      selectedHomePluginChannels(watchedChannelsStore.get(), homePluginChannelsStore.get().value),
    )
  const controller = createWatchedSubscriptionController({
    read() {
      const tabs = chatTabsStore.get()
      return {
        ready: tabs.loaded,
        tabIds: liveLayoutTabIds(tabs),
        layouts: new Map(
          [...layoutStore.get()]
            .filter(([, state]) => !state.isLoading || state.layout !== null)
            .map(([id, state]) => [id, state.layout]),
        ),
        channels: watchedChannelsStore.get(),
        homePluginChannelIds: homePluginChannelsStore.get().value,
      }
    },
    load: (id) => loadLayout(backend, id),
    publish: (ids, paneAccounts) => backend.api.setActiveWatchedChannels({ ids, paneAccounts }),
    failed: (error) =>
      showNotice('error', t('notices.watchedSubscriptions.updateFailed', { error: String(error) })),
  })
  const refresh = () =>
    runInBackground(controller.refresh(), 'Could not update watched chat connections')
  const off = [
    chatTabsStore.subscribe(refresh),
    chatWindowsStore.subscribe(refresh),
    layoutStore.subscribe(refresh),
    watchedChannelsStore.subscribe(refresh),
    homePluginChannelsStore.subscribe(refresh),
    watchedChannelsStore.subscribe(syncHomeFeed),
    homePluginChannelsStore.subscribe(syncHomeFeed),
  ]
  syncHomeFeed()
  refresh()
  return () => {
    for (const unsubscribe of off) unsubscribe()
    controller.stop()
    homeFeed.stop()
  }
}
