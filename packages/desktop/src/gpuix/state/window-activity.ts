import type { EventModifiers } from '@gpuix/react'

import type { Store } from './create-store'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

export interface WindowActivity {
  active: boolean
  modifiers: Partial<EventModifiers>
}
export const windowActivityStore = persistentResource('windowActivity', () =>
  createStore<Map<string, WindowActivity>>(new Map()),
)
export function updateWindowActivity(
  scope: string,
  active: boolean,
  modifiers?: Partial<EventModifiers>,
): void {
  const previous = windowActivityStore.get().get(scope)
  const nextModifiers = active ? (modifiers ?? previous?.modifiers ?? {}) : {}
  if (
    previous?.active === active &&
    (['ctrl', 'shift', 'alt', 'cmd'] satisfies (keyof EventModifiers)[]).every(
      (key) => !!previous.modifiers[key] === !!nextModifiers[key],
    )
  )
    return
  windowActivityStore.modify((entries) =>
    new Map(entries).set(scope, { active, modifiers: nextModifiers }),
  )
}
export function clearWindowActivity(scope: string): void {
  windowActivityStore.modify((entries) => {
    const next = new Map(entries)
    next.delete(scope)
    return next
  })
}

declare module './persistent-resources' {
  interface PersistentResources {
    windowActivity: Store<Map<string, WindowActivity>>
  }
}
