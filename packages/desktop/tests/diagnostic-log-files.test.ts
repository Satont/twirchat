import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createDiagnosticFileWriter,
  diagnosticLogDirectory,
} from '../src/services/diagnostic-log-files'

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'twirchat-diagnostics-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function logFiles(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.startsWith('twirchat-'))
    .map((entry) => join(directory, entry.name))
    .toSorted()
}

const line = (id: number) => `${JSON.stringify({ id, message: '😀' })}\n`

test('resolves platform log locations and ignores relative directory overrides', () => {
  expect(diagnosticLogDirectory('linux', {}, '/home/user')).toBe(
    '/home/user/.local/state/twirchat/logs',
  )
  expect(diagnosticLogDirectory('linux', { XDG_STATE_HOME: '/state' }, '/home/user')).toBe(
    '/state/twirchat/logs',
  )
  expect(diagnosticLogDirectory('linux', { XDG_STATE_HOME: 'state' }, '/home/user')).toBe(
    '/home/user/.local/state/twirchat/logs',
  )
  expect(diagnosticLogDirectory('darwin', {}, '/Users/user')).toBe(
    '/Users/user/Library/Logs/TwirChat',
  )
  expect(diagnosticLogDirectory('win32', { LOCALAPPDATA: 'D:\\Local' }, 'C:\\Users\\user')).toBe(
    'D:\\Local\\TwirChat\\logs',
  )
  const windowsDefault = 'C:\\Users\\user\\AppData\\Local\\TwirChat\\logs'
  expect(diagnosticLogDirectory('win32', {}, 'C:\\Users\\user')).toBe(windowsDefault)
  expect(diagnosticLogDirectory('win32', { LOCALAPPDATA: 'D:Local' }, 'C:\\Users\\user')).toBe(
    windowsDefault,
  )
})

test('rotates whole UTF-8 records and prunes old segments across launches', () =>
  withDirectory(async (directory) => {
    const unrelatedFile = join(directory, 'notes.log')
    await Bun.write(unrelatedFile, 'unrelated')
    const unrelatedDirectory = join(
      directory,
      'twirchat-0000000000000-00000000-0000-0000-0000-000000000000.log',
    )
    await mkdir(unrelatedDirectory)

    const maxFileBytes = Buffer.byteLength(line(1)) * 2
    const limits = { maxFileBytes, maxFiles: 2 }
    const first = createDiagnosticFileWriter(directory, limits)
    for (let id = 1; id <= 5; id++) first.enqueue(line(id))
    first.enqueue(`${JSON.stringify('oversized'.repeat(100))}\n`)
    await first.flush()

    const files = await logFiles(directory)
    expect(await Promise.all(files.map((path) => Bun.file(path).text()))).toEqual([
      line(3) + line(4),
      line(5),
    ])
    expect(await Promise.all(files.map(async (path) => (await stat(path)).size))).toEqual([
      maxFileBytes,
      maxFileBytes / 2,
    ])

    const restarted = createDiagnosticFileWriter(directory, limits)
    restarted.enqueue(line(6))
    await restarted.flush()

    expect(
      await Promise.all((await logFiles(directory)).map((path) => Bun.file(path).text())),
    ).toEqual([line(5), line(6)])
    expect(await Bun.file(unrelatedFile).text()).toBe('unrelated')
    expect((await stat(unrelatedDirectory)).isDirectory()).toBe(true)
  }))

test('serializes concurrent flushes and reopens a new segment after pruning by another writer', () =>
  withDirectory(async (directory) => {
    const limits = { maxFileBytes: 1024, maxFiles: 1 }
    const writer = createDiagnosticFileWriter(directory, limits)
    writer.enqueue(line(1))
    const firstFlush = writer.flush()
    writer.enqueue(line(2))
    await Promise.all([firstFlush, writer.flush()])

    const [initialPath] = await logFiles(directory)
    if (!initialPath) throw new Error('No initial log segment')
    expect(await Bun.file(initialPath).text()).toBe(line(1) + line(2))
    if (process.platform !== 'win32') expect((await stat(initialPath)).mode & 0o777).toBe(0o600)

    const other = createDiagnosticFileWriter(directory, limits)
    other.enqueue(line(3))
    await other.flush()
    expect(await Bun.file(initialPath).exists()).toBe(false)

    writer.enqueue(line(4))
    await writer.flush()
    const files = await logFiles(directory)
    expect(files).toHaveLength(1)
    expect(files).not.toContain(initialPath)
    expect(await Promise.all(files.map((path) => Bun.file(path).text()))).toEqual([line(4)])
  }))

test('recovers on a later write if the log directory was unavailable', () =>
  withDirectory(async (directory) => {
    const logs = join(directory, 'logs')
    await Bun.write(logs, 'blocks directory creation')
    const writer = createDiagnosticFileWriter(logs)
    writer.enqueue(line(1))
    await writer.flush()
    expect(await Bun.file(logs).text()).toBe('blocks directory creation')

    await rm(logs)
    writer.enqueue(line(2))
    await writer.flush()
    expect(await Promise.all((await logFiles(logs)).map((path) => Bun.file(path).text()))).toEqual([
      line(2),
    ])
  }))

test('bounds queued bytes across an active write and accepts new records after draining', () =>
  withDirectory(async (directory) => {
    const writer = createDiagnosticFileWriter(directory)
    const large = `${JSON.stringify('x'.repeat(700 * 1024))}\n`
    const discarded = `${JSON.stringify('y'.repeat(400 * 1024))}\n`
    writer.enqueue(large)
    const active = writer.flush()
    writer.enqueue(discarded)
    await active
    writer.enqueue(line(1))
    await writer.flush()

    const [path] = await logFiles(directory)
    if (!path) throw new Error('No log segment')
    expect(await Bun.file(path).text()).toBe(large + line(1))
  }))
