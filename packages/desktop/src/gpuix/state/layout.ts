import type {
  LayoutNode,
  PanelNode,
  SplitDirection,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'

import { runInBackground } from '../../services/background-task'
import type { DesktopApi } from '../backend/api'
import { setActivePane } from './active-pane'
import { activateChatSearchWindow, chatWindowsStore, isMainChatWindowOpen } from './chat-windows'
import { cleanupWindowComposerFocus } from './composer-focus'
/**
 * Per-tab watched-channel layout state (port of stores/layout.ts).
 * Layouts persist through the backend bridge; flex edits save debounced.
 */
import type { Store } from './create-store'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'
type LayoutIOBackend = {
  api: Pick<DesktopApi, 'getWatchedChannelsLayout' | 'setWatchedChannelsLayout'>
}
type LayoutBackend = { api: ChatTabApi & Pick<DesktopApi, 'removePanel'> }
type CloneLayoutBackend = { api: ChatTabApi & Pick<DesktopApi, 'removeWatchedChannelsLayout'> }
import { findNodeById, findParentOfNode } from '../../views/main/utils/layout-tree'
import { t } from '../i18n'
import {
  dockPanel,
  directionalFocusTarget,
  rememberPreferredChildren,
  type FocusDirection,
  type DockSide,
} from '../layout-operations'
import { showNotice, activeWatchedTabStore } from './app'
import { chatRulesPreferences, chatRulesStore } from './chat-rules'
import {
  initializeChatTabs,
  chatTabsStore,
  closeChatTab,
  restoreClosedChatTab,
  createEmptyChatTab,
  rememberClosedSplit,
  consumeClosedSplit,
  type ClosedSplit,
  type ChatTabApi,
} from './chat-tabs'
import { setMainTab } from './settings-session'

const SAVE_DEBOUNCE_MS = 500

export interface LayoutState {
  layout: WatchedChannelsLayout | null
  isLoading: boolean
  error: string | null
}

/** tabId → layout state */
export const layoutStore = persistentResource('layouts', () =>
  createStore<Map<string, LayoutState>>(new Map()),
)
/**
 * Bumped after every layout MUTATION (split/remove/assign). GPUI sometimes
 * fails to paint a freshly mounted pane subtree inside an already painted
 * tree; keying the pane tree by this revision forces a clean remount.
 */
export const layoutRevisionStore = persistentResource('layoutRevision', () =>
  createStore<number>(0),
)

interface ResizePatch {
  childIds: string[]
  flexes: number[]
}
interface PersistenceState {
  revision: number
  loadGeneration: number
  dirty: boolean
  needsRefresh: boolean
  patches: Map<string, ResizePatch>
  tail: Promise<void>
}
const runtime = globalThis
const persistenceRuntime = (runtime.__twirchatLayoutPersistence ??= {
  timers: new Map(),
  tabs: new Map(),
})
const saveTimers = persistenceRuntime.timers
const persistence = persistenceRuntime.tabs

function persistenceFor(tabId: string): PersistenceState {
  let state = persistence.get(tabId)
  if (!state) {
    state = {
      revision: 0,
      loadGeneration: 0,
      dirty: false,
      needsRefresh: false,
      patches: new Map(),
      tail: Promise.resolve(),
    }
    persistence.set(tabId, state)
  }
  return state
}

function cancelSaveTimer(tabId: string): void {
  const timer = saveTimers.get(tabId)
  if (timer) clearTimeout(timer)
  saveTimers.delete(tabId)
}

/** Reads and structural mutations share the write queue for their tab. */
function serialize(
  tabId: string,
  operation: (state: PersistenceState) => Promise<void>,
): Promise<void> {
  const state = persistenceFor(tabId)
  const result = state.tail.then(() => operation(state))
  const tail = result.catch(() => {})
  state.tail = tail
  runInBackground(
    tail.then(() => {
      if (state.tail === tail && !state.dirty && !state.needsRefresh && !saveTimers.has(tabId))
        persistence.delete(tabId)
    }),
    'layout background operation failed',
  )
  return result
}

function publish(tabId: string, layout: WatchedChannelsLayout | null): void {
  layoutStore.modify((current) =>
    new Map(current).set(tabId, { layout, isLoading: false, error: null }),
  )
}

/** Preserve resizes made while a structural request was awaiting its response. */
function rebaseResizes(
  layout: WatchedChannelsLayout,
  patches: Map<string, ResizePatch>,
): WatchedChannelsLayout {
  const next = structuredClone(layout)
  for (const [splitId, patch] of patches) {
    const split = findNodeById(next.root, splitId)
    if (split?.type !== 'split') continue
    const desired = new Map(
      patch.childIds.flatMap((id, index) => {
        const flex = patch.flexes[index]
        return flex === undefined ? [] : [[id, flex] satisfies [string, number]]
      }),
    )
    const retained = split.children.filter((child) => desired.has(child.id))
    const allocation = retained.reduce((total, child) => total + child.flex, 0)
    const weights = retained.reduce((total, child) => total + (desired.get(child.id) ?? 0), 0)
    if (weights <= 0) continue
    for (const child of retained) child.flex = (allocation * (desired.get(child.id) ?? 0)) / weights
  }
  return next
}

async function readLayout(
  backend: LayoutIOBackend,
  tabId: string,
  state: PersistenceState,
): Promise<void> {
  const revision = state.revision
  const previous = layoutStore.get().get(tabId)?.layout
  const saved = await backend.api.getWatchedChannelsLayout({ tabId })
  if (state.needsRefresh) {
    if (!saved) throw new Error(t('notices.layout.updatedLayoutUnavailable'))
    publish(tabId, rebaseResizes(saved, state.patches))
    state.needsRefresh = false
  } else if (state.revision === revision && layoutStore.get().get(tabId)?.layout === previous) {
    publish(tabId, saved)
  } else {
    // A resize or a newer layout arrived while this read was in flight.
    layoutStore.modify((current) => {
      const entry = current.get(tabId)
      return entry ? new Map(current).set(tabId, { ...entry, isLoading: false }) : current
    })
  }
}

async function flushDirty(
  backend: LayoutIOBackend,
  tabId: string,
  state: PersistenceState,
): Promise<void> {
  if (state.needsRefresh) await readLayout(backend, tabId, state)
  while (state.dirty) {
    const layout = layoutStore.get().get(tabId)?.layout
    if (!layout) return
    const revision = state.revision
    // A backend implementation must not observe a subsequently mutated tree.
    await backend.api.setWatchedChannelsLayout({ tabId, layout: structuredClone(layout) })
    if (state.revision === revision) {
      state.dirty = false
      state.patches.clear()
      cancelSaveTimer(tabId)
    }
  }
}

function recordReadError(tabId: string, error: unknown): void {
  layoutStore.modify((current) =>
    new Map(current).set(tabId, {
      layout: current.get(tabId)?.layout ?? null,
      isLoading: false,
      error: String(error),
    }),
  )
}

export async function loadLayout(backend: LayoutIOBackend, tabId: string): Promise<void> {
  cancelSaveTimer(tabId)
  const generation = ++persistenceFor(tabId).loadGeneration
  await serialize(tabId, async (state) => {
    if (state.loadGeneration !== generation) return
    layoutStore.modify((current) =>
      new Map(current).set(tabId, {
        layout: current.get(tabId)?.layout ?? null,
        isLoading: true,
        error: null,
      }),
    )
    try {
      await flushDirty(backend, tabId, state)
      await readLayout(backend, tabId, state)
      await flushDirty(backend, tabId, state)
    } catch (error) {
      recordReadError(tabId, error)
    }
  })
}

export function saveLayoutNow(backend: LayoutIOBackend, tabId: string): Promise<void> {
  cancelSaveTimer(tabId)
  const state = persistenceFor(tabId)
  if (!state.dirty && layoutStore.get().get(tabId)?.layout) {
    state.dirty = true
    state.revision++
  }
  return serialize(tabId, (current) => flushDirty(backend, tabId, current))
}

function debouncedSave(backend: LayoutIOBackend, tabId: string): void {
  cancelSaveTimer(tabId)
  saveTimers.set(
    tabId,
    setTimeout(() => {
      saveTimers.delete(tabId)
      runInBackground(
        saveLayoutNow(backend, tabId).catch((error) =>
          showNotice('error', t('notices.layout.saveFailed', { error: String(error) })),
        ),
        'layout background operation failed',
      )
    }, SAVE_DEBOUNCE_MS),
  )
}

async function mutateLayout(
  backend: LayoutIOBackend,
  tabId: string,
  mutate: () => Promise<unknown>,
): Promise<void> {
  cancelSaveTimer(tabId)
  await serialize(tabId, async (state) => {
    await flushDirty(backend, tabId, state)
    // If the response fails after the mutation commits, refresh before any later write.
    state.needsRefresh = true
    await mutate()
    await readLayout(backend, tabId, state)
    await flushDirty(backend, tabId, state)
    layoutRevisionStore.modify((revision) => revision + 1)
  })
}

export async function splitPanel(
  backend: { api: LayoutIOBackend['api'] & Pick<DesktopApi, 'splitPanel'> },
  tabId: string,
  panelId: string,
  direction: SplitDirection,
  scope = 'main',
): Promise<string | undefined> {
  try {
    let newPanelId: string | undefined
    await mutateLayout(backend, tabId, async () => {
      const result = await backend.api.splitPanel({ tabId, panelId, direction })
      newPanelId = result.newPanel.id
    })
    if (newPanelId) requestLayoutPanelFocus(tabId, newPanelId, scope)
    return newPanelId
  } catch (error) {
    showNotice('error', t('notices.layout.splitFailed', { error: String(error) }))
  }
}

function serializeSplitHistory<T>(operation: () => Promise<T>): Promise<T> {
  const next = (runtime.__twirchatSplitHistoryTail ?? Promise.resolve())
    .catch(() => {})
    .then(operation)
  runtime.__twirchatSplitHistoryTail = next
  return next
}
export function removePanel(backend: LayoutBackend, tabId: string, panelId: string): Promise<void> {
  return serializeSplitHistory(async () => {
    try {
      cancelSaveTimer(tabId)
      await serialize(tabId, async (state) => {
        await flushDirty(backend, tabId, state)
        let layout = layoutStore.get().get(tabId)?.layout
        if (!layout) {
          await readLayout(backend, tabId, state)
          layout = layoutStore.get().get(tabId)?.layout
        }
        const panel = layout && findNodeById(layout.root, panelId)
        if (!layout || panel?.type !== 'panel') throw new Error(t('notices.layout.paneClosed'))
        const parent = findParentOfNode(layout.root, panelId)
        if (!parent && tabId === 'home') throw new Error(t('notices.layout.homeNeedsPane'))
        const prefix = `${tabId}:${panelId}`
        const entry: ClosedSplit = {
          id: crypto.randomUUID(),
          tabId,
          panel: structuredClone(panel),
          restorePanelId: crypto.randomUUID(),
          filters: Object.fromEntries(
            Object.entries(chatRulesStore.get().value.paneFilters)
              .filter(([key]) => key === prefix || key.startsWith(`${prefix}:`))
              .map(([key, ids]) => [key.slice(prefix.length), [...ids]]),
          ),
          ...(parent
            ? {
                parent: {
                  id: parent.id,
                  direction: parent.direction,
                  index: parent.children.findIndex((child) => child.id === panelId),
                  flex: parent.flex,
                  siblingIds: parent.children
                    .filter((child) => child.id !== panelId)
                    .map((child) => child.id),
                },
              }
            : {}),
        }
        // Persist recovery data before changing the tree; a failed write must leave the pane open.
        await rememberClosedSplit(backend, entry)
        try {
          if (!parent) await closeChatTab(backend, tabId, true)
          else {
            state.needsRefresh = true
            await backend.api.removePanel({ tabId, panelId })
            await readLayout(backend, tabId, state)
            await flushDirty(backend, tabId, state)
            layoutRevisionStore.modify((revision) => revision + 1)
          }
        } catch (error) {
          // A response may fail after commit. Retain recovery unless the provider confirms the pane is still open.
          try {
            const current = await backend.api.getWatchedChannelsLayout({ tabId })
            if (current && findNodeById(current.root, panelId))
              await consumeClosedSplit(backend, entry.id)
          } catch {
            /* A later retry can resolve an uncertain commit without duplicating the pane. */
          }
          throw error
        }
      })
    } catch (error) {
      showNotice('error', t('notices.layout.closePaneFailed', { error: String(error) }))
    }
  })
}

export function reopenClosedSplit(
  backend: { api: ChatTabApi },
  options: { scope?: string; tabId?: string } = {},
): Promise<{ tabId: string; panelId: string; windowId?: string } | null> {
  return serializeSplitHistory(async () => {
    await initializeChatTabs(backend)
    const entry = chatTabsStore.get().value.closedSplits?.[0]
    if (!entry) return null
    const canonical = (id: string) =>
      isMainChatWindowOpen() && (id === 'home' || chatTabsStore.get().value.openIds.includes(id))
    const owner = (id: string): string | undefined =>
      [...chatWindowsStore.get()].find(
        ([scope, registration]) => scope !== 'main' && registration.tabId === id,
      )?.[0] ?? (canonical(id) ? 'main' : undefined)
    const existingRestoration = [...layoutStore.get()].find(
      ([id, state]) =>
        owner(id) && state.layout && findNodeById(state.layout.root, entry.restorePanelId),
    )?.[0]
    let tabId = existingRestoration ?? entry.tabId
    let windowId = owner(tabId)
    if (!windowId) {
      const callerScope = options.scope ?? 'main'
      const callerTab = options.tabId ?? chatWindowsStore.get().get(callerScope)?.tabId
      const validCaller =
        callerTab &&
        (callerScope === 'main'
          ? canonical(callerTab)
          : chatWindowsStore.get().get(callerScope)?.tabId === callerTab)
      if (validCaller && callerTab) {
        tabId = callerTab
        windowId = callerScope
      } else {
        if (callerScope !== 'main') throw new Error(t('notices.layout.chatWindowClosed'))
        if (!(await restoreClosedChatTab(backend, tabId))) tabId = await createEmptyChatTab(backend)
        windowId = 'main'
      }
    }
    let restoredId = entry.restorePanelId
    await mutateLayout(backend, tabId, async () => {
      let layout = layoutStore.get().get(tabId)?.layout
      if (!layout) layout = await backend.api.getWatchedChannelsLayout({ tabId })
      if (!layout) throw new Error(t('notices.layout.targetLayoutUnavailable'))
      const existing =
        findNodeById(layout.root, entry.restorePanelId) ?? findNodeById(layout.root, entry.panel.id)
      if (existing?.type === 'panel') {
        restoredId = existing.id
        return
      }
      const next = structuredClone(layout)
      const panel = { ...structuredClone(entry.panel), id: entry.restorePanelId }
      const parent = entry.parent && findNodeById(next.root, entry.parent.id)
      if (parent?.type === 'split' && parent.direction === entry.parent?.direction) {
        const remaining = parent.children.reduce((total, child) => total + child.flex, 0)
        const allocation = Math.min(95, Math.max(5, panel.flex))
        for (const child of parent.children)
          child.flex = (child.flex / remaining) * (100 - allocation)
        panel.flex = allocation
        parent.children.splice(Math.min(entry.parent.index, parent.children.length), 0, panel)
      } else {
        const sibling = entry.parent?.siblingIds
          .map((id) => findNodeById(next.root, id))
          .find(Boolean)
        const target = sibling ?? next.root
        const outer = findParentOfNode(next.root, target.id)
        const split: LayoutNode = {
          type: 'split',
          id:
            entry.parent?.id && !findNodeById(next.root, entry.parent.id)
              ? entry.parent.id
              : crypto.randomUUID(),
          flex: target.flex,
          direction: entry.parent?.direction ?? 'vertical',
          children: [],
        }
        const first = (entry.parent?.index ?? 0) === 0
        panel.flex = Math.min(95, Math.max(5, panel.flex))
        target.flex = 100 - panel.flex
        split.children = first ? [panel, target] : [target, panel]
        if (outer)
          outer.children[outer.children.findIndex((child) => child.id === target.id)] = split
        else if (
          next.root.type === 'panel' &&
          next.root.content.type === 'empty' &&
          tabId !== entry.tabId
        ) {
          panel.flex = 100
          next.root = panel
        } else next.root = split
      }
      await backend.api.setWatchedChannelsLayout({ tabId, layout: next })
    })
    const filters = Object.fromEntries(
      Object.entries(entry.filters).map(([suffix, ids]) => [
        `${tabId}:${restoredId}${suffix}`,
        [...ids],
      ]),
    )
    if (Object.keys(filters).length)
      await chatRulesPreferences.save(backend.api, {
        ...chatRulesStore.get().value,
        paneFilters: { ...chatRulesStore.get().value.paneFilters, ...filters },
      })
    await consumeClosedSplit(backend, entry.id)
    if (windowId === 'main') {
      activeWatchedTabStore.set(tabId)
      setMainTab('chat')
    }
    activateChatSearchWindow(windowId)
    requestLayoutPanelFocus(tabId, restoredId, windowId)
    return {
      tabId,
      panelId: restoredId,
      ...(windowId !== 'main' || options.scope !== undefined ? { windowId } : {}),
    }
  })
}

export async function assignChannel(
  backend: { api: LayoutIOBackend['api'] & Pick<DesktopApi, 'assignChannelToPanel'> },
  tabId: string,
  panelId: string,
  channelId: string | null,
): Promise<void> {
  try {
    await mutateLayout(backend, tabId, () =>
      backend.api.assignChannelToPanel({ tabId, panelId, channelId }),
    )
  } catch (error) {
    showNotice('error', t('notices.layout.assignFailed', { error: String(error) }))
    throw error
  }
}

/** Chooses the saved account one pane sends with; `null` follows the chat's account again. */
export function setPanelAccount(
  backend: { api: LayoutIOBackend['api'] & Pick<DesktopApi, 'setPanelAccount'> },
  tabId: string,
  panelId: string,
  accountId: string | null,
): Promise<void> {
  return mutateLayout(backend, tabId, () =>
    backend.api.setPanelAccount({ tabId, panelId, accountId }),
  )
}

export function restoreHomePanel(
  backend: LayoutIOBackend,
  panelId: string,
  channelId: string,
): Promise<void> {
  return mutateLayout(backend, 'home', async () => {
    const current = layoutStore.get().get('home')?.layout
    if (!current) throw new Error(t('notices.layout.homeLayoutUnavailable'))
    const layout = structuredClone(current)
    const panel = findNodeById(layout.root, panelId)
    if (
      panel?.type !== 'panel' ||
      panel.content.type !== 'watched' ||
      panel.content.channelId !== channelId
    )
      throw new Error(t('notices.layout.paneChannelMismatch'))
    panel.content = { type: 'main' }
    await backend.api.setWatchedChannelsLayout({ tabId: 'home', layout })
  })
}

/** Update the flex values of a split's children (drag resize), debounce-save. */
export function updateSplitFlexes(
  backend: LayoutIOBackend,
  tabId: string,
  splitNodeId: string,
  flexes: number[],
): void {
  const current = layoutStore.get().get(tabId)
  if (!current?.layout) return
  const layout = structuredClone(current.layout)
  const split = findNodeById(layout.root, splitNodeId)
  if (
    split?.type !== 'split' ||
    split.children.length !== flexes.length ||
    flexes.some((value) => !Number.isFinite(value) || value <= 0 || value > 100)
  )
    return
  if (split.children.every((child, index) => child.flex === flexes[index])) return
  split.children.forEach((child, index) => {
    const flex = flexes[index]
    if (flex !== undefined) child.flex = flex
  })
  if (layout.meta) layout.meta.updatedAt = Date.now()
  const state = persistenceFor(tabId)
  state.revision++
  state.dirty = true
  state.patches.set(splitNodeId, {
    childIds: split.children.map((child) => child.id),
    flexes: [...flexes],
  })
  layoutStore.modify((states) => new Map(states).set(tabId, { ...current, layout }))
  debouncedSave(backend, tabId)
}

export function allPanels(layout: WatchedChannelsLayout | null): PanelNode[] {
  if (!layout) return []
  const panels: PanelNode[] = []
  const traverse = (node: LayoutNode) => {
    if (node.type === 'panel') panels.push(node)
    else if (node.type === 'split') node.children.forEach(traverse)
  }
  traverse(layout.root)
  return panels
}

export async function dockLayoutPanel(
  backend: LayoutIOBackend,
  tabId: string,
  sourceId: string,
  targetId: string,
  side: DockSide,
): Promise<void> {
  await mutateLayout(backend, tabId, async () => {
    const current = layoutStore.get().get(tabId)?.layout
    if (!current) return
    const root = dockPanel(current.root, sourceId, targetId, side)
    if (root) await backend.api.setWatchedChannelsLayout({ tabId, layout: { ...current, root } })
  })
}

const focusRuntime = globalThis
const focusState = (focusRuntime.__twirchatLayoutFocus ??= {
  callbacks: new Map(),
  preferred: new Map(),
  pending: new Map(),
})
const focusCallbacks = focusState.callbacks
const preferredFocus = focusState.preferred
const pendingFocus = focusState.pending
const focusKey = (tabId: string, scope: string) => JSON.stringify([scope, tabId])
export function registerLayoutPanelFocus(
  tabId: string,
  panelId: string,
  callback: () => void,
  scope = 'main',
): () => void {
  const key = JSON.stringify([scope, tabId, panelId])
  focusCallbacks.set(key, callback)
  const request = pendingFocus.get(scope)
  if (request?.tabId === tabId && request.panelId === panelId) {
    requestLayoutPanelFocus(tabId, panelId, scope)
  }
  return () => {
    if (focusCallbacks.get(key) === callback) focusCallbacks.delete(key)
  }
}
/** The latest request for each window survives tab activation and pane remounts. */
export function requestLayoutPanelFocus(tabId: string, panelId: string, scope = 'main'): boolean {
  const panel = layoutStore.get().get(tabId)?.layout?.root
  if (panel && findNodeById(panel, panelId)?.type === 'panel')
    setActivePane({ tabId, paneId: `${tabId}:${panelId}` }, scope)
  const callback = focusCallbacks.get(JSON.stringify([scope, tabId, panelId]))
  if (callback) {
    pendingFocus.delete(scope)
    rememberLayoutPanelFocus(tabId, panelId, scope)
    callback()
    return true
  }
  pendingFocus.set(scope, { tabId, panelId })
  return false
}
export function cleanupWindowLayoutFocus(scope: string): void {
  pendingFocus.delete(scope)
  for (const key of focusCallbacks.keys())
    if (JSON.parse(key)[0] === scope) focusCallbacks.delete(key)
  for (const key of preferredFocus.keys())
    if (JSON.parse(key)[0] === scope) preferredFocus.delete(key)
  cleanupWindowComposerFocus(scope)
}
export function rememberLayoutPanelFocus(tabId: string, panelId: string, scope = 'main'): void {
  const layout = layoutStore.get().get(tabId)?.layout
  if (!layout) return
  const key = focusKey(tabId, scope)
  const preferred = preferredFocus.get(key) ?? new Map<string, string>()
  rememberPreferredChildren(layout.root, panelId, preferred)
  preferredFocus.set(key, preferred)
}
export function focusLayoutPanel(
  _backend: LayoutBackend | undefined,
  tabId: string,
  panelId: string,
  direction: FocusDirection,
  scope = 'main',
): string | null {
  const layout = layoutStore.get().get(tabId)?.layout
  if (!layout) return null
  rememberLayoutPanelFocus(tabId, panelId, scope)
  const target = directionalFocusTarget(
    layout.root,
    panelId,
    direction,
    preferredFocus.get(focusKey(tabId, scope)),
  )
  if (!target) return null
  rememberLayoutPanelFocus(tabId, target, scope)
  requestLayoutPanelFocus(tabId, target, scope)
  return target
}

/** A detached window owns a standalone layout, without creating a main-window tab. */
export async function cloneLayoutForWindow(
  backend: CloneLayoutBackend,
  sourceTabId: string,
  sourcePanelId?: string,
): Promise<{ tabId: string; layout: WatchedChannelsLayout }> {
  cancelSaveTimer(sourceTabId)
  let result: { tabId: string; layout: WatchedChannelsLayout } | undefined
  await serialize(sourceTabId, async (state) => {
    await flushDirty(backend, sourceTabId, state)
    const source =
      layoutStore.get().get(sourceTabId)?.layout ??
      (await backend.api.getWatchedChannelsLayout({ tabId: sourceTabId }))
    if (!source) throw new Error(t('notices.layout.sourceLayoutUnavailable'))
    const subtree = sourcePanelId ? findNodeById(source.root, sourcePanelId) : source.root
    if (!subtree) throw new Error(t('notices.layout.sourcePaneClosed'))
    const root = structuredClone(subtree)
    const mapping = new Map<string, string>()
    const clone = (node: LayoutNode) => {
      const oldId = node.id
      node.id = crypto.randomUUID()
      if (node.type === 'panel') mapping.set(oldId, node.id)
      else node.children.forEach(clone)
    }
    clone(root)
    root.flex = 100
    const tabId = `window:${crypto.randomUUID()}`
    const layout: WatchedChannelsLayout = {
      version: 2,
      root,
      meta: { createdAt: Date.now(), updatedAt: Date.now() },
    }
    const filters: Record<string, string[]> = {}
    for (const [oldId, newId] of mapping) {
      const prefix = `${sourceTabId}:${oldId}`
      for (const [key, ids] of Object.entries(chatRulesStore.get().value.paneFilters)) {
        if (key === prefix || key.startsWith(`${prefix}:`))
          filters[`${tabId}:${newId}${key.slice(prefix.length)}`] = [...ids]
      }
    }
    try {
      await backend.api.setWatchedChannelsLayout({ tabId, layout })
      if (Object.keys(filters).length)
        await chatRulesPreferences.save(backend.api, {
          ...chatRulesStore.get().value,
          paneFilters: { ...chatRulesStore.get().value.paneFilters, ...filters },
        })
    } catch (error) {
      await backend.api.removeWatchedChannelsLayout({ tabId }).catch(() => {})
      if (Object.keys(filters).length) {
        const rules = chatRulesStore.get().value
        const paneFilters = Object.fromEntries(
          Object.entries(rules.paneFilters).filter(([key]) => !key.startsWith(`${tabId}:`)),
        )
        await chatRulesPreferences.save(backend.api, { ...rules, paneFilters }).catch(() => {})
      }
      throw error
    }
    publish(tabId, layout)
    result = { tabId, layout }
  })
  if (!result) throw new Error(t('notices.layout.clonedLayoutFailed'))
  return result
}

declare module './persistent-resources' {
  interface PersistentResources {
    layouts: Store<Map<string, LayoutState>>
    layoutRevision: Store<number>
  }
}

declare global {
  var __twirchatSplitHistoryTail: Promise<unknown> | undefined
  var __twirchatLayoutPersistence:
    | {
        timers: Map<string, ReturnType<typeof setTimeout>>
        tabs: Map<string, PersistenceState>
      }
    | undefined
  var __twirchatLayoutFocus:
    | {
        callbacks: Map<string, () => void>
        preferred: Map<string, Map<string, string>>
        pending: Map<string, { tabId: string; panelId: string }>
      }
    | undefined
}
