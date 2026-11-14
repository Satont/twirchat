import { expect, test } from 'bun:test'

import { describeTabCounts, formatTabViewers } from '../src/gpuix/tab-counts'

test('tab viewer totals retain compact labels through rounding and large-count boundaries', () => {
  const counts = [
    0,
    9,
    10,
    99,
    999,
    1000,
    61500,
    99949,
    99950,
    99999,
    999499,
    999500,
    999949,
    999950,
    1000000,
    999950000,
    1e12,
    Number.MAX_SAFE_INTEGER,
  ]
  expect(counts.map(formatTabViewers)).toEqual([
    '0',
    '9',
    '10',
    '99',
    '999',
    '1.0K',
    '61.5K',
    '99.9K',
    '100K',
    '100K',
    '999K',
    '1.0M',
    '1.0M',
    '1.0M',
    '1.0M',
    '1.0B',
    '1.0T',
    '999T+',
  ])
  expect(counts.every((count) => formatTabViewers(count).length <= 5)).toBe(true)
})

test('tab count descriptions retain exact viewer, unread and mention totals', () => {
  expect(describeTabCounts(61500, { unread: 1000, mentions: 999 })).toBe(
    '61,500 viewers · 1,000 unread messages · 999 mentions',
  )
  expect(describeTabCounts(undefined, undefined)).toBe('')
})
