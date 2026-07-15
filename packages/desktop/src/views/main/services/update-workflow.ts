export interface UpdateCheckResult {
  currentVersion: string
  updateAvailable: boolean
  version?: string
}

export interface UpdateCheckSource {
  checkForUpdate(): Promise<UpdateCheckResult>
}

export function checkForAvailableUpdate(source: UpdateCheckSource): Promise<UpdateCheckResult> {
  return source.checkForUpdate()
}
