import { runInBackground } from '../../services/background-task'
import type { DesktopBackend } from '../backend/server'
import { accountsStore, activeTabStore, activeWatchedTabStore, watchedChannelsStore } from './app'
import { chatWindowsStore } from './chat-windows'
import type { Store } from './create-store'
import { createStore } from './create-store'
import { allPanels, layoutStore } from './layout'
import { persistentResource } from './persistent-resources'
import { windowActivityStore } from './window-activity'

export interface ActivePane {
  tabId: string
  paneId: string
}
export const activePaneStore = persistentResource('activePane', () =>
  createStore<ActivePane | null>(null),
)
export const activePaneByWindowStore = persistentResource('windowActivePanes', () =>
  createStore<Map<string, ActivePane>>(new Map()),
)
export function setActivePane(value: ActivePane, scope = 'main'): void {
  const current = activePaneByWindowStore.get().get(scope)
  if (current?.tabId !== value.tabId || current.paneId !== value.paneId)
    activePaneByWindowStore.modify((entries) => new Map(entries).set(scope, value))
  if (scope === 'main') activePaneStore.set(value)
}
export function getActivePane(scope = 'main'): ActivePane | null {
  return (
    activePaneByWindowStore.get().get(scope) ?? (scope === 'main' ? activePaneStore.get() : null)
  )
}
export function clearWindowActivePane(scope: string): void {
  activePaneByWindowStore.modify((entries) => {
    const next = new Map(entries)
    next.delete(scope)
    return next
  })
  if (scope === 'main') activePaneStore.set(null)
}

/** Keep optional provider presence tied to the channel the user is actually reading. */
export function wireProviderChannelFocus(backend: DesktopBackend): () => void {
  let previous = ''
  const update = () => {
    const windows = chatWindowsStore.get()
    const scope = [...windowActivityStore.get()].find(
      ([id, state]) => state.active && windows.has(id),
    )?.[0]
    const window = scope ? windows.get(scope) : undefined
    const tabId = window?.tabId ?? activeWatchedTabStore.get()
    const active = getActivePane(scope ?? 'main')
    const panels = allPanels(layoutStore.get().get(tabId)?.layout ?? null)
    const panel =
      panels.find((candidate) => `${tabId}:${candidate.id}` === active?.paneId) ?? panels[0]
    const watchedId = panel?.content.type === 'watched' ? panel.content.channelId : tabId
    const watched = watchedChannelsStore.get().find((channel) => channel.id === watchedId)
    const account =
      accountsStore.get().find((candidate) => candidate.platform === 'twitch') ??
      accountsStore.get().find((candidate) => candidate.platform === 'kick')
    const reading =
      windows.size === 0
        ? activeTabStore.get() === 'chat'
        : !!scope &&
          (scope === 'main' ? activeTabStore.get() === 'chat' : window?.reading !== false)
    const ownPane = panel?.content.type === 'main' || (!panel && tabId === 'home')
    const selected = !reading
      ? null
      : ownPane
        ? account
          ? {
              platform: account.platform,
              channelId: account.platformUserId,
              channelSlug: account.username,
            }
          : null
        : watched
          ? {
              platform: watched.platform,
              channelId: watched.channelSlug,
              channelSlug: watched.channelSlug,
            }
          : null
    const signature = JSON.stringify(selected)
    if (signature === previous) return
    previous = signature
    runInBackground(
      backend.api
        .setProviderActiveChannel(selected)
        .catch((error) => console.warn('[providers] active channel:', error)),
      'active-pane background operation failed',
    )
  }
  const stores = [
    accountsStore,
    activeTabStore,
    activeWatchedTabStore,
    watchedChannelsStore,
    layoutStore,
    activePaneStore,
    activePaneByWindowStore,
    chatWindowsStore,
    windowActivityStore,
  ]
  const stops = stores.map((store) => store.subscribe(update))
  update()
  return () => {
    stops.forEach((stop) => stop())
    runInBackground(
      backend.api.setProviderActiveChannel(null).catch(() => {}),
      'active-pane background operation failed',
    )
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    activePane: Store<ActivePane | null>
    windowActivePanes: Store<Map<string, ActivePane>>
  }
}
