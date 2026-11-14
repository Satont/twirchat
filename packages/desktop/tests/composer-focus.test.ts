import { afterEach, expect, test } from 'bun:test'

import type { WatchedChannelsLayout } from '@twirchat/shared/types'

import { getActivePane, clearWindowActivePane } from '../src/gpuix/state/active-pane'
import {
  cleanupWindowComposerFocus,
  focusComposerByKey,
  focusComposerForPane,
  registerComposerFocus,
} from '../src/gpuix/state/composer-focus'
import {
  cleanupWindowLayoutFocus,
  focusLayoutPanel,
  layoutStore,
  registerLayoutPanelFocus,
  requestLayoutPanelFocus,
  splitPanel,
} from '../src/gpuix/state/layout'
import { literal } from './fixture-values'
const scopes = ['main', 'focus-other', 'focus-queued']
afterEach(() => {
  for (const scope of scopes) {
    cleanupWindowLayoutFocus(scope)
    cleanupWindowComposerFocus(scope)
    clearWindowActivePane(scope)
  }
})

test('composer registrations are scoped, latest and safe against stale disposers', () => {
  const calls: string[] = []
  const old = registerComposerFocus('window:tab:panel:home', () => {
    calls.push('old')
  })
  registerComposerFocus('window:tab:panel:home', () => {
    calls.push('new')
  })
  registerComposerFocus(
    'window:tab:panel:home',
    () => {
      calls.push('other')
    },
    'focus-other',
  )
  old()
  expect(focusComposerForPane('window:tab', 'panel')).toBe(true)
  expect(focusComposerForPane('window:tab', 'panel', 'focus-other')).toBe(true)
  expect(calls).toEqual(['new', 'other'])
  cleanupWindowComposerFocus('main')
  expect(focusComposerForPane('window:tab', 'panel')).toBe(false)
  expect(focusComposerForPane('window:tab', 'panel', 'focus-other')).toBe(true)
})
test('composer identity avoids panel-prefix collisions and supports activity IDs containing colons', () => {
  let calls = 0
  registerComposerFocus(
    'window:tab:panel:child:activity:watched',
    () => {
      calls++
    },
    'main',
    'activity:watched',
  )
  expect(focusComposerForPane('window:tab', 'panel')).toBe(false)
  expect(focusComposerForPane('window:tab', 'panel:child')).toBe(true)
  expect(calls).toBe(1)
})
test('unavailable composer leaves focus to the chooser or container fallback', () => {
  registerComposerFocus('tab:panel:home', () => false)
  expect(focusComposerForPane('tab', 'panel')).toBe(false)
})
test('an exact composer key targets only its own activity', () => {
  const calls: string[] = []
  registerComposerFocus('tab:panel:home', () => {
    calls.push('home')
  })
  registerComposerFocus('tab:panel:watched', () => {
    calls.push('watched')
  })
  expect(focusComposerByKey('tab:panel:watched')).toBe(true)
  expect(calls).toEqual(['watched'])
  cleanupWindowComposerFocus('main')
  expect(focusComposerByKey('tab:panel:watched')).toBe(false)
})
test('queued pane focus fires when registration arrives, only in its own window', () => {
  const calls: string[] = []
  expect(requestLayoutPanelFocus('tab', 'panel', 'focus-queued')).toBe(false)
  registerLayoutPanelFocus(
    'tab',
    'panel',
    () => {
      calls.push('wrong')
    },
    'focus-other',
  )
  expect(calls).toEqual([])
  registerLayoutPanelFocus(
    'tab',
    'panel',
    () => {
      calls.push('right')
    },
    'focus-queued',
  )
  expect(calls).toEqual(['right'])
  const old = registerLayoutPanelFocus(
    'tab',
    'panel',
    () => {
      calls.push('old')
    },
    'focus-queued',
  )
  registerLayoutPanelFocus(
    'tab',
    'panel',
    () => {
      calls.push('new')
    },
    'focus-queued',
  )
  old()
  requestLayoutPanelFocus('tab', 'panel', 'focus-queued')
  expect(calls).toEqual(['right', 'new'])
})
test('the latest unmounted focus request wins and cleanup cancels pending requests', () => {
  let calls = 0
  requestLayoutPanelFocus('tab', 'old', 'focus-queued')
  requestLayoutPanelFocus('tab', 'new', 'focus-queued')
  registerLayoutPanelFocus(
    'tab',
    'old',
    () => {
      calls += 100
    },
    'focus-queued',
  )
  registerLayoutPanelFocus(
    'tab',
    'new',
    () => {
      calls++
    },
    'focus-queued',
  )
  expect(calls).toBe(1)
  requestLayoutPanelFocus('later', 'panel', 'focus-queued')
  cleanupWindowLayoutFocus('focus-queued')
  registerLayoutPanelFocus(
    'later',
    'panel',
    () => {
      calls++
    },
    'focus-queued',
  )
  expect(calls).toBe(1)
})
test('split result queues new-pane focus and updates scoped active pane before it mounts', async () => {
  const tabId = `focus-${crypto.randomUUID()}`
  let saved: WatchedChannelsLayout = {
    version: 2,
    root: { type: 'panel', id: 'source', flex: 100, content: { type: 'empty' } },
  }
  const api = {
    setWatchedChannelsLayout: async ({ layout }: { layout: WatchedChannelsLayout }) => {
      saved = structuredClone(layout)
    },
    getWatchedChannelsLayout: async () => structuredClone(saved),
    splitPanel: async () => {
      const original = { ...saved.root, flex: 50 }
      const newPanel = {
        type: literal('panel'),
        id: 'new-pane',
        flex: 50,
        content: { type: literal('empty') },
      }
      saved = {
        version: 2,
        root: {
          type: 'split',
          id: 'split',
          direction: 'vertical',
          flex: 100,
          children: [original, newPanel],
        },
      }
      return { original, newPanel }
    },
  }
  const backend = { api }
  layoutStore.modify((current) =>
    new Map(current).set(tabId, { layout: saved, isLoading: false, error: null }),
  )
  const id = await splitPanel(backend, tabId, 'source', 'vertical', 'focus-queued')
  expect(id).toBe('new-pane')
  expect(getActivePane('focus-queued')).toEqual({ tabId, paneId: `${tabId}:new-pane` })
  let focused = 0
  const off = registerLayoutPanelFocus(
    tabId,
    'new-pane',
    () => {
      focused++
    },
    'focus-queued',
  )
  expect(focused).toBe(1)
  expect(focusLayoutPanel(undefined, tabId, 'source', 'right', 'focus-queued')).toBe('new-pane')
  expect(focused).toBe(2)
  off()
  layoutStore.modify((current) => {
    const next = new Map(current)
    next.delete(tabId)
    return next
  })
})
