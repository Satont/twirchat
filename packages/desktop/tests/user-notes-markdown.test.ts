import { expect, test } from 'bun:test'

import { parseNoteMarkdown, parseNoteInline } from '../src/gpuix/components/user-card/note-markdown'
import { required } from './fixture-values'

test('native note preview supports headings, inline emphasis, links, lists and literal code', () => {
  const lines = parseNoteMarkdown(
    '# Heading\n**Bold** and *soft* and `code`\n- List\n> Quote\n```ts\n<script>literal</script> **unchanged**\n```\n[Profile](https://example.org/user)',
  )
  expect(lines.map((line) => line.kind)).toEqual([
    'heading',
    'paragraph',
    'list',
    'quote',
    'code',
    'paragraph',
  ])
  expect(required(lines[1]).content).toContainEqual({ text: 'Bold', style: 'strong' })
  expect(required(lines[1]).content).toContainEqual({ text: 'soft', style: 'emphasis' })
  expect(required(lines[4]).content).toEqual([{ text: '<script>literal</script> **unchanged**' }])
  expect(required(lines[5]).content).toEqual([
    { text: 'Profile', style: 'link', url: 'https://example.org/user' },
  ])
})
test('Markdown never interprets raw HTML, unsafe link schemes or incomplete syntax', () => {
  const source = '<img src=x> [unsafe](javascript:alert(1)) **open'
  expect(parseNoteInline(source)).toEqual([{ text: source }])
  expect(required(required(parseNoteMarkdown('\n')[0]).content[0]).text).toBe(' ')
})
