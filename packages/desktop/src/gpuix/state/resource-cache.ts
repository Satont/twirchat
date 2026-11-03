import { runInBackground } from '../../services/background-task'
import { createStore, type Store } from './create-store'

export type ResourceSnapshot<T> =
  | { status: 'ready'; value: T }
  | { status: 'error'; error: string }
  | undefined

interface ResourceCacheOptions<K, V> {
  key: (input: K) => string
  load: (input: K) => Promise<V>
  capacity?: number
  concurrency?: number
  ttlMs?: number
  retryMs?: number
  now?: () => number
}
interface ResourceEntry<K, V> {
  input: K
  state: Store<ResourceSnapshot<V>>
  expires: number
  subscribers: number
  task?: Promise<void>
  cancelQueued?: () => void
}

/** A bounded lazy cache; each resource notifies only its mounted consumers. */
export function createResourceCache<K, V>(options: ResourceCacheOptions<K, V>) {
  const entries = new Map<string, ResourceEntry<K, V>>()
  const queue: Array<() => Promise<void>> = []
  const capacity = Math.max(1, options.capacity ?? 512)
  const concurrency = Math.max(1, options.concurrency ?? 4)
  const now = options.now ?? Date.now
  let active = 0
  let subscribers = 0
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  function trim(protectedKey?: string) {
    for (const [key, entry] of entries) {
      if (entries.size <= capacity) break
      if (key !== protectedKey && !entry.subscribers && !entry.task) entries.delete(key)
    }
  }
  function entryFor(input: K): ResourceEntry<K, V> {
    const key = options.key(input)
    let entry = entries.get(key)
    if (!entry) {
      entry = {
        input,
        state: createStore<ResourceSnapshot<V>>(undefined),
        expires: 0,
        subscribers: 0,
      }
      entries.set(key, entry)
      trim(key)
    } else {
      entry.input = input
      entries.delete(key)
      entries.set(key, entry)
    }
    return entry
  }
  function drain() {
    while (active < concurrency && queue.length) {
      const run = queue.shift()
      if (!run) break
      active++
      runInBackground(
        run().finally(() => {
          active--
          drain()
          trim()
        }),
        'resource-cache background operation failed',
      )
    }
  }
  function ensure(input: K): Promise<void> {
    const entry = entryFor(input)
    if (entry.task) return entry.task
    if (entry.expires > now()) return Promise.resolve()
    const { promise, resolve: finish } = Promise.withResolvers<void>()
    entry.task = promise
    const task = entry.task
    const run = async () => {
      entry.cancelQueued = undefined
      try {
        const value = await options.load(entry.input)
        entry.state.set({ status: 'ready', value })
        entry.expires = now() + (options.ttlMs ?? 5 * 60_000)
      } catch (error) {
        entry.state.set({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
        entry.expires = now() + (options.retryMs ?? 30_000)
      } finally {
        entry.task = undefined
        finish()
      }
    }
    entry.cancelQueued = () => {
      const index = queue.indexOf(run)
      if (index < 0) return
      queue.splice(index, 1)
      entry.cancelQueued = undefined
      entry.task = undefined
      finish()
    }
    queue.push(run)
    drain()
    return task
  }
  function refreshSubscribed(): void {
    for (const entry of [...entries.values()])
      if (entry.subscribers && entry.expires <= now())
        runInBackground(ensure(entry.input), 'resource-cache background operation failed')
  }
  return {
    snapshot(input: K): ResourceSnapshot<V> {
      return entries.get(options.key(input))?.state.get()
    },
    subscribe(input: K, listener: () => void): () => void {
      const entry = entryFor(input)
      entry.subscribers++
      subscribers++
      if (!refreshTimer) {
        refreshTimer = setInterval(refreshSubscribed, 30_000)
        refreshTimer.unref?.()
      }
      const unsubscribe = entry.state.subscribe(listener)
      return () => {
        unsubscribe()
        entry.subscribers--
        subscribers--
        if (!entry.subscribers) entry.cancelQueued?.()
        if (!subscribers && refreshTimer) {
          clearInterval(refreshTimer)
          refreshTimer = undefined
        }
        trim()
      }
    },
    ensure,
    refreshSubscribed,
    size: () => entries.size,
  }
}
