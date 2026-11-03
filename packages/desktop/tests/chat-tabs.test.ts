import { describe, expect, test } from 'bun:test'

import type { LayoutNode, WatchedChannel, WatchedChannelsLayout } from '@twirchat/shared/types'

import {
  cloneChatTabLayout,
  createChatTabController,
  validateChatTabs,
} from '../src/gpuix/state/chat-tabs'
import { getAllPanels, getAllSplits } from '../src/views/main/utils/layout-tree'
import { required } from './fixture-values'

const channel = (id: string): WatchedChannel => ({
  id,
  platform: 'twitch',
  channelSlug: id,
  displayName: id.toUpperCase(),
  createdAt: 0,
})
const layout = (id: string): WatchedChannelsLayout => ({
  version: 2,
  root: {
    type: 'split',
    id: `split-${id}`,
    direction: 'vertical',
    flex: 100,
    children: [
      { type: 'panel', id: `pane-${id}`, flex: 50, content: { type: 'watched', channelId: id } },
      {
        type: 'panel',
        id: `other-${id}`,
        flex: 50,
        content: { type: 'watched', channelId: 'shared' },
      },
    ],
  },
})
function fixture(options: { ids?: string[] | null; raw?: string | null; count?: number } = {}) {
  const channels = Array.from({ length: options.count ?? 3 }, (_, index) => channel(String(index)))
  const persisted = new Map(channels.map((item) => [item.id, layout(item.id)]))
  const mounted = new Map<string, WatchedChannelsLayout>()
  let raw = options.raw ?? null
  let legacy = options.ids === undefined ? channels.map((item) => item.id) : options.ids
  let published: string[] = []
  let selected = 'home'
  let activeLoads = 0,
    peakLoads = 0
  let failCanonical = false,
    failMirror = false
  let canonicalWrites = 0
  const api = {
    getUiState: async () => raw,
    setUiState: async ({ value }: { value: string }) => {
      if (failCanonical) throw new Error('disk full')
      raw = value
      canonicalWrites++
    },
    getTabChannelIds: async () => legacy,
    setTabChannelIds: async ({ ids }: { ids: string[] }) => {
      if (failMirror) throw new Error('legacy failure')
      legacy = ids
    },
    getWatchedChannelsLayout: async ({ tabId }: { tabId: string }) => {
      activeLoads++
      peakLoads = Math.max(peakLoads, activeLoads)
      await Bun.sleep(1)
      activeLoads--
      return structuredClone(persisted.get(tabId) ?? null)
    },
    setWatchedChannelsLayout: async ({
      tabId,
      layout: value,
    }: {
      tabId: string
      layout: WatchedChannelsLayout
    }) => {
      persisted.set(tabId, structuredClone(value))
    },
  }
  const controller = createChatTabController(api, {
    channels: () => channels,
    activeId: () => selected,
    activate: (id) => {
      selected = id
    },
    publishIds: (ids) => {
      published = ids
    },
    layout: (id) => mounted.get(id) ?? null,
    publishLayout: (id, value) => {
      mounted.set(id, value)
    },
  })
  return {
    controller,
    api,
    channels,
    persisted,
    mounted,
    get raw() {
      return raw
    },
    get ids() {
      return published
    },
    get selected() {
      return selected
    },
    get peakLoads() {
      return peakLoads
    },
    get canonicalWrites() {
      return canonicalWrites
    },
    select: (id: string) => {
      selected = id
    },
    failCanonical: (value: boolean) => {
      failCanonical = value
    },
    failMirror: (value: boolean) => {
      failMirror = value
    },
  }
}

describe('durable chat tabs', () => {
  test('migrates legacy order and hydrates every inactive layout with four concurrent loads', async () => {
    const state = fixture({ ids: ['4', '2', '0', '1', '3', '5'], count: 6 })
    await state.controller.initialize()
    expect(state.ids).toEqual(['4', '2', '0', '1', '3', '5'])
    expect(state.mounted.size).toBe(6)
    expect(state.peakLoads).toBe(4)
    expect(JSON.parse(required(state.raw)).openIds).toEqual(state.ids)
  })
  test('an intentionally empty legacy order stays closed rather than reopening saved subscriptions', async () => {
    const state = fixture({ ids: [] })
    await state.controller.initialize()
    expect(state.ids).toEqual([])
    expect(state.channels).toHaveLength(3)
  })
  test('a corrupt canonical configuration recovers previous channel tabs without blocking app boot', async () => {
    const state = fixture({ raw: '{broken', ids: ['2', '0'] })
    await state.controller.initialize()
    expect(state.ids).toEqual(['2', '0'])
    expect(state.controller.store.get().error).toContain('recovered')
    expect(state.raw).toBe('{broken')
    await state.controller.rename('2', 'Recovered')
    expect(JSON.parse(required(state.raw)).metadata['2'].title).toBe('Recovered')
    expect(state.controller.store.get().error).toBeNull()
  })
  test('close keeps subscriptions and layouts, restores the exact pane identities and original position', async () => {
    const state = fixture()
    await state.controller.initialize()
    state.select('1')
    const before = structuredClone(state.mounted.get('1'))
    await state.controller.close('1')
    expect(state.ids).toEqual(['0', '2'])
    expect(state.selected).toBe('2')
    expect(state.channels).toHaveLength(3)
    expect(state.persisted.get('1')).toEqual(before)
    await state.controller.restore()
    expect(state.ids).toEqual(['0', '1', '2'])
    expect(state.selected).toBe('1')
    expect(state.mounted.get('1')).toEqual(before)
  })
  test('duplicates a split into an independent tab with fresh IDs while retaining real channel assignments', async () => {
    const state = fixture()
    await state.controller.initialize()
    await state.controller.rename('1', 'Moderation')
    await state.controller.color('1', '#1a2B3c')
    const copyId = await state.controller.duplicate('1')
    expect(copyId).not.toBe('1')
    expect(state.ids).toEqual(['0', '1', copyId, '2'])
    const original = required(state.mounted.get('1')),
      copy = required(state.mounted.get(copyId))
    const nodeIds = (root: LayoutNode) =>
      [...getAllPanels(root), ...getAllSplits(root)].map((node) => node.id)
    expect(nodeIds(copy.root).some((id) => nodeIds(original.root).includes(id))).toBe(false)
    expect(getAllPanels(copy.root).map((pane) => pane.content)).toEqual(
      getAllPanels(original.root).map((pane) => pane.content),
    )
    expect(state.controller.store.get().value.metadata[copyId]).toEqual({
      channelId: '1',
      title: 'Moderation',
      color: '#1a2B3c',
      locked: false,
    })
    expect(state.channels).toHaveLength(3)
  })
  test('serialized edits preserve metadata, explicit order and lock protection', async () => {
    const state = fixture()
    await state.controller.initialize()
    await Promise.all([
      state.controller.rename('0', 'Zero'),
      state.controller.color('0', '#ffffff'),
      state.controller.reorder('0', 2),
    ])
    expect(state.ids).toEqual(['1', '2', '0'])
    await state.controller.lock('0', true)
    await expect(state.controller.close('0')).rejects.toThrow('Unlock')
    await expect(state.controller.reorder('0', 0)).rejects.toThrow('Unlock')
    await state.controller.lock('0', false)
    await state.controller.close('0')
    await state.controller.restore()
    expect(state.ids).toEqual(['1', '2', '0'])
    expect(state.controller.store.get().value.metadata['0']).toMatchObject({
      title: 'Zero',
      color: '#ffffff',
      locked: false,
    })
  })
  test('canonical write failures retain current state and can be retried', async () => {
    const state = fixture()
    await state.controller.initialize()
    state.failCanonical(true)
    await expect(state.controller.close('1')).rejects.toThrow('disk full')
    expect(state.ids).toEqual(['0', '1', '2'])
    expect(state.controller.store.get().value.closed).toEqual([])
    state.failCanonical(false)
    await state.controller.close('1')
    expect(state.ids).toEqual(['0', '2'])
  })
  test('canonical state survives a legacy mirror failure and a new controller reload', async () => {
    const state = fixture()
    await state.controller.initialize()
    state.failMirror(true)
    await state.controller.close('1')
    expect(state.ids).toEqual(['0', '2'])
    expect(state.controller.store.get().error).toContain('compatibility')
    const restarted = fixture({ raw: state.raw, ids: ['0', '1', '2'] })
    await restarted.controller.initialize()
    expect(restarted.ids).toEqual(['0', '2'])
    await restarted.controller.restore()
    expect(restarted.ids).toEqual(['0', '1', '2'])
  })
  test('opening a channel selects its existing instance and removes a matching closed-tab entry', async () => {
    const state = fixture()
    await state.controller.initialize()
    const copyId = await state.controller.duplicate('1')
    await state.controller.close('1')
    expect(await state.controller.open(channel('1'))).toBe(copyId)
    expect(state.selected).toBe(copyId)
    await state.controller.close(copyId)
    expect(await state.controller.open(channel('1'))).toBe('1')
    expect(state.controller.store.get().value.closed.some((closed) => closed.id === '1')).toBe(
      false,
    )
    expect(state.ids.filter((id) => id === '1')).toHaveLength(1)
  })
  test('validates metadata and closed histories without trusting malformed restored layouts', () => {
    expect(() => validateChatTabs({ version: 1, openIds: ['home'] })).toThrow('order')
    const value = validateChatTabs({
      version: 1,
      openIds: ['0', '0'],
      metadata: { '0': { title: 'Hi\nthere', color: 'red', locked: true } },
      closed: [
        { id: 'bad', layout: {} },
        { id: '1', index: 1, metadata: { color: '#abcdef' }, layout: layout('1') },
      ],
    })
    expect(value.openIds).toEqual(['0'])
    expect(value.metadata['0']).toEqual({ title: 'Hi there', locked: true })
    expect(value.closed.map((closed) => closed.id)).toEqual(['1'])
    expect(cloneChatTabLayout(layout('0')).root.id).not.toBe('split-0')
  })
})
