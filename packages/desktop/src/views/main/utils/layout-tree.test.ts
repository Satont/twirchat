import { describe, test, expect } from 'bun:test'
import {
  findNodeById,
  findParentOfNode,
  getAllPanels,
  countPanels,
  validateTree,
  normalizeFlex,
  canAddPanel,
} from './layout-tree'
import type { LayoutNode, PanelNode, SplitNode } from '@twirchat/shared/types'

describe('layout-tree', () => {
  const createTestTree = (): LayoutNode => ({
    type: 'split',
    id: 'root',
    direction: 'horizontal',
    flex: 100,
    children: [
      {
        type: 'panel',
        id: 'panel-1',
        content: { type: 'main' },
        flex: 50,
      },
      {
        type: 'split',
        id: 'split-1',
        direction: 'vertical',
        flex: 50,
        children: [
          {
            type: 'panel',
            id: 'panel-2',
            content: { type: 'watched', channelId: 'ch1' },
            flex: 50,
          },
          {
            type: 'panel',
            id: 'panel-3',
            content: { type: 'empty' },
            flex: 50,
          },
        ],
      },
    ],
  })

  test('findNodeById finds existing node', () => {
    const tree = createTestTree()
    const found = findNodeById(tree, 'panel-2')
    expect(found).not.toBeNull()
    expect(found?.id).toBe('panel-2')
  })

  test('findNodeById returns null for non-existent', () => {
    const tree = createTestTree()
    const found = findNodeById(tree, 'non-existent')
    expect(found).toBeNull()
  })

  test('findParentOfNode finds correct parent', () => {
    const tree = createTestTree()
    const parent = findParentOfNode(tree, 'panel-2')
    expect(parent).not.toBeNull()
    expect(parent?.id).toBe('split-1')
  })

  test('getAllPanels returns all panels', () => {
    const tree = createTestTree()
    const panels = getAllPanels(tree)
    expect(panels).toHaveLength(3)
    expect(panels.map((p) => p.id)).toContain('panel-1')
    expect(panels.map((p) => p.id)).toContain('panel-2')
    expect(panels.map((p) => p.id)).toContain('panel-3')
  })

  test('countPanels returns correct count', () => {
    const tree = createTestTree()
    expect(countPanels(tree)).toBe(3)
  })

  test('validateTree returns valid for good tree', () => {
    const tree = createTestTree()
    const result = validateTree(tree)
    expect(result.valid).toBe(true)
  })

  test('validateTree detects duplicate IDs', () => {
    const tree: SplitNode = {
      type: 'split',
      id: 'root',
      direction: 'horizontal',
      flex: 100,
      children: [
        { type: 'panel', id: 'same', content: { type: 'main' }, flex: 50 },
        { type: 'panel', id: 'same', content: { type: 'empty' }, flex: 50 },
      ],
    }
    const result = validateTree(tree)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Duplicate')
  })

  test('normalizeFlex balances children', () => {
    const split: SplitNode = {
      type: 'split',
      id: 'test',
      direction: 'horizontal',
      flex: 100,
      children: [
        { type: 'panel', id: 'a', content: { type: 'main' }, flex: 30 },
        { type: 'panel', id: 'b', content: { type: 'empty' }, flex: 30 },
        { type: 'panel', id: 'c', content: { type: 'empty' }, flex: 30 },
      ],
    }
    normalizeFlex(split)
    expect(split.children[0]!.flex).toBeCloseTo(33.33, 1)
    expect(split.children[1]!.flex).toBeCloseTo(33.33, 1)
    expect(split.children[2]!.flex).toBeCloseTo(33.33, 1)
  })

  test('canAddPanel respects limit', () => {
    const tree: PanelNode = {
      type: 'panel',
      id: 'single',
      content: { type: 'main' },
      flex: 100,
    }
    expect(canAddPanel(tree, 8)).toBe(true)
    expect(canAddPanel(tree, 1)).toBe(false)
  })
})
