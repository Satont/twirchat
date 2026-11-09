export interface PendingChangelog {
  version: string
  releaseNotes: string
  publishedAt: string
}

interface PendingChangelogOptions {
  preview?: boolean
}

interface ReleaseNotesSource {
  getLastSeenVersion(): Promise<string | null>
  getReleaseNotes(params: {
    version: string
  }): Promise<{ version: string; releaseNotes: string; publishedAt: string } | null>
  setLastSeenVersion(params: { version: string }): Promise<void>
}

export async function loadPendingChangelog(
  currentVersion: string,
  api: ReleaseNotesSource,
  options: PendingChangelogOptions = {},
): Promise<PendingChangelog | null> {
  if (currentVersion === 'dev') return null

  if (!options.preview) {
    const lastSeen = await api.getLastSeenVersion()
    if (lastSeen === currentVersion) return null
  }

  const notes = await api.getReleaseNotes({ version: currentVersion })
  if (!notes?.releaseNotes) return null

  if (!options.preview) await api.setLastSeenVersion({ version: currentVersion })
  return {
    version: notes.version,
    releaseNotes: notes.releaseNotes,
    publishedAt: notes.publishedAt,
  }
}
