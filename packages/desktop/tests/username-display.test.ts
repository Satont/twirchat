import { describe, expect, test } from 'bun:test'

import {
  formatChatAuthorName,
  MAX_NAME_GRAPHEMES,
  PREVIEW_LOCALIZED_AUTHOR,
} from '../src/gpuix/username-display'

describe('formatChatAuthorName', () => {
  test('formats localized display names across all three modes', () => {
    const author = { displayName: 'テスト', username: 'viewer42' }

    expect(formatChatAuthorName(author)).toBe('テスト (viewer42)')
    expect(formatChatAuthorName(author, 'localized-and-username')).toBe('テスト (viewer42)')
    expect(formatChatAuthorName(author, 'localized')).toBe('テスト')
    expect(formatChatAuthorName(author, 'username')).toBe('viewer42')
  })

  test('does not duplicate non-localized names that differ only in casing', () => {
    const author = { displayName: 'Satont', username: 'satont' }

    expect(formatChatAuthorName(author, 'localized-and-username')).toBe('Satont')
    expect(formatChatAuthorName(author, 'localized')).toBe('Satont')
    expect(formatChatAuthorName(author, 'username')).toBe('Satont')
  })

  test('handles identical display name and username on fast path', () => {
    const author = { displayName: 'nightbot', username: 'nightbot' }

    expect(formatChatAuthorName(author, 'localized-and-username')).toBe('nightbot')
    expect(formatChatAuthorName(author, 'localized')).toBe('nightbot')
    expect(formatChatAuthorName(author, 'username')).toBe('nightbot')
  })

  test('falls back cleanly when username or displayName is missing or blank', () => {
    expect(formatChatAuthorName({ displayName: 'YouTube Author' }, 'localized-and-username')).toBe(
      'YouTube Author',
    )
    expect(formatChatAuthorName({ displayName: 'YouTube Author' }, 'username')).toBe(
      'YouTube Author',
    )
    expect(
      formatChatAuthorName({ displayName: '   ', username: 'fallback_login' }, 'localized'),
    ).toBe('fallback_login')
    expect(formatChatAuthorName({ displayName: 'テスト', username: '   ' }, 'username')).toBe(
      'テスト',
    )
  })

  test('prefers non-empty custom aliases over every username display mode', () => {
    const author = { displayName: '하늘', username: 'haneul' }

    expect(formatChatAuthorName(author, 'localized-and-username', 'My Friend')).toBe('My Friend')
    expect(formatChatAuthorName(author, 'localized', 'My Friend')).toBe('My Friend')
    expect(formatChatAuthorName(author, 'username', 'My Friend')).toBe('My Friend')
    expect(formatChatAuthorName(author, 'localized-and-username', '   ')).toBe('하늘 (haneul)')
  })

  test('sanitizes hostile text and clamps each part without cutting the closing parenthesis', () => {
    const longLocalized = 'あ'.repeat(40)
    const longLogin = 'a'.repeat(40)
    const formatted = formatChatAuthorName(
      { displayName: `${longLocalized}\nline`, username: `${longLogin}\tuser` },
      'localized-and-username',
    )

    expect(formatted).toBe(
      `${'あ'.repeat(MAX_NAME_GRAPHEMES)}… (${'a'.repeat(MAX_NAME_GRAPHEMES)}…)`,
    )
  })

  test('preview sample author demonstrates all three modes distinctly', () => {
    const combined = formatChatAuthorName(PREVIEW_LOCALIZED_AUTHOR, 'localized-and-username')
    const localized = formatChatAuthorName(PREVIEW_LOCALIZED_AUTHOR, 'localized')
    const username = formatChatAuthorName(PREVIEW_LOCALIZED_AUTHOR, 'username')

    expect(new Set([combined, localized, username]).size).toBe(3)
    expect(combined).toBe(`${localized} (${username})`)
  })
})
