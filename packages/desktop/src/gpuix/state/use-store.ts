import { useSyncExternalStore } from 'react'

import type { Store } from '../../state/create-store'

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
