import { describe, expect, test } from 'bun:test'

import {
  placeToast,
  TOAST_HEIGHT,
  toastWidth,
  type ToastBox,
} from '../src/gpuix/components/action-toast/toast-placement'
import type { ActionClickEvent } from '../src/gpuix/components/action-toast/types'

const box: ToastBox = { x: 100, y: 50, width: 400, height: 300 }
const message = 'CLICK'

function click(x: number, y: number): ActionClickEvent {
  return { elementId: 1, eventType: 'click', x, y }
}

describe('action toast placement', () => {
  test('width follows the message length within bounds', () => {
    expect(toastWidth('')).toBe(60)
    expect(toastWidth('a much longer toast message')).toBeGreaterThan(toastWidth(message))
    expect(toastWidth('x'.repeat(1000))).toBe(320)
  })

  test('centers above the clicked point using the message width', () => {
    expect(placeToast(box, message, click(300, 200))).toEqual({
      left: 300 - box.x - toastWidth(message) / 2,
      top: 200 - box.y - TOAST_HEIGHT - 8,
    })
  })

  test('clamps to the left and right edges', () => {
    expect(placeToast(box, message, click(110, 200)).left).toBe(0)
    expect(placeToast(box, message, click(10000, 200)).left).toBe(box.width - toastWidth(message))
  })

  test('falls below the cursor when there is no room above', () => {
    expect(placeToast(box, message, click(300, 60)).top).toBe(60 - box.y + 8)
  })

  test('uses the wrapper center and top for keyboard activation', () => {
    expect(placeToast(box, message)).toEqual({
      left: box.width / 2 - toastWidth(message) / 2,
      top: 8,
    })
  })
})
