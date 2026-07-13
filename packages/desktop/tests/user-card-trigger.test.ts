import { expect, test } from 'bun:test'

const source = await Bun.file(
  new URL('../src/views/main/components/UserContextMenu.vue', import.meta.url),
).text()

test('opens the user card with a primary click', () => {
  expect(source).toContain('@click="openDialog"')
  expect(source).not.toContain('@contextmenu')
})
