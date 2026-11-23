import { describe, expect, test } from 'bun:test'

import { reasonMenuWidth } from '../src/gpuix/components/user-card-dialog/actions/reason-menu-width'

describe('reason menu width', () => {
  test('follows the longest option', () => {
    expect(reasonMenuWidth(['Spam', 'Harassment and hate speech'])).toBeGreaterThan(
      reasonMenuWidth(['Spam']),
    )
  })

  test('does not grow with the number of options', () => {
    expect(reasonMenuWidth(['Spam', 'Harassment and hate speech'])).toBe(
      reasonMenuWidth(['Spam', 'Harassment and hate speech', 'Hate', 'Scam']),
    )
  })

  test('stays within bounds', () => {
    expect(reasonMenuWidth([])).toBe(120)
    expect(reasonMenuWidth(['x'.repeat(1000)])).toBe(320)
  })
})
