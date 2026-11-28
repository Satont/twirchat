import { chmod, copyFile, mkdir, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import type { VelopackLocatorConfig } from 'velopack'

interface LinuxUpdateRuntimeOptions {
  appImage: string
  currentBinaryDir: string
  runtimeDirectory: string
  packagesDirectory: string
}

export async function prepareLinuxUpdateLocator({
  appImage,
  currentBinaryDir,
  runtimeDirectory,
  packagesDirectory,
}: LinuxUpdateRuntimeOptions): Promise<VelopackLocatorConfig> {
  if (!isAbsolute(appImage)) throw new Error('The AppImage path must be absolute.')
  const appImagePath = await realpath(appImage)
  if (!(await stat(appImagePath)).isFile()) throw new Error('The AppImage path must be a file.')

  const runtimeUserDirectory = join(runtimeDirectory, 'usr')
  const runtimeBinaryDirectory = join(runtimeUserDirectory, 'bin')
  await mkdir(runtimeBinaryDirectory, { recursive: true, mode: 0o700 })
  await Promise.all(
    [runtimeDirectory, runtimeUserDirectory, runtimeBinaryDirectory].map((directory) =>
      chmod(directory, 0o700),
    ),
  )
  const temporaryDirectory = await mkdtemp(join(runtimeDirectory, '.staging-'))
  const updaterPath = join(runtimeBinaryDirectory, 'UpdateNix')
  try {
    const temporaryUpdater = join(temporaryDirectory, 'UpdateNix')
    const temporaryManifest = join(temporaryDirectory, 'sq.version')
    await copyFile(join(currentBinaryDir, 'UpdateNix'), temporaryUpdater)
    await copyFile(join(currentBinaryDir, 'sq.version'), temporaryManifest)
    await chmod(temporaryUpdater, 0o700)
    await chmod(temporaryManifest, 0o600)

    // Keep the updater's executable inode alive when another process is already using it.
    await rename(temporaryManifest, join(runtimeBinaryDirectory, 'sq.version'))
    await rename(temporaryUpdater, updaterPath)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }

  return {
    RootAppDir: appImagePath,
    UpdateExePath: updaterPath,
    PackagesDir: packagesDirectory,
    ManifestPath: join(currentBinaryDir, 'sq.version'),
    CurrentBinaryDir: currentBinaryDir,
    IsPortable: true,
  }
}
