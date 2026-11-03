import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { KeyEvent } from '@gpuix/react'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

import {
  activeTabStore,
  activeWatchedTabStore,
  settingsStore,
  tabChannelIdsStore,
} from '../src/gpuix/state/app'
import { trackTextInputFocus } from '../src/gpuix/state/focus'
import { handleGlobalKeyDown, registerHotkeyActions } from '../src/gpuix/state/hotkeys'
import { hasOpenOverlay, pushOverlayClose } from '../src/gpuix/state/overlays'
import { literal } from './fixture-values'

function keyEvent(key: string, modifiers: Partial<KeyEvent['modifiers']> = {}): KeyEvent {
  let prevented = false
  return {
    elementId: 1,
    eventType: 'keyDown',
    key,
    modifiers: { ctrl: false, alt: false, shift: false, cmd: false, ...modifiers },
    get defaultPrevented() {
      return prevented
    },
    preventDefault: () => {
      prevented = true
    },
    stopPropagation: () => {},
  }
}

describe('global chat navigation', () => {
  let previousTab = activeTabStore.get()
  let previousWatched = activeWatchedTabStore.get()
  let previousSettings = settingsStore.get()
  let previousTabIds = tabChannelIdsStore.get()
  let focused = false
  let selectorCalls = 0
  let addCalls = 0
  let searchCalls = 0
  let disposers: Array<() => void> = []

  beforeEach(() => {
    previousTab = activeTabStore.get()
    previousWatched = activeWatchedTabStore.get()
    previousSettings = settingsStore.get()
    previousTabIds = tabChannelIdsStore.get()
    activeTabStore.set('chat')
    activeWatchedTabStore.set('home')
    settingsStore.set(structuredClone(DEFAULT_SETTINGS))
    tabChannelIdsStore.set(['first', 'second'])
    selectorCalls = 0
    addCalls = 0
    searchCalls = 0
    disposers = []
    registerHotkeyActions({
      openAddChannel: () => {
        addCalls++
      },
      openTabSelector: () => {
        selectorCalls++
      },
      openAllChatSearch: () => {
        searchCalls++
      },
    })
  })

  afterEach(() => {
    if (focused) trackTextInputFocus(false)
    focused = false
    for (const dispose of disposers) dispose()
    activeTabStore.set(previousTab)
    activeWatchedTabStore.set(previousWatched)
    settingsStore.set(previousSettings)
    tabChannelIdsStore.set(previousTabIds)
    registerHotkeyActions({ openAddChannel: () => {}, openTabSelector: () => {} })
  })

  const focusComposer = () => {
    focused = true
    trackTextInputFocus(true)
  }

  test('Ctrl+Shift+F opens all-chat search while composing but respects modal priority', () => {
    focusComposer()
    const event = keyEvent('f', { ctrl: true, shift: true })
    handleGlobalKeyDown(event)
    expect(searchCalls).toBe(1)
    expect(event.defaultPrevented).toBe(true)
    disposers.push(pushOverlayClose(() => {}))
    handleGlobalKeyDown(keyEvent('f', { ctrl: true, shift: true }))
    expect(searchCalls).toBe(1)
  })

  test('Ctrl+Tab cycles channels while composing and cancels native focus movement', () => {
    focusComposer()
    const event = keyEvent('tab', { ctrl: true })
    handleGlobalKeyDown(event)
    expect(activeWatchedTabStore.get()).toBe('first')
    expect(event.defaultPrevented).toBe(true)
    handleGlobalKeyDown(keyEvent('tab', { ctrl: true }))
    expect(activeWatchedTabStore.get()).toBe('second')
    handleGlobalKeyDown(keyEvent('tab', { ctrl: true }))
    expect(activeWatchedTabStore.get()).toBe('home')
    expect(selectorCalls).toBe(0)
  })

  test('configured previous-tab navigation understands native arrow key names', () => {
    focusComposer()
    const event = keyEvent('left', { alt: true })
    handleGlobalKeyDown(event)
    expect(activeWatchedTabStore.get()).toBe('second')
    expect(event.defaultPrevented).toBe(true)
  })

  test('Ctrl+K invokes the selector once and prevents the editor default', () => {
    focusComposer()
    const event = keyEvent('k', { ctrl: true })
    handleGlobalKeyDown(event)
    expect(selectorCalls).toBe(1)
    expect(event.defaultPrevented).toBe(true)
    expect(activeWatchedTabStore.get()).toBe('home')
  })

  test('configured selector shortcuts also work while composing', () => {
    focusComposer()
    const event = keyEvent('l', { ctrl: true })
    handleGlobalKeyDown(event)
    expect(selectorCalls).toBe(1)
    expect(event.defaultPrevented).toBe(true)
  })

  test('plain typing and editor navigation remain untouched even if configured as shortcuts', () => {
    focusComposer()
    settingsStore.set({
      ...DEFAULT_SETTINGS,
      hotkeys: { newTab: 'enter', nextTab: 'tab', prevTab: 'arrowleft', tabSelector: 'k' },
    })
    for (const key of ['k', 'a', 'tab', 'enter', 'left', 'up', 'down', 'escape']) {
      const event = keyEvent(key)
      handleGlobalKeyDown(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(activeWatchedTabStore.get()).toBe('home')
    expect(selectorCalls).toBe(0)
    expect(addCalls).toBe(0)
  })

  test('new-tab shortcuts stay suppressed in the composer', () => {
    focusComposer()
    const event = keyEvent('t', { ctrl: true })
    handleGlobalKeyDown(event)
    expect(addCalls).toBe(0)
    expect(event.defaultPrevented).toBe(false)
  })

  test('focused settings and other non-chat editors never invoke chat navigation', () => {
    focusComposer()
    for (const tab of literal(['settings', 'platforms', 'events'])) {
      activeTabStore.set(tab)
      for (const [key, modifiers] of literal([
        ['tab', { ctrl: true }],
        ['k', { ctrl: true }],
        ['l', { ctrl: true }],
        ['left', { alt: true }],
      ])) {
        const event = keyEvent(key, modifiers)
        handleGlobalKeyDown(event)
        expect(event.defaultPrevented).toBe(false)
      }
      expect(activeTabStore.get()).toBe(tab)
      expect(activeWatchedTabStore.get()).toBe('home')
    }
    expect(selectorCalls).toBe(0)
  })

  test('an open modal or shortcut recorder blocks navigation even without a text editor', () => {
    disposers.push(pushOverlayClose(() => {}))
    expect(hasOpenOverlay()).toBe(true)
    for (const key of ['k', 'l', 'tab', 't']) {
      const event = keyEvent(key, { ctrl: true })
      handleGlobalKeyDown(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(selectorCalls).toBe(0)
    expect(addCalls).toBe(0)
    expect(activeWatchedTabStore.get()).toBe('home')
  })

  test('unfocused navigation still works from another main tab', () => {
    activeTabStore.set('events')
    handleGlobalKeyDown(keyEvent('tab', { ctrl: true }))
    expect(activeTabStore.get()).toBe('chat')
    expect(activeWatchedTabStore.get()).toBe('first')
    handleGlobalKeyDown(keyEvent('t', { ctrl: true }))
    expect(addCalls).toBe(1)
  })

  test('Escape closes only the top overlay when no editor handles it', () => {
    const closed: string[] = []
    disposers.push(pushOverlayClose(() => closed.push('bottom')))
    disposers.push(pushOverlayClose(() => closed.push('top')))
    handleGlobalKeyDown(keyEvent('escape'))
    expect(closed).toEqual(['top'])
    expect(hasOpenOverlay()).toBe(true)
    handleGlobalKeyDown(keyEvent('escape'))
    expect(closed).toEqual(['top', 'bottom'])
    expect(hasOpenOverlay()).toBe(false)
  })

  test('Escape does not double-close an overlay when its text editor is focused', () => {
    focusComposer()
    let closed = 0
    disposers.push(pushOverlayClose(() => closed++))
    handleGlobalKeyDown(keyEvent('escape'))
    expect(closed).toBe(0)
    expect(hasOpenOverlay()).toBe(true)
  })
})
