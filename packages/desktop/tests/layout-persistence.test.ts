import { afterEach, expect, test } from 'bun:test'

import type { WatchedChannelsLayout } from '@twirchat/shared/types'

import { noticeStore } from '../src/gpuix/state/app'
import { chatTabsStore } from '../src/gpuix/state/chat-tabs'
import {
  assignChannel,
  dockLayoutPanel,
  layoutStore,
  loadLayout,
  removePanel,
  saveLayoutNow,
  splitPanel,
  updateSplitFlexes,
} from '../src/gpuix/state/layout'
import { findNodeById } from '../src/views/main/utils/layout-tree'
import { literal, required } from './fixture-values'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((stop) => stop()))
  noticeStore.set(null)
})

function deferred<T>() {
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  return { promise, resolve, reject }
}

function fixture() {
  const tabId = crypto.randomUUID()
  let saved: WatchedChannelsLayout = {
    version: 2,
    root: {
      type: 'split',
      id: 'split',
      direction: 'vertical',
      flex: 100,
      children: ['a', 'b'].map((id) => ({
        type: 'panel',
        id,
        flex: 50,
        content: { type: 'watched', channelId: id },
      })),
    },
  }
  const writes: WatchedChannelsLayout[] = []
  const uiState = new Map<string, string>([
    [
      'chat_tabs_v1',
      JSON.stringify({
        version: 1,
        openIds: [tabId],
        metadata: { [tabId]: { locked: false } },
        closed: [],
      }),
    ],
  ])
  chatTabsStore.set({
    value: { version: 1, openIds: [], metadata: {}, closed: [] },
    loaded: false,
    saving: false,
    error: null,
  })
  const api = {
    getUiState: async ({ key }: { key: string }) => uiState.get(key) ?? null,
    setUiState: async ({ key, value }: { key: string; value: string }) => {
      uiState.set(key, value)
    },
    getTabChannelIds: async () => [tabId],
    setTabChannelIds: async () => {},
    getWatchedChannelsLayout: async () => structuredClone(saved),
    setWatchedChannelsLayout: async ({
      layout,
    }: {
      tabId: string
      layout: WatchedChannelsLayout
    }) => {
      writes.push(structuredClone(layout))
      saved = structuredClone(layout)
    },
    splitPanel: async () => {
      if (saved.root.type !== 'split') throw new Error('Expected split')
      saved.root.children.push({ type: 'panel', id: 'c', flex: 20, content: { type: 'empty' } })
      return {
        original: required(saved.root.children[0]),
        newPanel: required(saved.root.children[2]),
      }
    },
    removePanel: async () => {
      if (saved.root.type === 'split')
        saved.root.children = saved.root.children.filter((child) => child.id !== 'b')
    },
    assignChannelToPanel: async ({ channelId }: { channelId: string | null }) => {
      const pane = findNodeById(saved.root, 'a')
      if (pane?.type === 'panel')
        pane.content = channelId ? { type: 'watched', channelId } : { type: 'empty' }
    },
  }
  const backend = { api }
  layoutStore.modify((states) =>
    new Map(states).set(tabId, { layout: structuredClone(saved), isLoading: false, error: null }),
  )
  cleanup.push(async () => {
    await saveLayoutNow(backend, tabId)
    layoutStore.modify((states) => {
      const next = new Map(states)
      next.delete(tabId)
      return next
    })
  })
  const weights = (layout = saved) =>
    layout.root.type === 'split'
      ? layout.root.children.map((child) => child.flex)
      : [layout.root.flex]
  return {
    tabId,
    api,
    backend,
    writes,
    weights,
    current: () => required(layoutStore.get().get(tabId)),
    saved: () => saved,
  }
}

test('quick tab reload flushes a pending resize before reading its persisted layout', async () => {
  const f = fixture()
  updateSplitFlexes(f.backend, f.tabId, 'split', [70, 30])
  await loadLayout(f.backend, f.tabId)
  expect(f.weights()).toEqual([70, 30])
  expect(f.weights(required(f.current().layout))).toEqual([70, 30])
  expect(f.writes).toHaveLength(1)
})

test('hot module reload retains the pending resize queue alongside persistent stores', async () => {
  const f = fixture()
  updateSplitFlexes(f.backend, f.tabId, 'split', [70, 30])
  const remounted: typeof import('../src/gpuix/state/layout') = await import(
    `../src/gpuix/state/layout.ts?qa-reload=${crypto.randomUUID()}`
  )
  expect(remounted.layoutStore).toBe(layoutStore)
  await remounted.loadLayout(f.backend, f.tabId)
  expect(f.weights()).toEqual([70, 30])
})

test('split, assign, remove and dock see the latest pending resize', async () => {
  for (const operation of literal(['split', 'assign', 'remove', 'dock'])) {
    const f = fixture()
    updateSplitFlexes(f.backend, f.tabId, 'split', [70, 30])
    if (operation === 'split') await splitPanel(f.backend, f.tabId, 'a', 'vertical')
    if (operation === 'assign') await assignChannel(f.backend, f.tabId, 'a', 'other')
    if (operation === 'remove') await removePanel(f.backend, f.tabId, 'b')
    if (operation === 'dock') await dockLayoutPanel(f.backend, f.tabId, 'a', 'b', 'center')
    expect(f.weights(f.writes[0])).toEqual([70, 30])
    if (operation === 'split') expect(f.weights()).toEqual([70, 30, 20])
    if (operation === 'assign')
      expect(findNodeById(f.saved().root, 'a')).toMatchObject({
        content: { type: 'watched', channelId: 'other' },
      })
    if (operation === 'remove') expect(findNodeById(f.saved().root, 'b')).toBeNull()
    const savedRoot = f.saved().root
    if (operation === 'dock' && savedRoot.type === 'split')
      expect(savedRoot.children.map((child) => child.id)).toEqual(['b', 'a'])
  }
})

test('serializes writes and persists a newer resize arriving while the first write is pending', async () => {
  const f = fixture()
  const gate = deferred<void>()
  const started = deferred<void>()
  const original = f.api.setWatchedChannelsLayout
  let active = 0
  let peak = 0
  let requests = 0
  f.api.setWatchedChannelsLayout = async (params) => {
    active++
    peak = Math.max(peak, active)
    requests++
    if (requests === 1) {
      started.resolve()
      await gate.promise
    }
    await original(params)
    active--
  }
  updateSplitFlexes(f.backend, f.tabId, 'split', [60, 40])
  const first = saveLayoutNow(f.backend, f.tabId)
  await started.promise
  updateSplitFlexes(f.backend, f.tabId, 'split', [80, 20])
  const second = saveLayoutNow(f.backend, f.tabId)
  expect(requests).toBe(1)
  gate.resolve()
  await Promise.all([first, second])
  expect(peak).toBe(1)
  expect(f.writes.map((layout) => f.weights(layout))).toEqual([
    [60, 40],
    [80, 20],
  ])
  expect(f.weights()).toEqual([80, 20])
})

test('failed writes leave the newest resize dirty so a later save retries it', async () => {
  const f = fixture()
  const gate = deferred<void>()
  const started = deferred<void>()
  const original = f.api.setWatchedChannelsLayout
  let fail = true
  f.api.setWatchedChannelsLayout = async (params) => {
    if (fail) {
      fail = false
      started.resolve()
      await gate.promise
      throw new Error('Disk full')
    }
    await original(params)
  }
  updateSplitFlexes(f.backend, f.tabId, 'split', [60, 40])
  const first = saveLayoutNow(f.backend, f.tabId)
  await started.promise
  updateSplitFlexes(f.backend, f.tabId, 'split', [75, 25])
  gate.resolve()
  await expect(first).rejects.toThrow('Disk full')
  expect(f.weights(required(f.current().layout))).toEqual([75, 25])
  await saveLayoutNow(f.backend, f.tabId)
  expect(f.weights()).toEqual([75, 25])
})

test('a stale read cannot overwrite a resize made while it was pending', async () => {
  const f = fixture()
  const gate = deferred<WatchedChannelsLayout>()
  const started = deferred<void>()
  const original = f.api.getWatchedChannelsLayout
  let first = true
  f.api.getWatchedChannelsLayout = async () => {
    if (first) {
      first = false
      started.resolve()
      return gate.promise
    }
    return original()
  }
  const read = loadLayout(f.backend, f.tabId)
  await started.promise
  updateSplitFlexes(f.backend, f.tabId, 'split', [65, 35])
  gate.resolve(structuredClone(f.saved()))
  await read
  expect(f.weights(required(f.current().layout))).toEqual([65, 35])
  expect(f.weights()).toEqual([65, 35])
})

test('transient read failure preserves an existing layout and exposes the error', async () => {
  const f = fixture()
  const original = f.api.getWatchedChannelsLayout
  f.api.getWatchedChannelsLayout = async () => {
    throw new Error('Read unavailable')
  }
  await loadLayout(f.backend, f.tabId)
  expect(f.weights(required(f.current().layout))).toEqual([50, 50])
  expect(f.current().error).toContain('Read unavailable')
  expect(f.current().isLoading).toBe(false)
  f.api.getWatchedChannelsLayout = original
})

test('a resize during a structural request is rebased onto the added panes', async () => {
  const f = fixture()
  const gate = deferred<void>()
  const started = deferred<void>()
  const original = f.api.splitPanel
  f.api.splitPanel = async () => {
    started.resolve()
    await gate.promise
    return original()
  }
  const mutation = splitPanel(f.backend, f.tabId, 'a', 'vertical')
  await started.promise
  updateSplitFlexes(f.backend, f.tabId, 'split', [80, 20])
  gate.resolve()
  await mutation
  expect(f.weights()).toEqual([80, 20, 20])
  expect(findNodeById(required(f.current().layout).root, 'c')).not.toBeNull()
})

test('a failed post-mutation read is recovered before a later resize can overwrite the split', async () => {
  const f = fixture()
  const original = f.api.getWatchedChannelsLayout
  let fail = true
  f.api.getWatchedChannelsLayout = async () => {
    if (fail) {
      fail = false
      throw new Error('Read unavailable after split')
    }
    return original()
  }
  await splitPanel(f.backend, f.tabId, 'a', 'vertical')
  expect(findNodeById(required(f.current().layout).root, 'c')).toBeNull()
  expect(findNodeById(f.saved().root, 'c')).not.toBeNull()
  updateSplitFlexes(f.backend, f.tabId, 'split', [65, 35])
  await saveLayoutNow(f.backend, f.tabId)
  expect(f.weights()).toEqual([65, 35, 20])
  expect(findNodeById(required(f.current().layout).root, 'c')).not.toBeNull()
})
