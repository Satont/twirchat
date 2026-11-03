import { expect, test } from 'bun:test'

import {
  createStreamerModeService,
  DEFAULT_STREAMER_MODE_SETTINGS,
  hasStreamingProcess,
  parseStreamingProcessOutput,
  validateStreamerModeConfiguration,
  type StreamerModeConfiguration,
  type StreamerModeStatus,
} from '../src/services/streamer-mode'
function deferred<T>() {
  return Promise.withResolvers<T>()
}
function clock() {
  const intervals = new Map<object, { callback: () => void; delay: number }>()
  const timeouts = new Map<object, { callback: () => void; delay: number }>()
  return {
    intervals,
    timeouts,
    scheduleInterval(callback: () => void, delay: number) {
      const id = {}
      intervals.set(id, { callback, delay })
      return () => {
        intervals.delete(id)
      }
    },
    scheduleTimeout(callback: () => void, delay: number) {
      const id = {}
      timeouts.set(id, { callback, delay })
      return () => {
        timeouts.delete(id)
      }
    },
    tick() {
      for (const { callback } of intervals.values()) callback()
    },
    deadline() {
      for (const [id, { callback }] of [...timeouts]) {
        timeouts.delete(id)
        callback()
      }
    },
  }
}
const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve()
}

test('streamer defaults and exact case-insensitive platform process names match primary rules', () => {
  expect(hasStreamingProcess(['OBS'], 'linux')).toBe(true)
  expect(hasStreamingProcess(['Twitch Studio', 'Streamlabs Desktop'], 'darwin')).toBe(true)
  expect(hasStreamingProcess(['obs-helper', 'OBS64.exe', 'myobs'], 'linux')).toBe(false)
  for (const name of [
    'obs.exe',
    'obs64.exe',
    'prismlivestudio.exe',
    'xsplit.core.exe',
    'twitchstudio.exe',
    'twitch studio.exe',
    'vmix64.exe',
    'streamlabs desktop.exe',
    'streamlabs obs.exe',
    'streamlabsdesktop.exe',
  ])
    expect(hasStreamingProcess([name.toUpperCase()], 'win32')).toBe(true)
  expect(hasStreamingProcess(['obs.exe.bak', 'someobs.exe', 'obs'], 'win32')).toBe(false)
  expect(DEFAULT_STREAMER_MODE_SETTINGS).toEqual({
    hideUsercardAvatars: true,
    hideLinkThumbnails: true,
    hideModActions: true,
    hideRestrictedUsers: true,
    muteMentions: true,
    suppressInlineWhispers: true,
    hideBlockedTermText: true,
    hideViewerCountAndDuration: false,
    suppressLiveNotifications: false,
  })
})
test('process parser keeps executable basenames including spaces and ignores arguments as names', () => {
  expect(
    parseStreamingProcessOutput(
      '/usr/bin/obs\n/opt/Streamlabs Desktop\n/usr/bin/obs-helper\n',
      'linux',
    ),
  ).toEqual(['obs', 'Streamlabs Desktop', 'obs-helper'])
  expect(
    parseStreamingProcessOutput('/Applications/OBS.app/Contents/MacOS/OBS\n', 'darwin'),
  ).toEqual(['OBS'])
  expect(
    parseStreamingProcessOutput('"OBS64.exe","1234","Console","1","10,000 K"\n', 'win32'),
  ).toEqual(['OBS64.exe'])
})
test('auto checks immediately and every20seconds; toggle flips effective state into a forced mode', async () => {
  const timers = clock()
  const published: StreamerModeStatus[] = []
  const saved: StreamerModeConfiguration[] = []
  let calls = 0
  const service = createStreamerModeService({
    ...timers,
    platform: 'linux',
    read: () => null,
    write: (value) => {
      saved.push(value)
    },
    publish: (value) => published.push(value),
    processes: async () => {
      calls++
      return ['OBS']
    },
  })
  service.start()
  await service.check()
  expect(calls).toBe(1)
  expect(service.getStatus()).toMatchObject({
    mode: 'auto',
    effectiveEnabled: true,
    checking: false,
    error: null,
  })
  expect([...timers.intervals.values()][0]?.delay).toBe(20000)
  timers.tick()
  await service.check()
  expect(calls).toBe(2)
  await service.setMode('toggle')
  expect(service.getStatus()).toMatchObject({ mode: 'off', effectiveEnabled: false })
  expect(timers.intervals.size).toBe(0)
  await service.setMode('toggle')
  expect(service.getStatus()).toMatchObject({ mode: 'on', effectiveEnabled: true })
  expect(calls).toBe(2)
  expect(saved.map((value) => value.mode)).toEqual(['off', 'on'])
  expect(published.at(-1)?.effectiveEnabled).toBe(true)
  service.stop()
})
test('timeouts abort the runner, do not overlap jobs, and stale results cannot override forced mode', async () => {
  const timers = clock()
  const gate = deferred<string[]>()
  let calls = 0
  let signal: AbortSignal | undefined
  const service = createStreamerModeService({
    ...timers,
    platform: 'linux',
    read: () => null,
    write: () => {},
    publish: () => {},
    processes: async (_platform, abort) => {
      calls++
      signal = abort
      return calls === 1 ? gate.promise : []
    },
  })
  service.start()
  await flush()
  expect(calls).toBe(1)
  expect([...timers.timeouts.values()][0]?.delay).toBe(1000)
  timers.deadline()
  expect(signal?.aborted).toBe(true)
  expect(service.getStatus().error).toContain('timed out')
  timers.tick()
  await flush()
  expect(calls).toBe(1)
  await service.setMode('on')
  expect(timers.intervals.size).toBe(0)
  expect(timers.timeouts.size).toBe(0)
  gate.resolve([])
  await flush()
  expect(service.getStatus()).toMatchObject({ mode: 'on', effectiveEnabled: true, error: null })
  await service.setMode('auto')
  await service.check()
  expect(calls).toBe(2)
  expect(service.getStatus().effectiveEnabled).toBe(false)
  service.stop()
})
test('forced persisted mode never starts detection and stop cancels auto work', async () => {
  const timers = clock()
  let calls = 0
  const gate = deferred<string[]>()
  const service = createStreamerModeService({
    ...timers,
    read: () => ({ mode: 'off', settings: DEFAULT_STREAMER_MODE_SETTINGS }),
    write: () => {},
    publish: () => {},
    processes: async () => {
      calls++
      return gate.promise
    },
  })
  service.start()
  await flush()
  expect(calls).toBe(0)
  await service.setMode('auto')
  await flush()
  expect(calls).toBe(1)
  service.stop()
  gate.resolve(['OBS'])
  await flush()
  expect(timers.intervals.size).toBe(0)
  expect(timers.timeouts.size).toBe(0)
  expect(service.getStatus().effectiveEnabled).toBe(false)
})
test('failed persistence leaves the prior mode and detector intact and can retry', async () => {
  const timers = clock()
  let fail = true
  const service = createStreamerModeService({
    ...timers,
    read: () => null,
    write: () => {
      if (fail) throw new Error('disk full')
    },
    publish: () => {},
    processes: async () => [],
  })
  service.start()
  await service.check()
  await expect(service.setMode('on')).rejects.toThrow('disk full')
  expect(service.getStatus().mode).toBe('auto')
  expect(timers.intervals.size).toBe(1)
  fail = false
  await service.setMode('on')
  expect(service.getStatus().mode).toBe('on')
  service.stop()
})
test('invalid saved settings produce safe defaults and retain their error until repaired', async () => {
  const timers = clock()
  const service = createStreamerModeService({
    ...timers,
    read: () => ({ mode: 'invalid' }),
    write: () => {},
    publish: () => {},
    processes: async () => [],
  })
  service.start()
  await service.check()
  expect(service.getStatus().mode).toBe('auto')
  expect(service.getStatus().error).toContain('Auto, On or Off')
  await service.setSettings({ ...DEFAULT_STREAMER_MODE_SETTINGS, muteMentions: false })
  expect(service.getStatus().settings.muteMentions).toBe(false)
  expect(service.getStatus().error).toBeNull()
  expect(() => validateStreamerModeConfiguration({ mode: 'on', settings: {} })).toThrow()
  service.stop()
})
