import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const directories: string[] = []
const children: ReturnType<typeof Bun.spawn>[] = []
const socketPaths = new Set<string>()
const fixture = join(import.meta.dir, 'fixtures/linux-single-instance.ts')
const linuxTest = process.platform === 'linux' ? test : test.skip

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'twir-single-'))
  directories.push(directory)
  return { directory, profile: join(directory, 'db.sqlite') }
}

function socketPath(profile: string) {
  const uid = process.getuid?.()
  const key = createHash('sha256').update(`${uid}:${profile}`).digest('hex').slice(0, 32)
  return `/tmp/twirchat-${uid}/${key}.sock`
}

function launch(directory: string, profile: string, name: string, delay = 0) {
  socketPaths.add(socketPath(join(realpathSync(dirname(profile)), basename(profile))))
  const marker = join(directory, name)
  const child = Bun.spawn([process.execPath, fixture, profile, marker], {
    env: { ...process.env, XDG_RUNTIME_DIR: directory, ACTIVATION_DELAY: String(delay) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  children.push(child)
  return { child, marker }
}

async function waitForFile(path: string) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) return Bun.file(path).text()
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for ${path}`)
}

afterEach(async () => {
  for (const child of children) child.kill('SIGKILL')
  await Promise.all(children.map((child) => child.exited))
  children.length = 0
  for (const path of socketPaths) rmSync(path, { force: true })
  socketPaths.clear()
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
  directories.length = 0
})

linuxTest('relaunch activates the primary while only one process owns the profile', async () => {
  const { directory, profile } = setup()
  const primary = launch(directory, profile, 'primary')
  expect(await waitForFile(`${primary.marker}.ready`)).toBe('primary')
  const secondary = launch(directory, profile, 'secondary')
  expect(await secondary.child.exited).toBe(0)
  expect(await waitForFile(`${secondary.marker}.ready`)).toBe('forwarded')
  expect(await waitForFile(`${primary.marker}.activated`)).toBe('activated')
})

linuxTest('simultaneous launches elect one primary and queue activation until ready', async () => {
  const { directory, profile } = setup()
  const processes = Array.from({ length: 5 }, (_, index) =>
    launch(directory, profile, `process-${index}`, 500),
  )
  const results = await Promise.all(processes.map(({ marker }) => waitForFile(`${marker}.ready`)))
  expect(results.filter((kind) => kind === 'primary')).toHaveLength(1)
  expect(results.filter((kind) => kind === 'forwarded')).toHaveLength(4)
  const primary = processes.find((_, index) => results[index] === 'primary')
  expect(primary).toBeDefined()
  if (primary) expect(await waitForFile(`${primary.marker}.activated`)).toBe('activated')
})

linuxTest(
  'SIGKILL releases ownership and a fresh process replaces the stale endpoint',
  async () => {
    const { directory, profile } = setup()
    const primary = launch(directory, profile, 'primary')
    await waitForFile(`${primary.marker}.ready`)
    primary.child.kill('SIGKILL')
    await primary.child.exited
    const replacement = launch(directory, profile, 'replacement')
    expect(await waitForFile(`${replacement.marker}.ready`)).toBe('primary')
    const secondary = launch(directory, profile, 'secondary')
    expect(await secondary.child.exited).toBe(0)
    expect(await waitForFile(`${replacement.marker}.activated`)).toBe('activated')
  },
)

linuxTest(
  'different profiles have independent owners and symlink aliases share ownership',
  async () => {
    const { directory, profile } = setup()
    const primary = launch(directory, profile, 'primary')
    await waitForFile(`${primary.marker}.ready`)
    const alias = `${directory}-alias`
    symlinkSync(directory, alias)
    directories.push(alias)
    const secondary = launch(directory, join(alias, 'db.sqlite'), 'alias')
    expect(await secondary.child.exited).toBe(0)
    expect(await waitForFile(`${secondary.marker}.ready`)).toBe('forwarded')
    const other = launch(directory, join(directory, 'other.sqlite'), 'other')
    expect(await waitForFile(`${other.marker}.ready`)).toBe('primary')
  },
)

linuxTest(
  'activation ignores runtime environment differences and rejects extra payloads',
  async () => {
    const { directory, profile } = setup()
    const primary = launch(directory, profile, 'primary')
    await waitForFile(`${primary.marker}.ready`)
    const unix = socketPath(join(realpathSync(directory), 'db.sqlite'))
    for (const options of [{ method: 'GET' }, { method: 'POST', body: 'unexpected' }]) {
      const response = await fetch('http://localhost/activate', { unix, ...options })
      expect(response.status).toBe(400)
    }
    expect(await Bun.file(`${primary.marker}.activated`).exists()).toBe(false)
    const child = Bun.spawn([process.execPath, fixture, profile, join(directory, 'secondary')], {
      env: { ...process.env, XDG_RUNTIME_DIR: '/nonexistent-runtime-directory' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    children.push(child)
    expect(await child.exited).toBe(0)
    expect(await waitForFile(`${primary.marker}.activated`)).toBe('activated')
  },
)
