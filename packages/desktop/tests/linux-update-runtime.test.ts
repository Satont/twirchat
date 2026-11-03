import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { prepareLinuxUpdateLocator } from '../src/gpuix/linux-update-runtime'

const directories: string[] = []
const linuxTest = test.skipIf(process.platform !== 'linux')

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function createRuntimeFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'twirchat update runtime '))
  directories.push(directory)
  const currentBinaryDir = join(directory, 'mounted image', 'usr', 'bin')
  await mkdir(currentBinaryDir, { recursive: true })
  const appImage = join(directory, 'integrated TwirChat.AppImage')
  const runtimeDirectory = join(directory, 'profile', 'update-runtime')
  const packagesDirectory = join(directory, 'packages')
  await Bun.write(appImage, 'installed AppImage')
  await Bun.write(join(currentBinaryDir, 'UpdateNix'), 'updater version one')
  await Bun.write(join(currentBinaryDir, 'sq.version'), 'manifest version one')
  return { directory, appImage, currentBinaryDir, runtimeDirectory, packagesDirectory }
}

linuxTest(
  'Linux update runtime survives source removal and keeps the integrated AppImage path',
  async () => {
    const fixture = await createRuntimeFixture()
    const alias = join(fixture.directory, 'AppImage alias')
    await symlink(fixture.appImage, alias)
    const locator = await prepareLinuxUpdateLocator({ ...fixture, appImage: alias })
    expect(locator).toEqual({
      RootAppDir: fixture.appImage,
      UpdateExePath: join(fixture.runtimeDirectory, 'usr', 'bin', 'UpdateNix'),
      PackagesDir: fixture.packagesDirectory,
      ManifestPath: join(fixture.currentBinaryDir, 'sq.version'),
      CurrentBinaryDir: fixture.currentBinaryDir,
      IsPortable: true,
    })

    await rm(join(fixture.directory, 'mounted image'), { recursive: true })
    expect(await readFile(locator.UpdateExePath, 'utf8')).toBe('updater version one')
    expect(await readFile(join(dirname(locator.UpdateExePath), 'sq.version'), 'utf8')).toBe(
      'manifest version one',
    )
    expect((await stat(locator.UpdateExePath)).mode & 0o777).toBe(0o700)
    const runtimeDirectories = await Promise.all(
      [
        fixture.runtimeDirectory,
        join(fixture.runtimeDirectory, 'usr'),
        dirname(locator.UpdateExePath),
      ].map((directory) => stat(directory)),
    )
    expect(runtimeDirectories.map((directory) => directory.mode & 0o777)).toEqual([
      0o700, 0o700, 0o700,
    ])
    expect(await readdir(fixture.runtimeDirectory)).toEqual(['usr'])
  },
)

linuxTest(
  'restaging replaces paths atomically without changing an already opened updater inode',
  async () => {
    const fixture = await createRuntimeFixture()
    const first = await prepareLinuxUpdateLocator(fixture)
    const runningUpdater = await open(first.UpdateExePath, 'r')
    try {
      const originalInode = (await runningUpdater.stat()).ino
      await Bun.write(join(fixture.currentBinaryDir, 'UpdateNix'), 'updater version two')
      await Bun.write(join(fixture.currentBinaryDir, 'sq.version'), 'manifest version two')
      const second = await prepareLinuxUpdateLocator(fixture)

      expect(second.UpdateExePath).toBe(first.UpdateExePath)
      expect((await stat(second.UpdateExePath)).ino).not.toBe(originalInode)
      expect(await runningUpdater.readFile('utf8')).toBe('updater version one')
      expect(await readFile(second.UpdateExePath, 'utf8')).toBe('updater version two')
      expect(await readFile(join(dirname(second.UpdateExePath), 'sq.version'), 'utf8')).toBe(
        'manifest version two',
      )
      expect(await readdir(fixture.runtimeDirectory)).toEqual(['usr'])
      expect((await readdir(dirname(second.UpdateExePath))).toSorted()).toEqual([
        'UpdateNix',
        'sq.version',
      ])
    } finally {
      await runningUpdater.close()
    }
  },
)

linuxTest(
  'failed staging preserves the previous runtime and cleans its temporary files',
  async () => {
    const fixture = await createRuntimeFixture()
    const locator = await prepareLinuxUpdateLocator(fixture)
    await Bun.write(join(fixture.currentBinaryDir, 'UpdateNix'), 'incomplete next updater')
    await rm(join(fixture.currentBinaryDir, 'sq.version'))
    await expect(prepareLinuxUpdateLocator(fixture)).rejects.toThrow()

    expect(await readFile(locator.UpdateExePath, 'utf8')).toBe('updater version one')
    expect(await readFile(join(dirname(locator.UpdateExePath), 'sq.version'), 'utf8')).toBe(
      'manifest version one',
    )
    expect(await readdir(fixture.runtimeDirectory)).toEqual(['usr'])
  },
)

linuxTest('invalid AppImage paths fail before preparing an updater runtime', async () => {
  const fixture = await createRuntimeFixture()
  await expect(
    prepareLinuxUpdateLocator({ ...fixture, appImage: 'relative.AppImage' }),
  ).rejects.toThrow('absolute')
  await expect(
    prepareLinuxUpdateLocator({
      ...fixture,
      appImage: join(fixture.directory, 'missing.AppImage'),
    }),
  ).rejects.toThrow()
  await expect(
    prepareLinuxUpdateLocator({ ...fixture, appImage: fixture.directory }),
  ).rejects.toThrow('file')
  expect(await Bun.file(join(fixture.runtimeDirectory, 'usr', 'bin', 'UpdateNix')).exists()).toBe(
    false,
  )
})
