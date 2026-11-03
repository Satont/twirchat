/** Modules declare each hot-reload resource's exact type beside its owner. */
export interface PersistentResources {}

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
