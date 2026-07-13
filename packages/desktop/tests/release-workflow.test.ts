import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('macOS release builds embedded main assets before the app bundle', async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, '../../../.github/workflows/release.yml'),
  ).text()

  expect(workflow).toMatch(
    /name: Build macOS application bundle[\s\S]*bun run build:main[\s\S]*test -f "dist\/main\/index\.html"[\s\S]*go build/,
  )
})
