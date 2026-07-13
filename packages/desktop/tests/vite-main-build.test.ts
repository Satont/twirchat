import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('main build includes Wails assets and the embedding sentinel', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'twirchat-vite-main-'))

  try {
    const build = Bun.spawn(['bun', 'run', 'build:main', '--', '--outDir', outputDir], {
      cwd: resolve(import.meta.dir, '..'),
      stderr: 'inherit',
      stdout: 'inherit',
    })

    expect(await build.exited).toBe(0)

    const expectedFiles = ['index.html', 'fonts/inter.css', 'fonts/manrope.css', '.gitkeep']
    const exists = await Promise.all(
      expectedFiles.map((file) => Bun.file(join(outputDir, file)).exists()),
    )
    expect(exists).toEqual([true, true, true, true])
  } finally {
    await rm(outputDir, { force: true, recursive: true })
  }
})
