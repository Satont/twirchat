import { expect, test } from 'bun:test'

import { formatTabMentions } from '../src/gpuix/tab-counts'

test('tab mention badges appear only for positive counts and cap at 99+', () => {
  expect(formatTabMentions(0)).toBe('')
  expect(formatTabMentions(1)).toBe('1')
  expect(formatTabMentions(99)).toBe('99')
  expect(formatTabMentions(100)).toBe('99+')
  expect(formatTabMentions(1000)).toBe('99+')
})
