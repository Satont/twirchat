/**
 * Minimal observable store for the GPUIX UI.
 *
 * Pinia is Vue-only and zustand would pull a dependency whose semantics we
 * don't control; this is a few dozen lines and does exactly what the app
 * needs.
 *
 * IMPORTANT: listener notification is deferred to a coalesced macrotask
 * (`setTimeout(0)`). `useSyncExternalStore` re-renders SYNCHRONOUSLY when
 * notified, so notifying inside a GPUI event callback (a click that updates a
 * store) makes React commit → `applyBatch` while the GPUI view is still being
 * updated, which panics the Rust side ("cannot update GpuixView while it is
 * already being updated"). A microtask is NOT enough: napi invokes the event
 * handler synchronously from inside the view update, and microtasks drain
 * before the JS stack unwinds. A timer escapes both.
 */

import { useSyncExternalStore } from 'react'

export interface Store<T> {
  get(): T
  set(next: T | ((prev: T) => T)): void
  update(patch: Partial<T>): void
  subscribe(listener: () => void): () => void
}

let flushScheduled = false
const pendingListeners = new Set<() => void>()

function scheduleNotification(listener: () => void): void {
  pendingListeners.add(listener)
  if (flushScheduled) return
  flushScheduled = true
  setTimeout(() => {
    flushScheduled = false
    const batch = [...pendingListeners]
    pendingListeners.clear()
    for (const fn of batch) fn()
  }, 0)
}

export function createStore<T>(initial: T, persistKey?: string): Store<T> {
  // Desktop `bun --hot` re-evaluates the whole module graph on every save, so
  // module-level stores would reset to their initial value. Pin named stores
  // on globalThis: the second evaluation returns the SAME store instance with
  // all its state (the backend singleton works the same way).
  if (persistKey) {
    const registry = storeRegistry()
    const existing = registry.get(persistKey)
    if (existing) return existing as Store<T>
    const created = buildStore(initial)
    registry.set(persistKey, created as Store<unknown>)
    return created
  }
  return buildStore(initial)
}

const REGISTRY_KEY = '__twirchatGpuixStores'

interface StoreRegistryGlobal {
  [REGISTRY_KEY]?: Map<string, Store<unknown>>
}

function storeRegistry(): Map<string, Store<unknown>> {
  const g = globalThis as StoreRegistryGlobal
  g[REGISTRY_KEY] ??= new Map()
  return g[REGISTRY_KEY]
}

function buildStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()

  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next
      if (Object.is(value, state)) return
      state = value
      for (const listener of [...listeners]) scheduleNotification(listener)
    },
    update(patch) {
      this.set({ ...(state as object), ...patch } as T)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Subscribe a component to the whole store value. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/**
 * Subscribe to a derived slice. The selector must return a stable value
 * (primitive or memoized reference) — objects recreated per call cause
 * re-render loops.
 */
export function useStoreSelector<T, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  )
}
