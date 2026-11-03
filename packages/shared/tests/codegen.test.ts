import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { checkGeneratedYouTube, generateProtobuf } from '../youtube/codegen/generate'
import { assertGeneratedSources } from '../youtube/codegen/guard'

test('production and recursive fixture sources regenerate deterministically through the pinned plugin', async () => {
  await checkGeneratedYouTube()
  const temporary = await mkdtemp(join(tmpdir(), 'twirchat-proto-fixture-'))
  try {
    const root = resolve(import.meta.dir, 'fixtures')
    const actual = await generateProtobuf(root, temporary)
    const expectedFiles = await Array.fromAsync(
      new Bun.Glob('**/*.ts').scan({ cwd: resolve(root, 'gen'), onlyFiles: true }),
    )
    const actualFiles = await Array.fromAsync(
      new Bun.Glob('**/*.ts').scan({ cwd: actual, onlyFiles: true }),
    )
    expect(actualFiles.toSorted()).toEqual(expectedFiles.toSorted())
    await Promise.all(
      expectedFiles.map(async (file) => {
        const [expected, generated] = await Promise.all([
          Bun.file(resolve(root, 'gen', file)).text(),
          Bun.file(resolve(actual, file)).text(),
        ])
        expect(generated).toBe(expected)
      }),
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 30000)

test.each([
  'export const value = 1 as const',
  'export const value = <number>1',
  'export const value: any = 1',
  'export const value: string | undefined = undefined\nvalue!.length',
  '// eslint-disable\nexport const value = 1 as number',
])('generation AST guard rejects unsafe TypeScript: %s', async (source) => {
  const temporary = await mkdtemp(join(tmpdir(), 'twirchat-proto-guard-'))
  try {
    const file = join(temporary, 'unsafe.ts')
    await Bun.write(file, source)
    await expect(assertGeneratedSources([file])).rejects.toThrow(/assertion-free|suppression/u)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('generation AST guard accepts ordinary strings and import/export aliases', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'twirchat-proto-guard-'))
  try {
    const file = join(temporary, 'safe.ts')
    await Bun.write(file, 'const value = "as const"\nexport { value as named }')
    await expect(assertGeneratedSources([file])).resolves.toBeUndefined()
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  await expect(assertGeneratedSources([])).rejects.toThrow('No generated')
})

test('prepared generator dependencies rebind after the original worktree disappears', async () => {
  const { mkdir, realpath } = await import('node:fs/promises')
  const { ensureGeneratorDependencies } = await import('../youtube/codegen/prepare')
  const temporary = await mkdtemp(join(tmpdir(), 'twirchat-proto-dependencies-'))
  try {
    const checkout = join(temporary, 'checkout')
    const previous = join(temporary, 'old-worktree')
    const current = join(temporary, 'current-worktree')
    await Promise.all([mkdir(checkout), mkdir(previous), mkdir(current)])
    await ensureGeneratorDependencies(checkout, previous)
    expect(await realpath(join(checkout, 'node_modules'))).toBe(await realpath(previous))
    await rm(previous, { recursive: true })
    await ensureGeneratorDependencies(checkout, current)
    expect(await realpath(join(checkout, 'node_modules'))).toBe(await realpath(current))
    await ensureGeneratorDependencies(checkout, current)
    expect(await realpath(join(checkout, 'node_modules'))).toBe(await realpath(current))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
