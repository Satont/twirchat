import type { DesktopEventMap } from './backend/events'

type UpdateStatus = DesktopEventMap['update_status']

export interface UpdateToastState {
  update: UpdateStatus | null
  /** The release the user closed the toast for; later news about it stays hidden. */
  dismissed: { hash: string | undefined } | null
}

export const initialUpdateToastState: UpdateToastState = { update: null, dismissed: null }

export function nextUpdateToastState(
  current: UpdateToastState,
  status: UpdateStatus,
): UpdateToastState {
  if (status.status === 'idle') return initialUpdateToastState
  // A manual check or a different release shows the toast again; background progress,
  // completion and errors for the closed release do not.
  const staysDismissed =
    current.dismissed !== null &&
    status.status !== 'checking' &&
    (status.hash === undefined || status.hash === current.dismissed.hash)
  return { update: status, dismissed: staysDismissed ? current.dismissed : null }
}

export const dismissUpdateToast = (current: UpdateToastState): UpdateToastState => ({
  ...current,
  dismissed: { hash: current.update?.hash },
})
