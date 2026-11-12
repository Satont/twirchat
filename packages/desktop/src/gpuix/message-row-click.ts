import type { EventPayload } from '@gpuix/react'

/**
 * GPUIX delivers `click` as a bubbling mouse-up without propagation control:
 * a click on a link, name or button inside a chat row reaches the row too,
 * child first and in the same native dispatch. Interactive children claim
 * their release so the row's double-click reply leaves it alone.
 *
 * `click` also ignores where the press began. A row drag (the moderation rail)
 * that loses its pointer capture never sees its release, which then lands on
 * whatever child is under the pointer. Claiming that release ends the drag
 * instead of activating the child.
 */
interface ClickIdentity {
  readonly x: number | undefined
  readonly y: number | undefined
  readonly clickCount: number | undefined
}

let claimed: ClickIdentity | null = null
let armedDrag: (() => void) | null = null

/** Arms a row drag until the returned disarm runs; a stray release cancels it. */
export function armMessageRowDrag(cancel: () => void): () => void {
  armedDrag = cancel
  return () => {
    if (armedDrag === cancel) armedDrag = null
  }
}

/**
 * Claims a release for an interactive child. False when the release belongs to
 * an armed row drag: the drag is cancelled and the child must not act.
 */
export function claimMessageRowClick(event: EventPayload): boolean {
  claimed = { x: event.x, y: event.y, clickCount: event.clickCount }
  const cancelDrag = armedDrag
  if (!cancelDrag) return true
  armedDrag = null
  cancelDrag()
  return false
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
