import { describe, expect, test } from 'bun:test'

import { formatNote } from '../src/gpuix/components/user-card/note-format'
import { parseNoteMarkdown } from '../src/gpuix/components/user-card/note-markdown'

describe('user note formatting toolbar', () => {
  test('inserts inline snippets with a separator', () => {
    expect(formatNote('hello', 'bold')).toBe('hello **bold text**')
    expect(formatNote('hello', 'strike')).toBe('hello ~~strikethrough text~~')
    expect(formatNote('hello', 'code')).toBe('hello `code`')
  })

  test('inserts block snippets on a new line', () => {
    expect(formatNote('hello', 'list')).toBe('hello\n- list item')
    expect(formatNote('hello\n', 'quote')).toBe('hello\n> quote')
  })

  test('generated snippets render as the expected markdown', () => {
    const note = [formatNote('', 'bold'), formatNote('', 'strike'), formatNote('', 'list')].join(
      '\n',
    )
    const lines = parseNoteMarkdown(note)
    expect(lines.some((line) => line.content.some((part) => part.style === 'strong'))).toBe(true)
    expect(lines.some((line) => line.content.some((part) => part.style === 'strike'))).toBe(true)
    expect(lines.some((line) => line.kind === 'list')).toBe(true)
  })
})
