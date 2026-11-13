import { expect, test } from 'bun:test'

import type { EventPayload } from '@gpuix/react'

import {
  armMessageRowDrag,
  claimMessageRowClick,
  claimMessageRowContextMenu,
  isMessageRowContextMenu,
  isMessageRowDoubleClick,
} from '../src/gpuix/message-row-click'

function click(overrides: Partial<EventPayload> = {}): EventPayload {
  return { elementId: 1, eventType: 'click', x: 40, y: 12, button: 0, clickCount: 2, ...overrides }
}

function rightPress(overrides: Partial<EventPayload> = {}): EventPayload {
  return {
    elementId: 1,
    eventType: 'mouseDown',
    x: 40,
    y: 12,
    button: 2,
    clickCount: 1,
    ...overrides,
  }
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

test('a child claims an ordinary release', () => {
  expect(claimMessageRowClick(click({ clickCount: 1 }))).toBe(true)
})

test('a release that reaches a child during a row drag cancels the drag instead', () => {
  let cancelled = 0
  armMessageRowDrag(() => cancelled++)
  expect(claimMessageRowClick(click({ clickCount: 1 }))).toBe(false)
  expect(cancelled).toBe(1)
  expect(claimMessageRowClick(click({ clickCount: 1 }))).toBe(true)
  expect(cancelled).toBe(1)
})

test('a disarmed row drag leaves the next release to the child', () => {
  let cancelled = 0
  const disarm = armMessageRowDrag(() => cancelled++)
  disarm()
  expect(claimMessageRowClick(click({ clickCount: 1 }))).toBe(true)
  expect(cancelled).toBe(0)
})

test('a stale disarm does not drop a newer row drag', () => {
  let newer = 0
  const disarmOlder = armMessageRowDrag(() => undefined)
  armMessageRowDrag(() => newer++)
  disarmOlder()
  expect(claimMessageRowClick(click({ clickCount: 1 }))).toBe(false)
  expect(newer).toBe(1)
})

test('an author name claims its secondary press so the row menu stays closed', () => {
  claimMessageRowContextMenu(rightPress({ elementId: 7 }))
  expect(isMessageRowContextMenu(rightPress())).toBe(false)
  expect(isMessageRowContextMenu(rightPress())).toBe(true)
})

test('a stale secondary-press claim at another point leaves the next row menu available', () => {
  claimMessageRowContextMenu(rightPress({ x: 300, y: 90 }))
  expect(isMessageRowContextMenu(rightPress())).toBe(true)
})
