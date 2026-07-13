export interface UpdateCapabilitySource {
  capabilities(): Promise<{ updates: boolean }>
}

// The initial Wails release deliberately has no updater implementation.
export async function shouldCheckForUpdates(source: UpdateCapabilitySource): Promise<boolean> {
  return (await source.capabilities()).updates
}
