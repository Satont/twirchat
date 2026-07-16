import { expect, test } from 'bun:test'
import { CHAT_BOTTOM_TOLERANCE, isChatNearBottom } from '../src/views/main/utils/chat-scroll'

test('keeps following messages while the viewport is within the bottom tolerance', () => {
  expect(CHAT_BOTTOM_TOLERANCE).toBe(64)
  expect(isChatNearBottom(1_000, 736, 200)).toBe(true)
  expect(isChatNearBottom(1_000, 780, 200)).toBe(true)
})

test('shows the latest-message control after the reader moves away from the bottom', () => {
  expect(isChatNearBottom(1_000, 735, 200)).toBe(false)
})
