import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sweepImageDirectoryOnce } from '../src/services/image-cache-sweep'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const PATTERN = /^[a-f0-9]{32}\.png$/

function cacheDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'twirchat-sweep-'))
  directories.push(directory)
  return directory
}

function writeImage(directory: string, index: number, bytes = 1): string {
  const name = `${index.toString(16).padStart(32, '0')}.png`
  writeFileSync(join(directory, name), Buffer.alloc(bytes, 1))
  // Older index means older file; whole seconds survive every filesystem's mtime precision.
  const time = new Date(Date.UTC(2026, 0, 1, 0, 0, index))
  utimesSync(join(directory, name), time, time)
  return name
}

describe('image cache sweep', () => {
  test('removes the oldest generated files and keeps temporary files and subdirectories', async () => {
    const directory = cacheDirectory()
    const names = Array.from({ length: 6 }, (_, index) => writeImage(directory, index))
    writeFileSync(join(directory, `${names[0]}.1234.tmp`), 'partial')
    mkdirSync(join(directory, 'avatars'))
    await sweepImageDirectoryOnce(directory, { pattern: PATTERN, maxFiles: 4, keepFiles: 3 })
    expect(readdirSync(directory).toSorted()).toEqual(
      [...names.slice(3), `${names[0]}.1234.tmp`, 'avatars'].toSorted(),
    )
  })

  test('enforces the byte budget down to its keep level', async () => {
    const directory = cacheDirectory()
    const names = Array.from({ length: 5 }, (_, index) => writeImage(directory, index, 100))
    await sweepImageDirectoryOnce(directory, {
      pattern: PATTERN,
      maxFiles: 100,
      keepFiles: 100,
      maxBytes: 450,
      keepBytes: 250,
    })
    expect(readdirSync(directory).toSorted()).toEqual(names.slice(3))
  })

  test('never deletes files handed out later in the same process', async () => {
    const directory = cacheDirectory()
    const limits = { pattern: PATTERN, maxFiles: 2, keepFiles: 1 }
    const first = sweepImageDirectoryOnce(directory, limits)
    expect(sweepImageDirectoryOnce(directory, limits)).toBe(first)
    await first
    const names = Array.from({ length: 5 }, (_, index) => writeImage(directory, index))
    await sweepImageDirectoryOnce(directory, limits)
    expect(readdirSync(directory).toSorted()).toEqual(names)
  })

  test('a missing directory resolves without creating it', async () => {
    const directory = join(cacheDirectory(), 'missing')
    await sweepImageDirectoryOnce(directory, { pattern: PATTERN, maxFiles: 0, keepFiles: 0 })
    expect(readdirSync(join(directory, '..'))).toEqual([])
  })

  test('image workers never sweep their parent app directories', async () => {
    const directory = cacheDirectory()
    const names = Array.from({ length: 3 }, (_, index) => writeImage(directory, index))
    const script = `
      import { disableImageSweeps, sweepImageDirectoryOnce } from ${JSON.stringify(
        join(import.meta.dir, '../src/services/image-cache-sweep.ts'),
      )}
      disableImageSweeps()
      await sweepImageDirectoryOnce(${JSON.stringify(directory)}, {
        pattern: /^[a-f0-9]{32}\\.png$/, maxFiles: 0, keepFiles: 0,
      })
    `
    const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(readdirSync(directory).toSorted()).toEqual(names)
  })
})
