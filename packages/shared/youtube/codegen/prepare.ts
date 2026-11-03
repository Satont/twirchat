import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, realpath, rename, rm, symlink, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { generatorSource } from './source'

const patchPath = resolve(import.meta.dir, 'ts-proto.patch')

async function run(args: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(args, { cwd, stdin: 'ignore', stdout: 'ignore', stderr: 'inherit' })
  if ((await child.exited) !== 0) throw new Error(`Code generator preparation failed: ${args[0]}`)
}

export async function ensureGeneratorDependencies(
  checkout: string,
  dependencies: string,
): Promise<void> {
  const target = join(checkout, 'node_modules')
  try {
    if ((await realpath(target)) === dependencies) return
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  const temporary = join(checkout, `.dependencies-${randomUUID()}`)
  try {
    await symlink(dependencies, temporary, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      await rename(temporary, target)
    } catch (error) {
      if (process.platform !== 'win32' || !(await lstat(target)).isSymbolicLink()) throw error
      await unlink(target)
      await rename(temporary, target)
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function prepareGenerator(): Promise<string> {
  const patch = new Uint8Array(await Bun.file(patchPath).arrayBuffer())
  const patchHash = createHash('sha256').update(patch).digest('hex')
  if (patchHash !== generatorSource.patchSha256)
    throw new Error('Generator patch checksum mismatch.')
  const installedPackage = await realpath(Bun.resolveSync('ts-proto/package.json', import.meta.dir))
  const installed: unknown = await Bun.file(installedPackage).json()
  if (
    !installed ||
    typeof installed !== 'object' ||
    !('version' in installed) ||
    installed.version !== generatorSource.version
  )
    throw new Error(`Install the pinned ts-proto ${generatorSource.version} dependency.`)
  const cache = resolve(
    process.env.TWIRCHAT_CODEGEN_CACHE ?? join(homedir(), '.cache/twirchat/codegen'),
  )
  const checkout = join(cache, `ts-proto-${generatorSource.version}-${patchHash.slice(0, 16)}`)
  const stamp = join(checkout, '.twirchat-source')
  if (await Bun.file(stamp).exists()) {
    if ((await Bun.file(stamp).text()) !== `${generatorSource.archiveSha512}\n${patchHash}\n`)
      throw new Error(`Invalid prepared generator cache: ${checkout}`)
    await ensureGeneratorDependencies(checkout, dirname(dirname(installedPackage)))
    return join(checkout, 'build/src/plugin.js')
  }
  await mkdir(cache, { recursive: true })
  const temporary = await mkdtemp(`${checkout}.tmp-`)
  try {
    const response = await fetch(generatorSource.archiveUrl)
    if (!response.ok) throw new Error(`Generator download failed (${response.status}).`)
    const archive = new Uint8Array(await response.arrayBuffer())
    if (createHash('sha512').update(archive).digest('base64') !== generatorSource.archiveSha512)
      throw new Error('Generator archive checksum mismatch.')
    const archivePath = join(temporary, 'source.tgz')
    await Bun.write(archivePath, archive)
    await run(['tar', '-xzf', archivePath, '--strip-components=1', '-C', temporary], temporary)
    await rm(archivePath)
    await run(['git', 'apply', '--check', patchPath], temporary)
    await run(['git', 'apply', patchPath], temporary)
    await ensureGeneratorDependencies(temporary, dirname(dirname(installedPackage)))
    await Bun.write(
      join(temporary, '.twirchat-source'),
      `${generatorSource.archiveSha512}\n${patchHash}\n`,
    )
    try {
      await rename(temporary, checkout)
    } catch (error) {
      if (
        !(await Bun.file(stamp).exists()) ||
        (await Bun.file(stamp).text()) !== `${generatorSource.archiveSha512}\n${patchHash}\n`
      )
        throw error
      await rm(temporary, { recursive: true, force: true })
    }
    await ensureGeneratorDependencies(checkout, dirname(dirname(installedPackage)))
    return join(checkout, 'build/src/plugin.js')
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.main) console.log(await prepareGenerator())
