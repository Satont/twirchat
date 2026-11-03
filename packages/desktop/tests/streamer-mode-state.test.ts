import { afterEach, expect, test } from 'bun:test'

import { createDesktopEvents } from '../src/gpuix/backend/events'
import { createStreamerModeApi } from '../src/gpuix/backend/streamer-mode-api'
import {
  loadStreamerMode,
  saveStreamerMode,
  streamerModeRequestStore,
  streamerModeStore,
  wireStreamerMode,
} from '../src/gpuix/state/streamer-mode'
import {
  DEFAULT_STREAMER_MODE_SETTINGS,
  createStreamerModeService,
  type StreamerModeStatus,
} from '../src/services/streamer-mode'
import { literal } from './fixture-values'
const initial = streamerModeStore.get()
const requests = streamerModeRequestStore.get()
afterEach(() => {
  streamerModeStore.set(initial)
  streamerModeRequestStore.set(requests)
})
const status = (enabled: boolean): StreamerModeStatus => ({
  mode: 'auto',
  effectiveEnabled: enabled,
  settings: { ...DEFAULT_STREAMER_MODE_SETTINGS },
  checking: false,
  error: null,
})
test('late initial status cannot replace a newer backend event', async () => {
  const { promise: pending, resolve } = Promise.withResolvers<StreamerModeStatus>()
  const events = createDesktopEvents()
  const backend = { events, api: { getStreamerMode: () => pending } }
  const stop = wireStreamerMode(backend)
  const loading = loadStreamerMode(backend)
  events.emit('streamer_mode_changed', status(true))
  resolve(status(false))
  await loading
  expect(streamerModeStore.get().effectiveEnabled).toBe(true)
  stop()
})
test('API reply from a mode change cannot overwrite newer detector status', async () => {
  const events = createDesktopEvents()
  const backend = {
    events,
    api: {
      getStreamerMode: async () => status(false),
      setStreamerMode: async () => {
        events.emit('streamer_mode_changed', status(true))
        return status(false)
      },
    },
  }
  const stop = wireStreamerMode(backend)
  await loadStreamerMode(backend)
  await saveStreamerMode(backend, 'auto')
  expect(streamerModeStore.get().effectiveEnabled).toBe(true)
  stop()
})
test('persistence errors stay visible and retry succeeds', async () => {
  let fail = true
  const backend = {
    api: {
      setStreamerMode: async () => {
        if (fail) throw new Error('disk full')
        return { ...status(true), mode: literal('on') }
      },
    },
  }
  await expect(saveStreamerMode(backend, 'on')).rejects.toThrow('disk full')
  expect(streamerModeRequestStore.get().error).toBe('disk full')
  fail = false
  await saveStreamerMode(backend, 'on')
  expect(streamerModeStore.get().mode).toBe('on')
  expect(streamerModeRequestStore.get().error).toBeNull()
})
test('desktop API persists mode/privacy through its injected service and publishes the real status', async () => {
  let saved: unknown
  const events = createDesktopEvents()
  const observed: StreamerModeStatus[] = []
  events.on('streamer_mode_changed', (value) => observed.push(value))
  const streamerMode = createStreamerModeService({
    read: () => null,
    write: (value) => {
      saved = value
    },
    publish: (value) => events.emit('streamer_mode_changed', value),
    processes: async () => {
      throw new Error('Forced mode must not detect processes')
    },
  })
  const api = createStreamerModeApi(streamerMode)
  expect((await api.getStreamerMode()).mode).toBe('auto')
  expect((await api.setStreamerMode({ mode: 'on' })).effectiveEnabled).toBe(true)
  const settings = { ...DEFAULT_STREAMER_MODE_SETTINGS, hideViewerCountAndDuration: true }
  await api.setStreamerModeSettings({ settings })
  expect(await api.getStreamerModeSettings()).toEqual(settings)
  expect(saved).toEqual({ mode: 'on', settings })
  expect(observed.at(-1)?.settings).toEqual(settings)
  streamerMode.stop()
})
