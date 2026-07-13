import { expect, test } from 'bun:test'

const source = await Bun.file(
  new URL('../src/views/main/components/ChatMessage.vue', import.meta.url),
).text()

test('compact timestamp reserves stable time width', () => {
  expect(source).toContain('.msg-compact .compact-time {')
  expect(source).toMatch(/\.msg-compact \.compact-time \{[^}]*display: inline-block;/s)
  expect(source).toMatch(/\.msg-compact \.compact-time \{[^}]*width: 8ch;/s)
  expect(source).toMatch(/\.msg-compact \.compact-time \{[^}]*font-variant-numeric: tabular-nums;/s)
})
