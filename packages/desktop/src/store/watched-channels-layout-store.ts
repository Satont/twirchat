import type { LayoutNode, PanelNode, WatchedChannelsLayout } from '@twirchat/shared/types'

import { getDb } from './db'

const MAX_PANELS = 8

function getKey(tabId: string): string {
  return `watched_tab_layout_v2_${tabId}`
}

function countPanels(node: LayoutNode): number {
  if (node.type === 'panel') return 1
  return node.children.reduce((sum, child) => sum + countPanels(child), 0)
}

function createDefaultTabLayout(channelId: string): WatchedChannelsLayout {
  return {
    version: 2,
    root: {
      type: 'panel',
      id: crypto.randomUUID(),
      content: { type: 'watched', channelId },
      flex: 100,
    },
    meta: { createdAt: Date.now(), updatedAt: Date.now() },
  }
}

function sanitizeTabLayout(layout: WatchedChannelsLayout, tabId: string): WatchedChannelsLayout {
  const sanitizeNode = (node: LayoutNode): void => {
    if (node.type === 'panel' && node.content.type === 'main') {
      node.content = { type: 'watched', channelId: tabId }
    } else if (node.type === 'split') {
      node.children.forEach(sanitizeNode)
    }
  }
  sanitizeNode(layout.root)
  // If root is a single empty panel, assign this tab's channel
  if (layout.root.type === 'panel' && layout.root.content.type === 'empty') {
    layout.root.content = { type: 'watched', channelId: tabId }
  }
  return layout
}

function validateLayout(layout: WatchedChannelsLayout): void {
  const panelCount = countPanels(layout.root)
  if (panelCount > MAX_PANELS) {
    throw new Error(`Layout exceeds maximum panel limit of ${MAX_PANELS}`)
  }
}

export const WatchedChannelsLayoutStore = {
  get(tabId: string): WatchedChannelsLayout {
    const db = getDb()
    const row = db
      .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
      .get(getKey(tabId))

    if (!row) {
      const defaultLayout = createDefaultTabLayout(tabId)
      this.set(tabId, defaultLayout)
      return defaultLayout
    }

    try {
      const parsed = JSON.parse(row.value) as WatchedChannelsLayout
      return sanitizeTabLayout(parsed, tabId)
    } catch {
      const defaultLayout = createDefaultTabLayout(tabId)
      this.set(tabId, defaultLayout)
      return defaultLayout
    }
  },

  set(tabId: string, layout: WatchedChannelsLayout): void {
    validateLayout(layout)

    const db = getDb()
    const layoutWithMeta: WatchedChannelsLayout = {
      ...layout,
      meta: {
        createdAt: layout.meta?.createdAt ?? Date.now(),
        ...layout.meta,
        updatedAt: Date.now(),
      },
    }

    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [getKey(tabId), JSON.stringify(layoutWithMeta)],
    )
  },

  remove(tabId: string): void {
    const db = getDb()
    db.run('DELETE FROM settings WHERE key = ?', [getKey(tabId)])
  },

  canAddPanel(tabId: string): boolean {
    const layout = this.get(tabId)
    return countPanels(layout.root) < MAX_PANELS
  },

  cleanupStaleAssignments(tabId: string, removedChannelIds: string[]): void {
    if (removedChannelIds.includes(tabId)) {
      this.remove(tabId)
      return
    }

    const layout = this.get(tabId)
    let changed = false

    const cleanNode = (node: LayoutNode): void => {
      if (node.type === 'panel' && node.content.type === 'watched') {
        if (removedChannelIds.includes(node.content.channelId)) {
          node.content = { type: 'empty' }
          changed = true
        }
      } else if (node.type === 'split') {
        node.children.forEach(cleanNode)
      }
    }

    cleanNode(layout.root)
    if (changed) this.set(tabId, layout)
  },

  getPanelNode(layout: WatchedChannelsLayout, panelId: string): PanelNode | null {
    const find = (node: LayoutNode): PanelNode | null => {
      if (node.type === 'panel' && node.id === panelId) return node
      if (node.type === 'split') {
        for (const child of node.children) {
          const found = find(child)
          if (found) return found
        }
      }
      return null
    }
    return find(layout.root)
  },
}
