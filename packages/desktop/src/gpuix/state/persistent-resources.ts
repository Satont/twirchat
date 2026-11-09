/** Modules declare each hot-reload resource's exact type beside its owner. */
import type { Language } from '@twirchat/shared/types'

import type { Store } from './create-store'

export interface PersistentResources {
  /** UI language survives `bun --hot` remounts until settings reload it. */
  language: Store<Language>
}

declare global {
  var __twirchatGpuixResources: Partial<PersistentResources> | undefined
}

export function persistentResource<K extends keyof PersistentResources>(
  key: K,
  create: () => NoInfer<PersistentResources[K]>,
): PersistentResources[K] {
  const resources = (globalThis.__twirchatGpuixResources ??= {})
  const existing = resources[key]
  if (existing !== undefined) return existing
  const value = create()
  resources[key] = value
  return value
}
