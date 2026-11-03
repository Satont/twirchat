import type { LayoutNode } from '@twirchat/shared/types'

import { findNodeById, findParentOfNode } from '../views/main/utils/layout-tree'

export type DockSide = 'left' | 'right' | 'top' | 'bottom' | 'center'
export interface PaneBounds {
  x: number
  y: number
  width: number
  height: number
}

export function dockSideAt(bounds: PaneBounds, x: number, y: number): DockSide {
  const horizontal = (x - bounds.x) / bounds.width
  const vertical = (y - bounds.y) / bounds.height
  const distances = [horizontal, 1 - horizontal, vertical, 1 - vertical]
  const nearest = Math.min(...distances)
  if (nearest >= 0.25) return 'center'
  if (nearest === horizontal) return 'left'
  if (nearest === 1 - horizontal) return 'right'
  if (nearest === vertical) return 'top'
  return 'bottom'
}

/** Resize only the adjacent pair, preserving the rest of the split. */
export function resizedPair(
  flexes: number[],
  index: number,
  deltaPx: number,
  pairPixels: number,
  minimumPixels = 90,
): number[] {
  if (
    !Number.isFinite(pairPixels) ||
    pairPixels <= 0 ||
    !Number.isFinite(deltaPx) ||
    index < 0 ||
    index + 1 >= flexes.length
  )
    return flexes
  const next = [...flexes]
  const total = next[index]! + next[index + 1]!
  const minimum = total * Math.min(minimumPixels / pairPixels, 0.45)
  const left = Math.max(
    minimum,
    Math.min(total - minimum, next[index]! + (total * deltaPx) / pairPixels),
  )
  next[index] = left
  next[index + 1] = total - left
  return next
}

/** Dock an existing pane without losing its identity or channel-specific state. */
export function dockPanel(
  root: LayoutNode,
  sourceId: string,
  targetId: string,
  side: DockSide,
): LayoutNode | null {
  if (sourceId === targetId) return null
  let tree = structuredClone(root)
  const source = findNodeById(tree, sourceId)
  const target = findNodeById(tree, targetId)
  if (source?.type !== 'panel' || target?.type !== 'panel') return null
  function replace(node: LayoutNode, id: string, value: LayoutNode): LayoutNode {
    if (node.id === id) return value
    if (node.type === 'split')
      node.children = node.children.map((child) => replace(child, id, value))
    return node
  }
  if (side === 'center') {
    const movedSource = { ...source, flex: target.flex }
    const movedTarget = { ...target, flex: source.flex }
    // Perform both replacements in one walk so neither newly inserted ID is replaced again.
    const swap = (node: LayoutNode): LayoutNode => {
      if (node.id === sourceId) return movedTarget
      if (node.id === targetId) return movedSource
      if (node.type === 'split') node.children = node.children.map(swap)
      return node
    }
    return swap(tree)
  }
  function remove(node: LayoutNode): LayoutNode | null {
    if (node.id === sourceId) return null
    if (node.type === 'panel') return node
    node.children = node.children.flatMap((child) => {
      const kept = remove(child)
      return kept ? [kept] : []
    })
    if (!node.children.length) return null
    if (node.children.length === 1) return { ...node.children[0]!, flex: node.flex }
    return node
  }
  const remaining = remove(tree)
  if (!remaining) return null
  tree = remaining
  const destination = findNodeById(tree, targetId)
  if (destination?.type !== 'panel') return null
  const direction = side === 'left' || side === 'right' ? 'vertical' : 'horizontal'
  const before = side === 'left' || side === 'top'
  const parent = findParentOfNode(tree, targetId)
  if (parent?.direction === direction) {
    source.flex = destination.flex / 2
    destination.flex /= 2
    const index = parent.children.findIndex((child) => child.id === targetId)
    parent.children.splice(index + (before ? 0 : 1), 0, source)
  } else {
    const flex = destination.flex
    destination.flex = 50
    source.flex = 50
    tree = replace(tree, targetId, {
      type: 'split',
      id: crypto.randomUUID(),
      flex,
      direction,
      children: before ? [source, destination] : [destination, source],
    })
  }
  tree.flex = root.flex
  return tree
}

export type FocusDirection = 'left' | 'right' | 'up' | 'above' | 'down' | 'below'
export function rememberPreferredChildren(
  root: LayoutNode,
  panelId: string,
  preferred: Map<string, string>,
): boolean {
  if (root.id === panelId) return true
  if (root.type !== 'split') return false
  for (const child of root.children) {
    if (rememberPreferredChildren(child, panelId, preferred)) {
      preferred.set(root.id, child.id)
      return true
    }
  }
  return false
}
/** Move to the nearest sibling on the matching split axis; edges never wrap. */
export function directionalFocusTarget(
  root: LayoutNode,
  panelId: string,
  direction: FocusDirection,
  preferred: ReadonlyMap<string, string> = new Map(),
): string | null {
  const horizontal = direction === 'left' || direction === 'right'
  const axis = horizontal ? 'vertical' : 'horizontal'
  const delta = direction === 'left' || direction === 'up' || direction === 'above' ? -1 : 1
  const path: { node: Extract<LayoutNode, { type: 'split' }>; child: number }[] = []
  const find = (node: LayoutNode): boolean => {
    if (node.type === 'panel') return node.id === panelId
    for (let index = 0; index < node.children.length; index++) {
      path.push({ node, child: index })
      if (find(node.children[index]!)) return true
      path.pop()
    }
    return false
  }
  if (!find(root)) return null
  for (const entry of path.reverse()) {
    if (entry.node.direction !== axis) continue
    const sibling = entry.node.children[entry.child + delta]
    if (!sibling) continue
    let node: LayoutNode = sibling
    while (node.type === 'split') {
      const split = node
      const saved: LayoutNode | undefined = split.children.find(
        (child) => child.id === preferred.get(split.id),
      )
      node =
        saved ??
        split.children[split.direction === axis && delta < 0 ? split.children.length - 1 : 0]!
    }
    return node.id
  }
  return null
}
