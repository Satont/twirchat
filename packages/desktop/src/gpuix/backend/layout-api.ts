import type { LayoutNode, PanelNode } from '@twirchat/shared/types'
import { z } from 'zod'

import { getDb } from '../../store/db'
import { WatchedChannelsLayoutStore } from '../../store/watched-channels-layout-store'
import type { DesktopApi } from './api'

export type LayoutApi = Pick<
  DesktopApi,
  | 'getUiState'
  | 'setUiState'
  | 'getLastSeenVersion'
  | 'setLastSeenVersion'
  | 'getTabChannelIds'
  | 'setTabChannelIds'
  | 'getWatchedChannelsLayout'
  | 'setWatchedChannelsLayout'
  | 'removeWatchedChannelsLayout'
  | 'splitPanel'
  | 'removePanel'
  | 'assignChannelToPanel'
>
const MAX_PANELS = 64

// ── Layout tree surgery (ported from src/bun/index.ts) ─────────────────────

function findNodeById(node: LayoutNode, id: string): PanelNode | null {
  if (node.type === 'panel' && node.id === id) return node
  if (node.type === 'split') {
    for (const child of node.children) {
      const found = findNodeById(child, id)
      if (found) return found
    }
  }
  return null
}

function findParentOfNode(
  root: LayoutNode,
  nodeId: string,
): { node: LayoutNode; children: LayoutNode[] } | null {
  if (root.type === 'split') {
    for (let i = 0; i < root.children.length; i++) {
      const child = root.children[i]
      if (!child) continue
      if (child.id === nodeId) {
        return { node: root, children: root.children }
      }
      const found = findParentOfNode(child, nodeId)
      if (found) return found
    }
  }
  return null
}

function countPanels(node: LayoutNode): number {
  if (node.type === 'panel') return 1
  return node.children.reduce((sum, child) => sum + countPanels(child), 0)
}

const LAST_SEEN_VERSION_KEY = 'gpuix_last_seen_version'

function readSetting(key: string): string | null {
  const row = getDb()
    .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
    .get(key)
  return row?.value ?? null
}

function writeSetting(key: string, value: string): void {
  getDb().run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  )
}

export function readUiState(key: string): string | null {
  return readSetting(`gpuix_ui_${key}`)
}

export function getLastSeenVersion(): string | null {
  return readSetting(LAST_SEEN_VERSION_KEY)
}

export function setLastSeenVersion(version: string): void {
  writeSetting(LAST_SEEN_VERSION_KEY, version)
}

export function createLayoutApi(onUiStateSaved?: (key: string, value: string) => void): LayoutApi {
  return {
    getUiState: async ({ key }) => readUiState(key),

    setUiState: async ({ key, value }) => {
      writeSetting(`gpuix_ui_${key}`, value)
      onUiStateSaved?.(key, value)
    },

    getLastSeenVersion: async () => getLastSeenVersion(),

    setLastSeenVersion: async ({ version }) => setLastSeenVersion(version),

    getTabChannelIds: async () => {
      const db = getDb()
      const row = db
        .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
        .get('tab_channel_ids')
      if (!row) return null
      try {
        return z.array(z.string()).parse(JSON.parse(row.value))
      } catch {
        return null
      }
    },

    setTabChannelIds: async ({ ids }) => {
      const db = getDb()
      db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['tab_channel_ids', JSON.stringify(ids)],
      )
    },

    getWatchedChannelsLayout: async ({ tabId }) => {
      return WatchedChannelsLayoutStore.get(tabId)
    },

    setWatchedChannelsLayout: async ({ tabId, layout }) => {
      WatchedChannelsLayoutStore.set(tabId, layout)
    },

    removeWatchedChannelsLayout: async ({ tabId }) => {
      WatchedChannelsLayoutStore.remove(tabId)
    },

    splitPanel: async ({ tabId, panelId, direction }) => {
      const layout = WatchedChannelsLayoutStore.get(tabId)

      if (countPanels(layout.root) >= MAX_PANELS) {
        throw new Error(`Maximum panel limit reached (${MAX_PANELS})`)
      }

      const panel = findNodeById(layout.root, panelId)
      if (!panel || panel.type !== 'panel') {
        throw new Error('Panel not found')
      }

      const newPanel: PanelNode = {
        type: 'panel',
        id: crypto.randomUUID(),
        content: { type: 'empty' },
        flex: 50,
      }

      const parent = findParentOfNode(layout.root, panelId)
      if (parent && parent.node.type === 'split' && parent.node.direction === direction) {
        const index = parent.children.findIndex((c) => c.id === panelId)
        parent.children.splice(index + 1, 0, newPanel)
        newPanel.flex = panel.flex / 2
        panel.flex /= 2
      } else {
        const newSplit: LayoutNode = {
          type: 'split',
          id: crypto.randomUUID(),
          direction,
          children: [panel, newPanel],
          flex: panel.flex,
        }
        panel.flex = 50
        if (parent) {
          const index = parent.children.findIndex((c) => c.id === panelId)
          parent.children[index] = newSplit
        } else {
          layout.root = newSplit
        }
      }

      WatchedChannelsLayoutStore.set(tabId, layout)
      return { original: panel, newPanel }
    },

    removePanel: async ({ tabId, panelId }) => {
      const layout = WatchedChannelsLayoutStore.get(tabId)

      const parent = findParentOfNode(layout.root, panelId)
      if (!parent) throw new Error('Panel not found')

      const index = parent.children.findIndex((c) => c.id === panelId)
      if (index === -1) throw new Error('Panel not found in parent')

      parent.children.splice(index, 1)

      if (parent.children.length === 1) {
        const onlyChild = parent.children[0]
        if (onlyChild) {
          onlyChild.flex = parent.node.flex
          const grandparent = findParentOfNode(layout.root, parent.node.id)
          if (grandparent) {
            const parentIndex = grandparent.children.findIndex((c) => c.id === parent.node.id)
            if (parentIndex !== -1) {
              grandparent.children[parentIndex] = onlyChild
            }
          } else {
            layout.root = onlyChild
          }
        }
      } else {
        const allocation = parent.children.reduce((total, child) => total + child.flex, 0)
        parent.children.forEach((child) => (child.flex = (child.flex / allocation) * 100))
      }

      WatchedChannelsLayoutStore.set(tabId, layout)
    },

    assignChannelToPanel: async ({ tabId, panelId, channelId }) => {
      const layout = WatchedChannelsLayoutStore.get(tabId)

      const panel = findNodeById(layout.root, panelId)
      if (!panel || panel.type !== 'panel') {
        throw new Error('Panel not found')
      }

      panel.content = channelId ? { type: 'watched', channelId } : { type: 'empty' }

      WatchedChannelsLayoutStore.set(tabId, layout)
    },
  }
}
