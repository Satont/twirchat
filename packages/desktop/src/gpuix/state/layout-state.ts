import type { LayoutNode, PanelNode, WatchedChannelsLayout } from '@twirchat/shared/types'

import { createStore, type Store } from '../../state/create-store'
import { persistentResource } from '../../state/persistent-resources'

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

declare module '../../state/persistent-resources' {
  interface PersistentResources {
    layouts: Store<Map<string, LayoutState>>
    layoutRevision: Store<number>
  }
}
