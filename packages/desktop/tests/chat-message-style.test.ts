import { expect, test } from 'bun:test'

import { chatMessageStyle } from '../src/views/main/utils/chat-message-style'

test('scales badge geometry with the configured chat font size', () => {
  expect(chatMessageStyle(14)).toEqual({
    '--badge-size': '16px',
    '--font-size': '14px',
    '--platform-icon-size': '12px',
  })
  expect(chatMessageStyle(20)).toEqual({
    '--badge-size': '23px',
    '--font-size': '20px',
    '--platform-icon-size': '17px',
  })
})

test('keeps badges legible at the smallest supported chat font size', () => {
  expect(chatMessageStyle(10)).toEqual({
    '--badge-size': '12px',
    '--font-size': '10px',
    '--platform-icon-size': '9px',
  })
})
