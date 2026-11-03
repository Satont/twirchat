import { expect, test } from 'bun:test'

import type { KeyEvent } from '@gpuix/react'
import { DEFAULT_MODERATION_SETTINGS } from '@twirchat/shared/user-profile'

import { resolveModeratorHotkey } from '../src/gpuix/components/user-card/moderation-hotkeys'
import {
  popupPageTarget,
  popupTabIndex,
  focusPopupSearch,
  scrollPopupPage,
} from '../src/gpuix/hooks/use-popup-hotkeys'
import {
  actionBindingsStore,
  dispatchCustomHotkey,
  registerHotkeyContext,
  setHotkeyRoute,
} from '../src/gpuix/state/action-bindings'
import { pushOverlayClose } from '../src/gpuix/state/overlays'

const event = (key: string): KeyEvent => {
  let prevented = false
  return {
    elementId: 0,
    eventType: 'keyDown',
    key,
    modifiers: { ctrl: true, shift: false, alt: false, cmd: false },
    get defaultPrevented() {
      return prevented
    },
    preventDefault() {
      prevented = true
    },
    stopPropagation() {},
  }
}
test('unsupported popup shortcuts never reach a background window or another window', () => {
  const previous = actionBindingsStore.get()
  const stops: (() => void)[] = []
  let background = 0,
    popup = 0,
    other = 0
  try {
    actionBindingsStore.set({
      ...previous,
      value: {
        ...previous.value,
        bindings: [
          {
            id: 'qa-background',
            name: '',
            enabled: true,
            category: 'window',
            action: 'quit',
            keys: ['ctrl+enter'],
            arguments: [],
          },
          {
            id: 'qa-accept',
            name: '',
            enabled: true,
            category: 'popupWindow',
            action: 'accept',
            keys: ['ctrl+enter'],
            arguments: [],
          },
          {
            id: 'qa-delete',
            name: '',
            enabled: true,
            category: 'popupWindow',
            action: 'delete',
            keys: ['ctrl+backspace'],
            arguments: [],
          },
        ],
      },
    })
    stops.push(
      registerHotkeyContext({
        id: 'background',
        windowId: 'qa-popup',
        category: 'window',
        handlers: {
          quit: () => {
            background++
          },
        },
      }),
    )
    stops.push(
      registerHotkeyContext({
        id: 'popup',
        windowId: 'qa-popup',
        category: 'popupWindow',
        handlers: {
          accept: null,
          delete: () => {
            popup++
          },
        },
      }),
    )
    stops.push(
      registerHotkeyContext({
        id: 'popup',
        windowId: 'qa-other',
        category: 'popupWindow',
        handlers: {
          delete: () => {
            other++
          },
        },
      }),
    )
    stops.push(
      setHotkeyRoute('qa-popup', ['background'], 1),
      setHotkeyRoute('qa-popup', ['popup'], 100),
      setHotkeyRoute('qa-other', ['popup'], 100),
      pushOverlayClose(() => {}, 'qa-popup', 'popup'),
    )
    expect(dispatchCustomHotkey(event('enter'), 'qa-popup')).toBe(false)
    expect(background).toBe(0)
    expect(dispatchCustomHotkey(event('backspace'), 'qa-popup')).toBe(true)
    expect([popup, other]).toEqual([1, 0])
    expect(dispatchCustomHotkey(event('backspace'), 'qa-other')).toBe(true)
    expect([popup, other]).toEqual([1, 1])
  } finally {
    for (const stop of stops.reverse()) stop()
    actionBindingsStore.set(previous)
  }
})
test('visible emote tabs use zero-based indices and relative navigation wraps', () => {
  expect(popupTabIndex(0, 'previous', 3)).toBe(2)
  expect(popupTabIndex(2, 'next', 3)).toBe(0)
  expect(popupTabIndex(0, 'last', 3)).toBe(2)
  expect(popupTabIndex(2, '0', 3)).toBe(0)
  expect(popupTabIndex(0, '3', 3)).toBeNull()
  expect(popupTabIndex(0, '-1', 3)).toBeNull()
  expect(popupTabIndex(0, 'next', 0)).toBeNull()
})
test('page scrolling moves one measured viewport from the exact virtual-list anchor', () => {
  expect(popupPageTarget([7, 13, 186], 186, 'down')).toEqual([7, 199])
  expect(popupPageTarget([7, 13, 186], 186, 'up')).toEqual([7, -173])
  expect(popupPageTarget(null, 186, 'up')).toBeNull()
  const calls: unknown[] = []
  const renderer = {
    getListScrollTop: () => [7, 13, 186],
    getElementBounds: () => ({ height: 186 }),
    scrollToItem: (...args: unknown[]) => calls.push(args),
  }
  scrollPopupPage(renderer, { current: { id: 42 } }, 'down')
  expect(calls).toEqual([[42, 7, 199]])
})
test('popup search focuses the actual editor before native select-all', async () => {
  const calls: unknown[] = []
  const renderer = {
    focusElement: (id: number) => calls.push(id),
    runTextInputAction: async (name: string) => {
      calls.push(name)
      return true
    },
  }
  await focusPopupSearch(renderer, { current: { id: 7 } })
  expect(calls).toEqual([7, 'selectAll'])
})
test('moderator shortcuts select configured timeout durations using one-based indices', () => {
  const settings = structuredClone(DEFAULT_MODERATION_SETTINGS)
  settings.timeouts[0] = { label: 'Configured', seconds: 123 }
  expect(resolveModeratorHotkey('1', settings)).toEqual({
    action: 'timeout',
    duration: 123,
    message: 'Timed out for Configured.',
  })
  expect(resolveModeratorHotkey('ban', settings).action).toBe('ban')
  expect(resolveModeratorHotkey('unban', settings).action).toBe('unban')
  expect(() => resolveModeratorHotkey('0', settings)).toThrow('starting at 1')
  expect(() => resolveModeratorHotkey('99', settings)).toThrow('starting at 1')
})
