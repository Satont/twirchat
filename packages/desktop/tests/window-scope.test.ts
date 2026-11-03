import { expect, test } from 'bun:test'

import type { KeyEvent } from '@gpuix/react'

import {
  isTextInputFocused,
  onTextInputFocusChange,
  trackTextInputFocus,
} from '../src/gpuix/state/focus'
import { handleGlobalKeyDown, registerHotkeyActions } from '../src/gpuix/state/hotkeys'
import { closeTopOverlay, hasOpenOverlay, pushOverlayClose } from '../src/gpuix/state/overlays'

test('editing a popout does not suppress shortcuts in another window', () => {
  const main: boolean[] = [],
    popup: boolean[] = []
  const stopMain = onTextInputFocusChange((value) => main.push(value), 'scope-main')
  const stopPopup = onTextInputFocusChange((value) => popup.push(value), 'scope-popup')
  trackTextInputFocus(true, 'scope-popup')
  expect(isTextInputFocused('scope-main')).toBe(false)
  expect(isTextInputFocused('scope-popup')).toBe(true)
  expect(main).toEqual([])
  expect(popup).toEqual([true])
  trackTextInputFocus(false, 'scope-popup')
  expect(isTextInputFocused('scope-popup')).toBe(false)
  stopMain()
  stopPopup()
})

test('Escape closes only the top overlay in its window and duplicate callbacks dispose independently', () => {
  let closed = 0
  const callback = () => {
    closed++
  }
  const first = pushOverlayClose(callback, 'scope-a')
  const second = pushOverlayClose(callback, 'scope-a')
  const other = pushOverlayClose(callback, 'scope-b')
  first()
  expect(closeTopOverlay('scope-a')).toBe(true)
  expect(closed).toBe(1)
  expect(hasOpenOverlay('scope-a')).toBe(false)
  expect(hasOpenOverlay('scope-b')).toBe(true)
  second()
  other()
})

test('window shortcut registrations do not overwrite each other or newer mounts', () => {
  let main = 0,
    popup = 0
  const actions = (open: () => void) => ({ openAddChannel: () => {}, openTabSelector: open })
  const old = registerHotkeyActions(
    actions(() => {
      main += 100
    }),
    'scope-main',
  )
  const stopMain = registerHotkeyActions(
    actions(() => {
      main++
    }),
    'scope-main',
  )
  const stopPopup = registerHotkeyActions(
    actions(() => {
      popup++
    }),
    'scope-popup',
  )
  old()
  const event: KeyEvent = {
    elementId: 0,
    eventType: 'keyDown',
    key: 'k',
    modifiers: { ctrl: true, shift: false, alt: false, cmd: false },
    defaultPrevented: false,
    preventDefault: () => {},
    stopPropagation: () => {},
  }
  handleGlobalKeyDown(event, 'scope-main')
  handleGlobalKeyDown(event, 'scope-popup')
  expect([main, popup]).toEqual([1, 1])
  stopMain()
  stopPopup()
})
