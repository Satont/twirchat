import type { ActionClickEvent } from './types'

export interface ToastBox {
  x: number
  y: number
  width: number
  height: number
}

export interface ToastPlacement {
  left: number
  top: number
}

export const TOAST_HEIGHT = 36

const TOAST_FONT_SIZE = 12
const TOAST_SIDE_INSET = 8
const TOAST_MIN_WIDTH = 60
const TOAST_MAX_WIDTH = 320
const TOAST_GAP = 8
const AVG_CHAR_WIDTH = TOAST_FONT_SIZE * 0.58

/** GPUIX has no text-measurement API, so size follows the message length. */
export function toastWidth(message: string): number {
  const estimated = message.length * AVG_CHAR_WIDTH + TOAST_SIDE_INSET * 2
  return Math.round(Math.min(Math.max(estimated, TOAST_MIN_WIDTH), TOAST_MAX_WIDTH))
}

/** Places the toast above the clicked point, using the wrapper's painted layout box. */
export function placeToast(
  box: ToastBox,
  message: string,
  click?: ActionClickEvent,
): ToastPlacement {
  const width = toastWidth(message)
  const localX = (click?.x ?? box.x + box.width / 2) - box.x
  const localY = (click?.y ?? box.y) - box.y
  const left = Math.max(0, Math.min(localX - width / 2, box.width - width))
  const above = localY - TOAST_HEIGHT - TOAST_GAP
  return { left, top: above >= 0 ? above : localY + TOAST_GAP }
}
