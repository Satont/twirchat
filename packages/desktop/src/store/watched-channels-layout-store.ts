import type { LayoutNode, PanelNode, WatchedChannelsLayout } from '@twirchat/shared/types'

import { watchedChannelsLayoutSchema } from '../services/persisted-schemas'
import { getAllPanels, retainAvailableFeedSources } from '../views/main/utils/layout-tree'
import { getDb } from './db'
import { PluginWatchedChannelsStore } from './plugin-watched-channels-store'
import { WatchedChannelStore } from './watched-channels-store'

const MAX_PANELS = 64

function getKey(tabId: string): string {
  return `watched_tab_layout_v2_${tabId}`
}

function countPanels(node: LayoutNode): number {
  if (node.type === 'panel') return 1
  return node.children.reduce((sum, child) => sum + countPanels(child), 0)
}

function hasWatchedChannel(id: string): boolean {
  return WatchedChannelStore.findById(id) !== null || PluginWatchedChannelsStore.has(id)
}

export function createDefaultTabLayout(channelId: string): WatchedChannelsLayout {
  return {
    version: 2,
    root: {
      type: 'panel',
      id: crypto.randomUUID(),
      content:
        channelId === 'home'
          ? { type: 'main' }
          : hasWatchedChannel(channelId)
            ? { type: 'watched', channelId }
            : { type: 'empty' },
      flex: 100,
    },
    meta: { createdAt: Date.now(), updatedAt: Date.now() },
  }
}

function sanitizeTabLayout(layout: WatchedChannelsLayout, tabId: string): WatchedChannelsLayout {
  // Only legacy channel-backed tabs inherited their watched channel from the tab ID.
  if (tabId === 'home' || !hasWatchedChannel(tabId)) return layout
  const sanitizeNode = (node: LayoutNode): void => {
    if (node.type === 'panel' && node.content.type === 'main')
      node.content = { type: 'watched', channelId: tabId }
    else if (node.type === 'split') node.children.forEach(sanitizeNode)
  }
  sanitizeNode(layout.root)
  if (layout.root.type === 'panel' && layout.root.content.type === 'empty')
    layout.root.content = { type: 'watched', channelId: tabId }
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
      const parsed = watchedChannelsLayoutSchema.parse(JSON.parse(row.value))
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
    const parsed = watchedChannelsLayoutSchema.parse(layout)
    let channelIds: Set<string> | undefined
    for (const panel of getAllPanels(parsed.root)) {
      if (panel.content.type !== 'feed') continue
      const known = (channelIds ??= new Set(WatchedChannelStore.findAll().map(({ id }) => id)))
      panel.content = retainAvailableFeedSources(panel.content, (id) => known.has(id))
    }
    const layoutWithMeta: WatchedChannelsLayout = {
      ...parsed,
      meta: {
        createdAt: parsed.meta?.createdAt ?? Date.now(),
        ...parsed.meta,
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

  cleanupRemovedChannel(channelId: string): void {
    const prefix = getKey('')
    const keys = getDb()
      .query<{ key: string }, [string]>('SELECT key FROM settings WHERE key GLOB ?')
      .all(`${prefix}*`)
    for (const { key } of keys) {
      const tabId = key.slice(prefix.length)
      const layout = this.get(tabId)
      const panels = getAllPanels(layout.root)
      // A legacy tab can now hold a feed with sources independent of its original ID.
      if (
        tabId === channelId &&
        panels.every(
          ({ content }) =>
            content.type !== 'feed' &&
            (content.type !== 'watched' || content.channelId === channelId),
        )
      ) {
        this.remove(tabId)
        continue
      }
      let changed = false
      for (const panel of panels) {
        const content = panel.content
        panel.content =
          content.type === 'watched' && content.channelId === channelId
            ? { type: 'empty' }
            : retainAvailableFeedSources(content, (id) => id !== channelId)
        changed ||= panel.content !== content
      }
      if (changed) this.set(tabId, layout)
    }
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
