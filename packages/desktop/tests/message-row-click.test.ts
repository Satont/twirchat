import { expect, test } from 'bun:test'

import type { EventPayload } from '@gpuix/react'

import { claimMessageRowClick, isMessageRowDoubleClick } from '../src/gpuix/message-row-click'

function click(overrides: Partial<EventPayload> = {}): EventPayload {
  return { elementId: 1, eventType: 'click', x: 40, y: 12, button: 0, clickCount: 2, ...overrides }
}

test('a primary double-click on the row starts a reply', () => {
  expect(isMessageRowDoubleClick(click())).toBe(true)
})

test('single, triple, right and middle clicks do not start a reply', () => {
  expect(isMessageRowDoubleClick(click({ clickCount: 1 }))).toBe(false)
  expect(isMessageRowDoubleClick(click({ clickCount: 3 }))).toBe(false)
  expect(isMessageRowDoubleClick(click({ button: 2, isRightClick: true }))).toBe(false)
  expect(isMessageRowDoubleClick(click({ button: 1 }))).toBe(false)
})

test('a release claimed by a link, name or button is skipped once', () => {
  claimMessageRowClick(click({ elementId: 7 }))
  expect(isMessageRowDoubleClick(click())).toBe(false)
  expect(isMessageRowDoubleClick(click())).toBe(true)
})

test('a stale claim at another point does not block the next row double-click', () => {
  claimMessageRowClick(click({ x: 300, y: 90 }))
  expect(isMessageRowDoubleClick(click())).toBe(true)
})
