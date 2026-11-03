import { expect, test } from 'bun:test'

import type { LayoutNode } from '@twirchat/shared/types'

import { dockPanel, dockSideAt, resizedPair } from '../src/gpuix/layout-operations'
import { getAllPanels, validateTree } from '../src/views/main/utils/layout-tree'
import { literal, required } from './fixture-values'

const panel = (id: string, flex: number): LayoutNode => ({
  type: 'panel',
  id,
  flex,
  content: { type: 'watched', channelId: id },
})
const fixture = (): LayoutNode => ({
  type: 'split',
  id: 'root',
  direction: 'vertical',
  flex: 100,
  children: [
    panel('a', 20),
    {
      type: 'split',
      id: 'nested',
      direction: 'horizontal',
      flex: 80,
      children: [panel('b', 25), panel('c', 75)],
    },
  ],
})

test('pane resize uses measured pixel size and preserves neighboring flex totals', () => {
  expect(resizedPair([20, 30, 50], 0, 100, 500)).toEqual([30, 20, 50])
  expect(resizedPair([20, 30, 50], 0, -10000, 500)).toEqual([9, 41, 50])
  expect(resizedPair([50, 50], 0, 100, 0)).toEqual([50, 50])
})
test('docking collapses the old split while preserving its parent allocation and all panes', () => {
  const original = fixture()
  const moved = required(dockPanel(original, 'b', 'a', 'bottom'))
  expect(moved.type).toBe('split')
  if (moved.type === 'split') {
    expect(moved.children.map((child) => child.flex)).toEqual([20, 80])
    expect(moved.children[1]?.id).toBe('c')
  }
  expect(
    getAllPanels(moved)
      .map((pane) => pane.id)
      .sort(),
  ).toEqual(['a', 'b', 'c'])
  expect(validateTree(moved).valid).toBe(true)
  expect(getAllPanels(original).map((pane) => pane.flex)).toEqual([20, 25, 75])
})
test('center docking swaps panes and preserves positional weights', () => {
  const moved = required(dockPanel(fixture(), 'a', 'c', 'center'))
  expect(getAllPanels(moved).map((pane) => [pane.id, pane.flex])).toEqual([
    ['c', 20],
    ['b', 25],
    ['a', 75],
  ])
  expect(dockPanel(fixture(), 'a', 'a', 'left')).toBeNull()
  expect(dockPanel(fixture(), 'missing', 'c', 'left')).toBeNull()
})
test('all docking directions retain unique identities through nested moves', () => {
  for (const side of literal(['left', 'right', 'top', 'bottom', 'center'])) {
    for (const source of ['a', 'b', 'c']) {
      for (const target of ['a', 'b', 'c'].filter((id) => id !== source)) {
        const moved = required(dockPanel(fixture(), source, target, side))
        expect(validateTree(moved)).toEqual({ valid: true })
        expect(new Set(getAllPanels(moved).map((pane) => pane.id)).size).toBe(3)
      }
    }
  }
})
test('drop zones use the closest measured edge and the center swaps panes', () => {
  const bounds = { x: 100, y: 200, width: 400, height: 200 }
  expect(dockSideAt(bounds, 105, 300)).toBe('left')
  expect(dockSideAt(bounds, 495, 300)).toBe('right')
  expect(dockSideAt(bounds, 300, 205)).toBe('top')
  expect(dockSideAt(bounds, 300, 395)).toBe('bottom')
  expect(dockSideAt(bounds, 300, 300)).toBe('center')
})
