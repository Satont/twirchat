/**
 * Observable desktop state. Notifications must escape the native event callback:
 * synchronous React commits there re-enter GPUI's active view update.
 * A coalesced macrotask provides that boundary; a microtask does not.
 */

export interface Store<T> {
  get(): T
  set(next: T): void
  modify(update: (prev: T) => T): void
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

export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()

  return {
    get: () => state,
    set(next) {
      if (Object.is(next, state)) return
      state = next
      for (const listener of [...listeners]) scheduleNotification(listener)
    },
    modify(update) {
      this.set(update(state))
    },
    update(patch) {
      this.set({ ...state, ...patch })
    },
    subscribe(listener) {
      let active = true
      const notify = () => {
        if (active) listener()
      }
      listeners.add(notify)
      return () => {
        active = false
        listeners.delete(notify)
        pendingListeners.delete(notify)
      }
    },
  }
}
