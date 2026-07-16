import { expect, test } from 'bun:test'

const source = await Bun.file(
  new URL('../src/views/main/components/ChatInput.vue', import.meta.url),
).text()

test('shows non-connected home channels beside the composer even when labels are hidden', () => {
  expect(source).toContain('const homeConnectionStatuses')
  expect(source).toContain('!watchedChannel && homeConnectionStatuses.length > 0')
  expect(source).toContain('v-for="p in homeConnectionStatuses"')
})
