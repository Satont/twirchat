import type {
  LayoutNode,
  SplitNode,
  PanelContent,
  PanelNode,
  WatchedChannelsLayout,
  WatchedPaneSource,
} from '@twirchat/shared/types'

import { t } from '../../../gpuix/i18n'
import type { DesktopWatchedChannel } from '../../../watched-channels/plugin-channel-types'

const MIN_FLEX = 0
const MAX_FLEX = 100
const TOTAL_FLEX = 100
export const MAX_FEED_SOURCES = 64

export function findNodeById(root: LayoutNode, id: string): LayoutNode | null {
  if ('id' in root && root.id === id) return root
  if (root.type === 'split' && root.children) {
    for (const child of root.children) {
      const found = findNodeById(child, id)
      if (found) return found
    }
  }
  return null
}

export function findParentOfNode(root: LayoutNode, childId: string): SplitNode | null {
  if (root.type === 'split' && root.children) {
    for (const child of root.children) {
      if ('id' in child && child.id === childId) {
        return root
      }
      const found = findParentOfNode(child, childId)
      if (found) return found
    }
  }
  return null
}

export function getAllPanels(root: LayoutNode): PanelNode[] {
  const panels: PanelNode[] = []
  const traverse = (node: LayoutNode) => {
    if (node.type === 'panel') {
      panels.push(node)
    } else if (node.type === 'split' && node.children) {
      node.children.forEach(traverse)
    }
  }
  traverse(root)
  return panels
}

export function panelWatchedSources(content: PanelContent): readonly WatchedPaneSource[] {
  if (content.type === 'feed') return content.sources
  if (content.type !== 'watched') return []
  const { channelId, accountId } = content
  return [accountId === undefined ? { channelId } : { channelId, accountId }]
}

export function panelContentForSources(sources: WatchedPaneSource[]): PanelContent {
  if (sources.length > 1) return { type: 'feed', sources }
  const first = sources[0]
  return first ? { ...first, type: 'watched' } : { type: 'empty' }
}

export function retainAvailableFeedSources(
  content: PanelContent,
  isAvailable: (id: string) => boolean,
): PanelContent {
  if (content.type !== 'feed') return content
  const sources = content.sources.filter(({ channelId }) => isAvailable(channelId))
  return sources.length === content.sources.length ? content : panelContentForSources(sources)
}

export function layoutChannelNames(
  layout: WatchedChannelsLayout,
  channels: readonly DesktopWatchedChannel[],
): string[] {
  const byId = new Map(channels.map((channel) => [channel.id, channel.displayName]))
  return layoutWatchedSourceIds(getAllPanels(layout.root)).flatMap((id) => byId.get(id) ?? [])
}

export function layoutWatchedSourceIds(panels: readonly PanelNode[]): string[] {
  return [
    ...new Set(
      panels.flatMap((panel) =>
        panelWatchedSources(panel.content).map(({ channelId }) => channelId),
      ),
    ),
  ]
}

export function getAllSplits(root: LayoutNode): SplitNode[] {
  const splits: SplitNode[] = []
  const traverse = (node: LayoutNode) => {
    if (node.type === 'split') {
      splits.push(node)
      if (node.children) {
        node.children.forEach(traverse)
      }
    }
  }
  traverse(root)
  return splits
}

export function countPanels(root: LayoutNode): number {
  let count = 0
  const traverse = (node: LayoutNode) => {
    if (node.type === 'panel') {
      count++
    } else if (node.type === 'split' && node.children) {
      node.children.forEach(traverse)
    }
  }
  traverse(root)
  return count
}

export function getNodePath(root: LayoutNode, targetId: string): number[] | null {
  const findPath = (node: LayoutNode, path: number[]): number[] | null => {
    if ('id' in node && node.id === targetId) {
      return path
    }
    if (node.type === 'split' && node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        if (!child) {
          continue
        }
        const result = findPath(child, [...path, i])
        if (result) return result
      }
    }
    return null
  }
  return findPath(root, [])
}

export function getNodeAtPath(root: LayoutNode, path: number[]): LayoutNode | null {
  let current: LayoutNode = root
  for (const index of path) {
    if (current.type === 'split' && current.children && current.children[index]) {
      current = current.children[index]
    } else {
      return null
    }
  }
  return current
}

export function cloneTree<T extends LayoutNode>(root: T): T {
  return JSON.parse(JSON.stringify(root))
}

export function validateTree(root: LayoutNode): { valid: boolean; error?: string } {
  const ids = new Set<string>()
  const checkDuplicates = (node: LayoutNode): boolean => {
    if ('id' in node) {
      if (ids.has(node.id)) return false
      ids.add(node.id)
    }
    if (node.type === 'split' && node.children) {
      for (const child of node.children) {
        if (!checkDuplicates(child)) return false
      }
    }
    return true
  }

  if (!checkDuplicates(root)) {
    return { valid: false, error: t('misc.layoutTree.duplicateIds') }
  }

  const checkFlex = (node: LayoutNode): boolean => {
    if (node.flex <= MIN_FLEX || node.flex > MAX_FLEX) return false
    if (node.type === 'split' && node.children) {
      for (const child of node.children) {
        if (!checkFlex(child)) return false
      }
    }
    return true
  }

  if (!checkFlex(root)) {
    return { valid: false, error: t('misc.layoutTree.invalidFlex') }
  }

  return { valid: true }
}

export function getTotalFlex(node: SplitNode): number {
  if (!node.children) return 0
  return node.children.reduce((sum, child) => sum + child.flex, 0)
}

export function normalizeFlex(node: SplitNode): void {
  if (!node.children || node.children.length === 0) return
  const total = getTotalFlex(node)
  if (total === 0) {
    const equalFlex = TOTAL_FLEX / node.children.length
    node.children.forEach((child) => (child.flex = equalFlex))
  } else {
    const factor = TOTAL_FLEX / total
    node.children.forEach((child) => (child.flex *= factor))
  }
}

export function hasMainPanel(root: LayoutNode): boolean {
  const panels = getAllPanels(root)
  return panels.some((p) => p.content.type === 'main')
}

export function getMainPanel(root: LayoutNode): PanelNode | null {
  const panels = getAllPanels(root)
  return panels.find((p) => p.content.type === 'main') ?? null
}

export function getWatchedPanels(root: LayoutNode): PanelNode[] {
  const panels = getAllPanels(root)
  return panels.filter((p) => p.content.type === 'watched')
}

export function canAddPanel(root: LayoutNode, maxPanels: number): boolean {
  return countPanels(root) < maxPanels
}
