/**
 * Per-tab watched-channel layout state (port of stores/layout.ts).
 * Layouts persist through the backend bridge; flex edits save debounced.
 */

import type {
  LayoutNode,
  PanelNode,
  SplitDirection,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'

import { createStore } from './create-store'
import type { DesktopBackend } from '../backend/server'

const SAVE_DEBOUNCE_MS = 500

export interface LayoutState {
  layout: WatchedChannelsLayout | null
  isLoading: boolean
  error: string | null
}

/** tabId → layout state */
export const layoutStore = createStore<Map<string, LayoutState>>(new Map())

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function patchLayout(
  tabId: string,
  updater: (layout: WatchedChannelsLayout) => WatchedChannelsLayout | null,
): void {
  layoutStore.set((current) => {
    const entry = current.get(tabId)
    if (!entry?.layout) return current
    const next = updater(structuredClone(entry.layout))
    if (!next) return current
    return new Map(current).set(tabId, { ...entry, layout: next })
  })
}

export async function loadLayout(backend: DesktopBackend, tabId: string): Promise<void> {
  layoutStore.set((current) =>
    new Map(current).set(tabId, {
      layout: current.get(tabId)?.layout ?? null,
      isLoading: true,
      error: null,
    }),
  )
  try {
    const saved = await backend.api.getWatchedChannelsLayout({ tabId })
    layoutStore.set((current) =>
      new Map(current).set(tabId, { layout: saved ?? null, isLoading: false, error: null }),
    )
  } catch (error) {
    layoutStore.set((current) =>
      new Map(current).set(tabId, { layout: null, isLoading: false, error: String(error) }),
    )
  }
}

export function saveLayoutNow(backend: DesktopBackend, tabId: string): void {
  const layout = layoutStore.get().get(tabId)?.layout
  if (!layout) return
  void backend.api.setWatchedChannelsLayout({ tabId, layout }).catch((error) => {
    console.warn('[layout] save failed:', error)
  })
}

function debouncedSave(backend: DesktopBackend, tabId: string): void {
  const existing = saveTimers.get(tabId)
  if (existing) clearTimeout(existing)
  saveTimers.set(
    tabId,
    setTimeout(() => {
      saveTimers.delete(tabId)
      saveLayoutNow(backend, tabId)
    }, SAVE_DEBOUNCE_MS),
  )
}

export async function splitPanel(
  backend: DesktopBackend,
  tabId: string,
  panelId: string,
  direction: SplitDirection,
): Promise<void> {
  try {
    await backend.api.splitPanel({ tabId, panelId, direction })
    await loadLayout(backend, tabId)
  } catch (error) {
    console.warn('[layout] split failed:', error)
  }
}

export async function removePanel(
  backend: DesktopBackend,
  tabId: string,
  panelId: string,
): Promise<void> {
  try {
    await backend.api.removePanel({ tabId, panelId })
    await loadLayout(backend, tabId)
  } catch (error) {
    console.warn('[layout] remove failed:', error)
  }
}

export async function assignChannel(
  backend: DesktopBackend,
  tabId: string,
  panelId: string,
  channelId: string | null,
): Promise<void> {
  try {
    await backend.api.assignChannelToPanel({ tabId, panelId, channelId })
    await loadLayout(backend, tabId)
  } catch (error) {
    console.warn('[layout] assign failed:', error)
  }
}

/** Update the flex values of a split's children (drag resize), debounce-save. */
export function updateSplitFlexes(
  backend: DesktopBackend,
  tabId: string,
  splitNodeId: string,
  flexes: number[],
): void {
  patchLayout(tabId, (layout) => {
    const apply = (node: LayoutNode): boolean => {
      if (node.type === 'split' && node.id === splitNodeId) {
        if (node.children.length !== flexes.length) return true
        node.children.forEach((child, index) => {
          child.flex = flexes[index] ?? child.flex
        })
        return true
      }
      if (node.type === 'split') {
        for (const child of node.children) {
          if (apply(child)) return true
        }
      }
      return false
    }
    apply(layout.root)
    if (layout.meta) layout.meta.updatedAt = Date.now()
    return layout
  })
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
