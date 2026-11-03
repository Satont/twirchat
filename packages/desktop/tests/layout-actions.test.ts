import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LayoutNode, WatchedChannelsLayout } from '@twirchat/shared/types'

import { createLayoutApi, type LayoutApi } from '../src/gpuix/backend/layout-api'
import { directionalFocusTarget, rememberPreferredChildren } from '../src/gpuix/layout-operations'
import { DEFAULT_CHAT_RULES } from '../src/gpuix/message-rules'
import { clearWindowActivePane, getActivePane } from '../src/gpuix/state/active-pane'
import {
  activeWatchedTabStore,
  tabChannelIdsStore,
  watchedChannelsStore,
} from '../src/gpuix/state/app'
import { chatRulesStore } from '../src/gpuix/state/chat-rules'
import {
  chatTabsStore,
  closeChatTab,
  createEmptyChatTab,
  restoreClosedChatTab,
  tabsForChannels,
  validateChatTabs,
} from '../src/gpuix/state/chat-tabs'
import { registerChatWindow } from '../src/gpuix/state/chat-windows'
import {
  cloneLayoutForWindow,
  cleanupWindowLayoutFocus,
  requestLayoutPanelFocus,
  focusLayoutPanel,
  layoutStore,
  loadLayout,
  registerLayoutPanelFocus,
  removePanel,
  reopenClosedSplit,
  saveLayoutNow,
  updateSplitFlexes,
} from '../src/gpuix/state/layout'
import { getDb, initDb } from '../src/store/db'
import { WatchedChannelsLayoutStore } from '../src/store/watched-channels-layout-store'
import { WatchedChannelStore } from '../src/store/watched-channels-store'
import { getAllPanels } from '../src/views/main/utils/layout-tree'
import { required } from './fixture-values'

const focusCleanup: (() => void)[] = []
let directory = ''
let backend: { api: LayoutApi }
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'twirchat-layout-actions-'))
  initDb(join(directory, 'db.sqlite'))
  backend = { api: createLayoutApi() }
  chatTabsStore.set({
    value: { version: 1, openIds: [], metadata: {}, closed: [] },
    loaded: false,
    saving: false,
    error: null,
  })
  watchedChannelsStore.set([])
  tabChannelIdsStore.set([])
  activeWatchedTabStore.set('home')
  layoutStore.set(new Map())
  chatRulesStore.update({ value: structuredClone(DEFAULT_CHAT_RULES) })
})
afterEach(async () => {
  for (const dispose of focusCleanup.splice(0)) dispose()
  for (const scope of ['detached-owner', 'detached-caller']) {
    cleanupWindowLayoutFocus(scope)
    clearWindowActivePane(scope)
  }
  await Promise.all([...layoutStore.get().keys()].map((id) => saveLayoutNow(backend, id)))
  getDb().close()
  rmSync(directory, { recursive: true, force: true })
})
const pane = (id: string): LayoutNode => ({
  type: 'panel',
  id,
  flex: 50,
  content: { type: 'watched', channelId: id },
})
const nested = (): WatchedChannelsLayout => ({
  version: 2,
  root: {
    type: 'split',
    id: 'root',
    flex: 100,
    direction: 'vertical',
    children: [
      {
        type: 'split',
        id: 'left',
        flex: 65,
        direction: 'horizontal',
        children: [pane('a'), pane('b')],
      },
      {
        type: 'split',
        id: 'right',
        flex: 35,
        direction: 'horizontal',
        children: [pane('c'), pane('d')],
      },
    ],
  },
})
async function install(layout: WatchedChannelsLayout) {
  const tabId = await createEmptyChatTab(backend)
  await backend.api.setWatchedChannelsLayout({ tabId, layout })
  await loadLayout(backend, tabId)
  return tabId
}
function filters(key: string) {
  chatRulesStore.update({
    value: {
      ...structuredClone(DEFAULT_CHAT_RULES),
      filters: [
        { id: 'filter', name: 'Only messages', expression: 'message.content contains "hello"' },
      ],
      paneFilters: { [key]: ['filter'] },
    },
  })
}

test('generic empty tabs and home retain truthful content through SQLite restart', async () => {
  const tabId = await createEmptyChatTab(backend)
  expect(WatchedChannelsLayoutStore.get(tabId).root).toMatchObject({ content: { type: 'empty' } })
  expect(WatchedChannelsLayoutStore.get('tab:unknown').root).toMatchObject({
    content: { type: 'empty' },
  })
  expect(WatchedChannelsLayoutStore.get('home').root).toMatchObject({ content: { type: 'main' } })
  const raw = await backend.api.getUiState({ key: 'chat_tabs_v1' })
  expect(validateChatTabs(JSON.parse(required(raw))).openIds).toEqual([tabId])
  const tabs = tabsForChannels([], [tabId], chatTabsStore.get().value.metadata)
  expect(tabs).toHaveLength(1)
  expect(tabs[0]?.platform).toBeUndefined()
  getDb().close()
  initDb(join(directory, 'db.sqlite'))
  expect(WatchedChannelsLayoutStore.get(tabId).root).toMatchObject({ content: { type: 'empty' } })
  const watched = WatchedChannelStore.upsert('twitch', 'real', 'Real')
  expect(WatchedChannelsLayoutStore.get(watched.id).root).toMatchObject({
    content: { type: 'watched', channelId: watched.id },
  })
  WatchedChannelsLayoutStore.set(watched.id, {
    version: 2,
    root: { type: 'panel', id: 'legacy', flex: 100, content: { type: 'main' } },
  })
  expect(WatchedChannelsLayoutStore.get(watched.id).root).toMatchObject({
    content: { type: 'watched', channelId: watched.id },
  })
})

test('directional traversal remembers preferred children and never wraps at an edge', () => {
  const root = nested().root
  const preferred = new Map<string, string>()
  rememberPreferredChildren(root, 'b', preferred)
  rememberPreferredChildren(root, 'd', preferred)
  expect(directionalFocusTarget(root, 'd', 'left', preferred)).toBe('b')
  expect(directionalFocusTarget(root, 'b', 'right', preferred)).toBe('d')
  expect(directionalFocusTarget(root, 'b', 'above', preferred)).toBe('a')
  expect(directionalFocusTarget(root, 'a', 'below', preferred)).toBe('b')
  expect(directionalFocusTarget(root, 'a', 'up', preferred)).toBeNull()
  expect(directionalFocusTarget(root, 'd', 'right', preferred)).toBeNull()
  expect(directionalFocusTarget(root, 'unknown', 'left', preferred)).toBeNull()
})

test('focus registry only focuses the requested window context', async () => {
  const tabId = await install(nested())
  let focused = ''
  const off = registerLayoutPanelFocus(tabId, 'c', () => {
    focused = 'main'
  })
  const offOther = registerLayoutPanelFocus(
    tabId,
    'c',
    () => {
      focused = 'other'
    },
    'other',
  )
  expect(focusLayoutPanel(undefined, tabId, 'a', 'right')).toBe('c')
  expect(focused).toBe('main')
  off()
  offOther()
})

test('actual backend removal inherits the collapsed parent flex', async () => {
  const tabId = await install(nested())
  await backend.api.removePanel({ tabId, panelId: 'a' })
  const root = WatchedChannelsLayoutStore.get(tabId).root
  expect(root.type).toBe('split')
  if (root.type === 'split')
    expect(root.children.map((node) => [node.id, node.flex])).toEqual([
      ['b', 65],
      ['right', 35],
    ])
})

test('close/reopen serializes resize and preserves original placement, channel and pane filters', async () => {
  const tabId = await install(nested())
  filters(`${tabId}:b:twitch:b`)
  updateSplitFlexes(backend, tabId, 'root', [75, 25])
  const closing = removePanel(backend, tabId, 'b')
  const reopening = reopenClosedSplit(backend)
  await closing
  const restored = await reopening
  expect(restored?.tabId).toBe(tabId)
  expect(restored?.panelId).not.toBe('b')
  const layout = WatchedChannelsLayoutStore.get(tabId)
  expect(layout.root.type).toBe('split')
  if (layout.root.type === 'split')
    expect(layout.root.children.map((node) => node.flex)).toEqual([75, 25])
  expect(getAllPanels(layout.root).map((node) => node.content)).toContainEqual({
    type: 'watched',
    channelId: 'b',
  })
  expect(
    chatRulesStore.get().value.paneFilters[`${tabId}:${required(restored).panelId}:twitch:b`],
  ).toEqual(['filter'])
  expect(await reopenClosedSplit(backend)).toBeNull()
  expect(getAllPanels(layout.root)).toHaveLength(4)
})

test('closing the last pane closes only its canonical tab and restores that specific tab', async () => {
  const channel = WatchedChannelStore.upsert('youtube', '@fixture', 'Fixture')
  const tabId = await install({ version: 2, root: { ...pane('single'), flex: 100 } })
  const another = await createEmptyChatTab(backend)
  await removePanel(backend, tabId, 'single')
  expect(chatTabsStore.get().value.openIds).toEqual([another])
  expect(WatchedChannelStore.findById(channel.id)).not.toBeNull()
  const restored = await reopenClosedSplit(backend)
  expect(restored).toEqual({ tabId, panelId: 'single' })
  expect(activeWatchedTabStore.get()).toBe(tabId)
  expect(chatTabsStore.get().value.closed).toHaveLength(0)
})

test('split history survives restart and restoring a closed original tab does not duplicate the pane', async () => {
  const tabId = await install(nested())
  await removePanel(backend, tabId, 'b')
  await closeChatTab(backend, tabId)
  const saved = await backend.api.getUiState({ key: 'chat_tabs_v1' })
  chatTabsStore.set({
    value: validateChatTabs(JSON.parse(required(saved))),
    loaded: true,
    saving: false,
    error: null,
  })
  const restored = await reopenClosedSplit(backend)
  expect(restored?.tabId).toBe(tabId)
  expect(getAllPanels(WatchedChannelsLayoutStore.get(tabId).root)).toHaveLength(4)
  expect(await reopenClosedSplit(backend)).toBeNull()
  expect(await restoreClosedChatTab(backend)).toBeNull()
})

test('standalone window clones flush resizes, map filters and do not create or activate canonical tabs', async () => {
  const tabId = await install(nested())
  filters(`${tabId}:a:twitch:a`)
  const before = [...chatTabsStore.get().value.openIds]
  const active = activeWatchedTabStore.get()
  updateSplitFlexes(backend, tabId, 'root', [80, 20])
  const copy = await cloneLayoutForWindow(backend, tabId)
  expect(copy.tabId.startsWith('window:')).toBe(true)
  expect(chatTabsStore.get().value.openIds).toEqual(before)
  expect(activeWatchedTabStore.get()).toBe(active)
  const originalIds = new Set(getAllPanels(nested().root).map((node) => node.id))
  expect(getAllPanels(copy.layout.root).every((node) => !originalIds.has(node.id))).toBe(true)
  if (copy.layout.root.type === 'split')
    expect(copy.layout.root.children.map((node) => node.flex)).toEqual([80, 20])
  const newPane = required(
    getAllPanels(copy.layout.root).find(
      (node) => node.content.type === 'watched' && node.content.channelId === 'a',
    ),
  )
  expect(chatRulesStore.get().value.paneFilters[`${copy.tabId}:${newPane.id}:twitch:a`]).toEqual([
    'filter',
  ])
  const single = await cloneLayoutForWindow(backend, tabId, 'b')
  expect(single.layout.root.type).toBe('panel')
  expect(single.layout.root.flex).toBe(100)
})

test('home splits keep their main pane and its final pane stays available', async () => {
  await loadLayout(backend, 'home')
  const main = WatchedChannelsLayoutStore.get('home').root
  expect(main.type).toBe('panel')
  const split = await backend.api.splitPanel({
    tabId: 'home',
    panelId: main.id,
    direction: 'vertical',
  })
  await loadLayout(backend, 'home')
  expect(
    getAllPanels(WatchedChannelsLayoutStore.get('home').root).some(
      (panel) => panel.content.type === 'main',
    ),
  ).toBe(true)
  await removePanel(backend, 'home', split.newPanel.id)
  const restored = await reopenClosedSplit(backend)
  expect(restored?.tabId).toBe('home')
  await removePanel(backend, 'home', required(restored).panelId)
  await removePanel(backend, 'home', main.id)
  expect(WatchedChannelsLayoutStore.get('home').root).toMatchObject({
    id: main.id,
    content: { type: 'main' },
  })
})

test('failed recovery persistence leaves the actual pane open', async () => {
  const tabId = await install(nested())
  const original = backend.api.setUiState
  backend.api.setUiState = async (params) => {
    if (params.key === 'chat_tabs_v1') throw new Error('disk full')
    await original(params)
  }
  await removePanel(backend, tabId, 'b')
  expect(getAllPanels(WatchedChannelsLayoutStore.get(tabId).root)).toHaveLength(4)
  expect(chatTabsStore.get().value.closedSplits ?? []).toHaveLength(0)
})

test('a rejected removal cleans its provisional history without disconnecting channels', async () => {
  const tabId = await install(nested())
  backend.api.removePanel = async () => {
    throw new Error('not committed')
  }
  await removePanel(backend, tabId, 'b')
  expect(getAllPanels(WatchedChannelsLayoutStore.get(tabId).root)).toHaveLength(4)
  expect(await reopenClosedSplit(backend)).toBeNull()
})

test('retry after restoration commits but history consumption fails never duplicates the split', async () => {
  const tabId = await install(nested())
  await removePanel(backend, tabId, 'b')
  const original = backend.api.setUiState
  let fail = true
  backend.api.setUiState = async (params) => {
    if (params.key === 'chat_tabs_v1' && !JSON.parse(params.value).closedSplits?.length && fail) {
      fail = false
      throw new Error('history write failed')
    }
    await original(params)
  }
  await expect(reopenClosedSplit(backend)).rejects.toThrow('history write failed')
  expect(getAllPanels(WatchedChannelsLayoutStore.get(tabId).root)).toHaveLength(4)
  expect(await reopenClosedSplit(backend)).not.toBeNull()
  expect(getAllPanels(WatchedChannelsLayoutStore.get(tabId).root)).toHaveLength(4)
  expect(await reopenClosedSplit(backend)).toBeNull()
})

test('window clone failure removes its orphan layout and rolls back only copied filter keys', async () => {
  const tabId = await install(nested())
  filters(`${tabId}:a:twitch:a`)
  const original = backend.api.setUiState
  let fail = true
  backend.api.setUiState = async (params) => {
    if (params.key === 'chat_rules_v1' && fail) {
      fail = false
      throw new Error('filter disk full')
    }
    await original(params)
  }
  await expect(cloneLayoutForWindow(backend, tabId)).rejects.toThrow('filter disk full')
  expect(Object.keys(chatRulesStore.get().value.paneFilters)).toEqual([`${tabId}:a:twitch:a`])
  expect(
    required(
      getDb()
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'watched_tab_layout_v2_window:%'",
        )
        .get(),
    ).count,
  ).toBe(0)
})

test('removing one of three sibling panes preserves the remaining relative weights', async () => {
  const tabId = await install({
    version: 2,
    root: {
      type: 'split',
      id: 'weighted',
      flex: 100,
      direction: 'vertical',
      children: [
        { ...pane('a'), flex: 70 },
        { ...pane('b'), flex: 20 },
        { ...pane('c'), flex: 10 },
      ],
    },
  })
  await backend.api.removePanel({ tabId, panelId: 'b' })
  const root = WatchedChannelsLayoutStore.get(tabId).root
  if (root.type !== 'split') throw new Error('Expected split')
  expect(root.children.map((child) => child.flex)).toEqual([87.5, 12.5])
})

test('closed split restoration targets its live standalone owner without activating canonical main', async () => {
  const main = await install(nested())
  const standalone = `window:${crypto.randomUUID()}`
  await backend.api.setWatchedChannelsLayout({ tabId: standalone, layout: nested() })
  await loadLayout(backend, standalone)
  let activated = 0
  focusCleanup.push(
    registerChatWindow('detached-owner', {
      tabId: standalone,
      activate: () => {
        activated++
      },
    }),
  )
  await removePanel(backend, standalone, 'b')
  const ids = [...chatTabsStore.get().value.openIds]
  const restored = await reopenClosedSplit(backend)
  expect(restored).toMatchObject({ tabId: standalone, windowId: 'detached-owner' })
  expect(activeWatchedTabStore.get()).toBe(main)
  expect(chatTabsStore.get().value.openIds).toEqual(ids)
  expect(activated).toBe(1)
  expect(getActivePane('detached-owner')?.paneId).toBe(
    `${standalone}:${required(restored).panelId}`,
  )
  let focused = 0
  focusCleanup.push(
    registerLayoutPanelFocus(
      standalone,
      required(restored).panelId,
      () => {
        focused++
      },
      'detached-owner',
    ),
  )
  expect(focused).toBe(1)
  expect(getAllPanels(WatchedChannelsLayoutStore.get(standalone).root)).toHaveLength(4)
})
test('a closed standalone owner restores into the valid caller layout instead of creating a background main tab', async () => {
  const main = await install(nested())
  const original = `window:${crypto.randomUUID()}`
  await backend.api.setWatchedChannelsLayout({ tabId: original, layout: nested() })
  await loadLayout(backend, original)
  const unregister = registerChatWindow('detached-owner', { tabId: original, activate: () => {} })
  await removePanel(backend, original, 'b')
  unregister()
  const caller = `window:${crypto.randomUUID()}`
  await backend.api.setWatchedChannelsLayout({
    tabId: caller,
    layout: {
      version: 2,
      root: { type: 'panel', id: 'caller-empty', flex: 100, content: { type: 'empty' } },
    },
  })
  await loadLayout(backend, caller)
  focusCleanup.push(registerChatWindow('detached-caller', { tabId: caller, activate: () => {} }))
  const ids = [...chatTabsStore.get().value.openIds]
  const restored = await reopenClosedSplit(backend, { scope: 'detached-caller', tabId: caller })
  expect(restored).toMatchObject({ tabId: caller, windowId: 'detached-caller' })
  expect(activeWatchedTabStore.get()).toBe(main)
  expect(chatTabsStore.get().value.openIds).toEqual(ids)
  expect(WatchedChannelsLayoutStore.get(caller).root).toMatchObject({
    type: 'panel',
    content: { type: 'watched', channelId: 'b' },
    flex: 100,
  })
  expect(getAllPanels(WatchedChannelsLayoutStore.get(original).root)).toHaveLength(3)
  expect(await reopenClosedSplit(backend, { scope: 'detached-caller', tabId: caller })).toBeNull()
})
test('requesting focus after restoring a canonical closed tab survives until its pane is mounted', async () => {
  const tabId = await install(nested())
  await removePanel(backend, tabId, 'b')
  await closeChatTab(backend, tabId)
  const restored = await reopenClosedSplit(backend)
  expect(activeWatchedTabStore.get()).toBe(tabId)
  let focused = 0
  requestLayoutPanelFocus(tabId, required(restored).panelId)
  focusCleanup.push(
    registerLayoutPanelFocus(tabId, required(restored).panelId, () => {
      focused++
    }),
  )
  expect(focused).toBe(1)
})

test('a disappeared popout caller cannot create or activate a background canonical tab', async () => {
  const main = await install(nested())
  const original = `window:${crypto.randomUUID()}`
  await backend.api.setWatchedChannelsLayout({ tabId: original, layout: nested() })
  await loadLayout(backend, original)
  await removePanel(backend, original, 'b')
  const ids = [...chatTabsStore.get().value.openIds]
  await expect(
    reopenClosedSplit(backend, { scope: 'detached-caller', tabId: 'missing' }),
  ).rejects.toThrow('no longer open')
  expect(chatTabsStore.get().value.openIds).toEqual(ids)
  expect(activeWatchedTabStore.get()).toBe(main)
  expect(chatTabsStore.get().value.closedSplits).toHaveLength(1)
})
