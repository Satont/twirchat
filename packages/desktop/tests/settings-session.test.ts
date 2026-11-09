import { expect, test } from 'bun:test'

import {
  bindSettingsSession,
  discardSettingsAndLeave,
  requestLeaveSettings,
  saveSettingsAndLeave,
  settingsSessionStore,
  stayInSettings,
  syncSettingsSession,
} from '../src/gpuix/state/settings-session'

test('leaving settings without drafts proceeds immediately', () => {
  const unbind = bindSettingsSession({ save: async () => true, discard() {} })
  let left = false
  expect(requestLeaveSettings(() => (left = true))).toBe(true)
  expect(left).toBe(true)
  unbind()
})

test('unsaved settings defer navigation until the warning is resolved', async () => {
  let left = false
  let saved = 0
  const unbind = bindSettingsSession({
    save: async () => {
      saved++
      return true
    },
    discard() {},
  })
  syncSettingsSession(true, false)
  expect(requestLeaveSettings(() => (left = true))).toBe(false)
  expect(left).toBe(false)
  expect(settingsSessionStore.get().pending).not.toBeNull()

  expect(await saveSettingsAndLeave()).toBe(true)
  expect(saved).toBe(1)
  expect(left).toBe(true)
  expect(settingsSessionStore.get().pending).toBeNull()
  unbind()
})

test('a failed save keeps the warning open instead of leaving', async () => {
  let left = false
  const unbind = bindSettingsSession({ save: async () => false, discard() {} })
  syncSettingsSession(true, false)
  requestLeaveSettings(() => (left = true))
  expect(await saveSettingsAndLeave()).toBe(false)
  expect(left).toBe(false)
  expect(settingsSessionStore.get().pending).not.toBeNull()
  stayInSettings()
  expect(settingsSessionStore.get().pending).toBeNull()
  unbind()
})

test('discard and leave drops drafts and then navigates', () => {
  let left = false
  let discarded = 0
  const unbind = bindSettingsSession({
    save: async () => true,
    discard() {
      discarded++
    },
  })
  syncSettingsSession(true, false)
  requestLeaveSettings(() => (left = true))
  discardSettingsAndLeave()
  expect(discarded).toBe(1)
  expect(left).toBe(true)
  expect(settingsSessionStore.get().pending).toBeNull()
  unbind()
})

test('unbinding a session clears pending navigation and dirty state', () => {
  const unbind = bindSettingsSession({ save: async () => true, discard() {} })
  syncSettingsSession(true, false)
  requestLeaveSettings(() => {})
  unbind()
  expect(settingsSessionStore.get()).toEqual({ dirty: false, saving: false, pending: null })
})
