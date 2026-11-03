import type { Store } from './create-store'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

export type WindowVisibility = 'visible' | 'hidden' | 'unknown'

export interface WindowVisibilitySnapshot {
  initialized: boolean
  windows: ReadonlyMap<string, WindowVisibility>
}

export const windowVisibilityStore = persistentResource('windowVisibility', () =>
  createStore<WindowVisibilitySnapshot>({ initialized: false, windows: new Map() }),
)
const readers = persistentResource(
  'windowVisibilityReaders',
  () => new Map<string, () => WindowVisibility>(),
)

export function registerWindowVisibility(scope: string, read: () => WindowVisibility): () => void {
  const registration = () => read()
  readers.set(scope, registration)
  updateWindowVisibility(scope, 'unknown')
  return () => {
    if (readers.get(scope) !== registration) return
    readers.delete(scope)
    clearWindowVisibility(scope)
  }
}

export function readWindowVisibility(): WindowVisibilitySnapshot {
  let snapshot = windowVisibilityStore.get()
  for (const [scope, read] of readers) {
    let visibility: WindowVisibility
    try {
      visibility = read()
    } catch {
      visibility = 'unknown'
    }
    if (snapshot.windows.get(scope) === visibility) continue
    updateWindowVisibility(scope, visibility)
    snapshot = windowVisibilityStore.get()
  }
  return snapshot
}

export function updateWindowVisibility(scope: string, visibility: WindowVisibility): void {
  windowVisibilityStore.modify((current) => {
    if (current.initialized && current.windows.get(scope) === visibility) return current
    return { initialized: true, windows: new Map(current.windows).set(scope, visibility) }
  })
}

export function clearWindowVisibility(scope: string): void {
  windowVisibilityStore.modify((current) => {
    if (!current.windows.has(scope)) return current
    const windows = new Map(current.windows)
    windows.delete(scope)
    return { initialized: current.initialized, windows }
  })
}

export function canNotifyVisibility(snapshot: WindowVisibilitySnapshot): boolean {
  return snapshot.initialized && [...snapshot.windows.values()].every((state) => state === 'hidden')
}

declare module './persistent-resources' {
  interface PersistentResources {
    windowVisibility: Store<WindowVisibilitySnapshot>
    windowVisibilityReaders: Map<string, () => WindowVisibility>
  }
}
