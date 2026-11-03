import { expect, test } from 'bun:test'

import { hasNativeControls, type NativeWindowControls } from '../src/gpuix/native-window'

function controls(): NativeWindowControls {
  return {
    getTwirNativeApiVersion() {
      return 2
    },
    closeWindow() {},
    isWindowOpen() {
      return true
    },
    isWindowActive() {
      return false
    },
    getWindowVisibility() {
      return 'visible'
    },
    async configureTray() {},
    async notifyFromTray() {
      return true
    },
    takeTrayEvents() {
      return []
    },
    setHotkeyPlan() {},
    getWindowBounds() {
      return null
    },
    getWindowCapabilities() {
      return { position: true, clickThrough: true }
    },
    async setWindowBounds() {},
    async setClickThrough() {},
    async runTextInputAction() {
      return true
    },
  }
}

test('native controls guard checks every required method and keeps the actual receiver', () => {
  const renderer = controls()
  renderer.getTwirNativeApiVersion = function () {
    return this === renderer ? 2 : 0
  }
  expect(hasNativeControls(renderer)).toBe(true)
  for (const method of Object.keys(controls())) {
    const missing = controls()
    Reflect.deleteProperty(missing, method)
    expect(hasNativeControls(missing)).toBe(false)
    const invalid = controls()
    Reflect.set(invalid, method, true)
    expect(hasNativeControls(invalid)).toBe(false)
  }
})

test('native controls guard rejects incompatible API versions before narrowing', () => {
  const renderer = controls()
  renderer.getTwirNativeApiVersion = () => 0
  expect(hasNativeControls(renderer)).toBe(false)
  expect(hasNativeControls({})).toBe(false)
})
