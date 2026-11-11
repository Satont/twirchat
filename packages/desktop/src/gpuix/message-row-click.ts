import type { EventPayload } from '@gpuix/react'

/**
 * GPUIX delivers `click` as a bubbling mouse-up without propagation control:
 * a click on a link, name or button inside a chat row reaches the row too,
 * child first and in the same native dispatch. Interactive children claim
 * their release so the row's double-click reply leaves it alone.
 */
interface ClickIdentity {
  readonly x: number | undefined
  readonly y: number | undefined
  readonly clickCount: number | undefined
}

let claimed: ClickIdentity | null = null

export function claimMessageRowClick(event: EventPayload): void {
  claimed = { x: event.x, y: event.y, clickCount: event.clickCount }
}

/** True for an unclaimed primary double-click; consumes the matching claim either way. */
export function isMessageRowDoubleClick(event: EventPayload): boolean {
  const claim = claimed
  if (
    claim &&
    claim.x === event.x &&
    claim.y === event.y &&
    claim.clickCount === event.clickCount
  ) {
    claimed = null
    return false
  }
  return (event.button ?? 0) === 0 && event.isRightClick !== true && event.clickCount === 2
}
