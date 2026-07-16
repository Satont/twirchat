import { expect, test } from 'bun:test'
import {
  CHAT_TEXTAREA_MAX_HEIGHT,
  CHAT_TEXTAREA_MIN_HEIGHT,
  textareaHeight,
  textareaHeightBounds,
} from '../src/views/main/utils/chat-textarea'

const chatInputSource = await Bun.file(
  new URL('../src/views/main/components/ChatInput.vue', import.meta.url),
).text()

type DynamicHeightCalculator = (
  scrollHeight: number,
  bounds: { minHeight: number; maxHeight: number },
) => number

test('keeps a one-line textarea at the stable control height', () => {
  expect(textareaHeight(12)).toBe(CHAT_TEXTAREA_MIN_HEIGHT)
})

test('grows with new lines until it reaches the composer cap', () => {
  expect(textareaHeight(72)).toBe(72)
  expect(textareaHeight(240)).toBe(CHAT_TEXTAREA_MAX_HEIGHT)
})

test('uses the measured one-line and five-line bounds instead of a fixed control height', () => {
  const resize = textareaHeight as unknown as DynamicHeightCalculator
  const bounds = { minHeight: 37.5, maxHeight: 115.5 }

  expect(resize(12, bounds)).toBe(bounds.minHeight)
  expect(resize(240, bounds)).toBe(bounds.maxHeight)
})

test('derives one and five visible lines from rendered line, padding, and border metrics', () => {
  expect(
    textareaHeightBounds({
      borderBottomWidth: '1px',
      borderTopWidth: '1px',
      lineHeight: '19.5px',
      paddingBottom: '8px',
      paddingTop: '8px',
    }),
  ).toEqual({ minHeight: 37.5, maxHeight: 115.5 })
})

test('measures the textarea from its rendered CSS metrics before resizing', () => {
  expect(chatInputSource).toContain('textareaHeightBounds(getComputedStyle(el))')
})
