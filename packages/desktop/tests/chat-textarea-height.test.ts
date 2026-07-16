import { expect, test } from 'bun:test'
import {
  CHAT_TEXTAREA_MAX_HEIGHT,
  CHAT_TEXTAREA_MIN_HEIGHT,
  textareaHeight,
} from '../src/views/main/utils/chat-textarea'

test('keeps a one-line textarea at the stable control height', () => {
  expect(textareaHeight(12)).toBe(CHAT_TEXTAREA_MIN_HEIGHT)
})

test('grows with new lines until it reaches the composer cap', () => {
  expect(textareaHeight(72)).toBe(72)
  expect(textareaHeight(240)).toBe(CHAT_TEXTAREA_MAX_HEIGHT)
})
