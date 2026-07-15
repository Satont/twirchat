export interface UpdateCapabilitySource {
  capabilities(): Promise<{ updates: boolean }>
}

export async function shouldCheckForUpdates(
  source: UpdateCapabilitySource,
  automaticallyEnabled = true,
): Promise<boolean> {
  if (!automaticallyEnabled) {
    return false
  }

  return (await source.capabilities()).updates
}
