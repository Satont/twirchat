import { describe, expect, test } from 'bun:test'

import { persistentResource } from '../src/gpuix/state/persistent-resources'
import type { PreferenceStore } from '../src/gpuix/state/preferences'
import { createPreferenceStore, type PreferenceApi } from '../src/gpuix/state/preferences'

interface Value {
  count: number
}
function validate(value: unknown): Value {
  if (
    !value ||
    typeof value !== 'object' ||
    !('count' in value) ||
    typeof value.count !== 'number' ||
    !Number.isInteger(value.count)
  )
    throw new Error('Count must be an integer.')
  return { count: value.count }
}
function preference() {
  return createPreferenceStore(`test-${crypto.randomUUID()}`, { count: 0 }, validate)
}
function deferred<T>() {
  return Promise.withResolvers<T>()
}

describe('persistent preferences', () => {
  test('coalesces loading and restores validated data through the bridge', async () => {
    const config = preference()
    const pending = deferred<string | null>()
    let reads = 0
    const api: PreferenceApi = {
      getUiState: () => {
        reads += 1
        return pending.promise
      },
      setUiState: async () => {},
    }
    const first = config.load(api)
    const second = config.load(api)
    expect(config.store.get().loading).toBe(true)
    pending.resolve('{"count":7}')
    await Promise.all([first, second])
    expect(reads).toBe(1)
    expect(config.store.get()).toMatchObject({
      value: { count: 7 },
      loaded: true,
      loading: false,
      error: null,
    })
    await config.load(api)
    expect(reads).toBe(1)
  })

  test('does not overwrite a newer save with a stale load result or stale failure', async () => {
    for (const fails of [false, true]) {
      const config = preference()
      const pending = deferred<string | null>()
      const api: PreferenceApi = { getUiState: () => pending.promise, setUiState: async () => {} }
      const load = config.load(api)
      await config.save(api, { count: 42 })
      if (fails) pending.reject(new Error('stale read failure'))
      else pending.resolve('{"count":1}')
      await load
      expect(config.store.get()).toMatchObject({
        value: { count: 42 },
        loaded: true,
        loading: false,
        saving: false,
        error: null,
      })
    }
  })

  test('serializes writes and snapshots values before queued asynchronous persistence', async () => {
    const config = preference()
    const gate = deferred<void>()
    const writes: string[] = []
    const api: PreferenceApi = {
      getUiState: async () => null,
      setUiState: async ({ value }) => {
        writes.push(value)
        if (writes.length === 1) await gate.promise
      },
    }
    const value = { count: 1 }
    const first = config.save(api, value)
    value.count = 99
    const second = config.save(api, { count: 2 })
    await Bun.sleep(0)
    expect(writes).toEqual(['{"count":1}'])
    expect(config.store.get().saving).toBe(true)
    expect(config.store.get().value.count).toBe(2)
    gate.resolve()
    await Promise.all([first, second])
    expect(writes).toEqual(['{"count":1}', '{"count":2}'])
    expect(config.store.get().saving).toBe(false)
  })

  test('a failed write leaves a visible error and does not poison later saves', async () => {
    const config = preference()
    let fails = true
    const api: PreferenceApi = {
      getUiState: async () => null,
      setUiState: async () => {
        if (fails) throw new Error('disk full')
      },
    }
    await expect(config.save(api, { count: 1 })).rejects.toThrow('disk full')
    expect(config.store.get()).toMatchObject({
      saving: false,
      error: 'disk full',
      value: { count: 1 },
    })
    fails = false
    await config.save(api, { count: 2 })
    expect(config.store.get()).toMatchObject({ saving: false, error: null, value: { count: 2 } })
  })

  test('an older failed write cannot replace the latest save state', async () => {
    const config = preference()
    const gate = deferred<void>()
    let calls = 0
    const api: PreferenceApi = {
      getUiState: async () => null,
      setUiState: async () => {
        calls += 1
        if (calls === 1) await gate.promise
      },
    }
    const first = config.save(api, { count: 1 }).catch((error: Error) => error.message)
    const second = config.save(api, { count: 2 })
    gate.reject(new Error('first write failed'))
    expect(await first).toBe('first write failed')
    await second
    expect(config.store.get()).toMatchObject({ value: { count: 2 }, saving: false, error: null })
  })

  test('load failures can be retried and invalid saves never reach the backend', async () => {
    const config = preference()
    let raw = '{broken'
    let writes = 0
    const api: PreferenceApi = {
      getUiState: async () => raw,
      setUiState: async () => {
        writes += 1
      },
    }
    await config.load(api)
    expect(config.store.get().error).toBeString()
    raw = '{"count":9}'
    await config.load(api)
    expect(config.store.get()).toMatchObject({ value: { count: 9 }, error: null })
    await expect(config.save(api, { count: 1.5 })).rejects.toThrow('integer')
    expect(writes).toBe(0)
    expect(config.store.get().value.count).toBe(9)
  })

  test('defaults are independent snapshots and named factories survive a remount', async () => {
    const defaults = { count: 3 }
    const key = 'test:preference-remount'
    const config = persistentResource(key, () => createPreferenceStore(key, defaults, validate))
    defaults.count = 99
    await config.load({ getUiState: async () => null, setUiState: async () => {} })
    expect(config.store.get().value).toEqual({ count: 3 })
    expect(persistentResource(key, () => createPreferenceStore(key, { count: 0 }, validate))).toBe(
      config,
    )
  })
})

declare module '../src/gpuix/state/persistent-resources' {
  interface PersistentResources {
    'test:preference-remount': PreferenceStore<{ count: number }>
  }
}
