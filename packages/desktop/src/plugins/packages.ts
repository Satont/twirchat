import { constants } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { PLUGIN_API_VERSION, type PluginInfo } from './api'
import {
  MANIFEST_FILENAME,
  MAX_MANIFEST_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_DEPTH,
  MAX_PACKAGE_ENTRIES,
  manifestSchema,
  type Manifest,
} from './manifest'
import { MAX_PLUGINS, pluginError, pluginIdSchema } from './protocol'
import {
  MAX_REMOTE_MANIFEST_URL_LENGTH,
  remoteManifestUrl,
  type RemotePluginDownload,
} from './remote-packages'

const log = logger('plugins')
const REMOTE_POINTER = 'remote.json'
const remoteSchema = z.object({
  sourceUrl: z.string().max(MAX_REMOTE_MANIFEST_URL_LENGTH),
  release: z.string().regex(/^package-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/u),
})

type RemotePointer = z.infer<typeof remoteSchema>

export interface InstalledPlugin {
  readonly entry: string | null
  readonly remote?: RemotePointer
  info: PluginInfo
}

async function readManifest(path: string): Promise<Manifest> {
  const stats = await lstat(path)
  if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES)
    throw new Error(t('runtime.plugins.manifestNotRegular'))
  const value: unknown = await Bun.file(path).json()
  const parsed = manifestSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      t('runtime.plugins.invalidManifest', {
        detail: issue ? ` (${issue.path.join('.')})` : '',
      }),
    )
  }
  return parsed.data
}

async function readRemotePointer(directory: string): Promise<RemotePointer | undefined> {
  const path = join(directory, REMOTE_POINTER)
  const stat = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return undefined
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES)
    throw new Error(t('runtime.plugins.invalidRemotePointer'))
  const value: unknown = await Bun.file(path).json()
  const parsed = remoteSchema.safeParse(value)
  if (!parsed.success) throw new Error(t('runtime.plugins.invalidRemotePointer'))
  const sourceUrl = remoteManifestUrl(parsed.data.sourceUrl)
  if (!sourceUrl) throw new Error(t('runtime.plugins.invalidRemoteSource'))
  return { sourceUrl, release: parsed.data.release }
}

async function entryPath(source: string, path: string): Promise<string> {
  const segments = path.split('/')
  let entry = source
  for (const [index, segment] of segments.entries()) {
    entry = join(entry, segment)
    // eslint-disable-next-line no-await-in-loop
    const stat = await lstat(entry)
    if (index === segments.length - 1 ? !stat.isFile() : !stat.isDirectory())
      throw new Error(t('runtime.plugins.entryNotRegularFile'))
  }
  return entry
}

async function readInstalledPackage(
  directory: string,
  id: string,
  enabled: boolean,
  remote?: RemotePointer,
): Promise<InstalledPlugin> {
  const source = join(directory, remote?.release ?? 'package')
  if (!(await lstat(source)).isDirectory())
    throw new Error(t('runtime.plugins.invalidPackageDirectory'))
  const manifest = await readManifest(join(source, MANIFEST_FILENAME))
  if (manifest.id !== id) throw new Error(t('runtime.plugins.idMismatch'))
  const { name, version, apiVersion } = manifest
  const provenance = remote ? { remote } : {}
  const info = { id, name, version, enabled, ...(remote && { sourceUrl: remote.sourceUrl }) }
  const entry =
    remote || apiVersion === PLUGIN_API_VERSION ? await entryPath(source, manifest.entry) : null
  if (apiVersion !== PLUGIN_API_VERSION)
    return {
      entry: null,
      ...provenance,
      info: {
        ...info,
        status: 'incompatible',
        error: t('runtime.plugins.incompatibleApi', {
          apiVersion,
          currentApi: PLUGIN_API_VERSION,
        }),
      },
    }
  return { entry, ...provenance, info: { ...info, status: 'disabled' } }
}

async function readInstalled(root: string, id: string): Promise<InstalledPlugin> {
  const directory = join(root, id)
  const enabled = await Bun.file(join(directory, 'enabled')).exists()
  let remote: RemotePointer | undefined
  try {
    remote = await readRemotePointer(directory)
    return await readInstalledPackage(directory, id, enabled, remote)
  } catch (error) {
    return {
      entry: null,
      ...(remote && { remote }),
      info: {
        id,
        name: id,
        version: '',
        enabled,
        status: 'error',
        error: pluginError(error),
        ...(remote && { sourceUrl: remote.sourceUrl }),
      },
    }
  }
}

export async function listInstalledPlugins(root: string): Promise<InstalledPlugin[]> {
  await mkdir(root, { recursive: true })
  const ids: string[] = []
  for await (const entry of await opendir(root)) {
    if (!entry.isDirectory() || !pluginIdSchema.safeParse(entry.name).success) continue
    ids.push(entry.name)
    if (ids.length === MAX_PLUGINS) break
  }
  return Promise.all(ids.toSorted().map((id) => readInstalled(root, id)))
}

async function copyPackage(source: string, destination: string): Promise<void> {
  let count = 0
  let bytes = 0
  async function copyDirectory(from: string, to: string, depth: number): Promise<void> {
    if (depth > MAX_PACKAGE_DEPTH) throw new Error(t('runtime.plugins.packageTooDeep'))
    await mkdir(to)
    for await (const entry of await opendir(from)) {
      if (++count > MAX_PACKAGE_ENTRIES) throw new Error(t('runtime.plugins.packageTooManyFiles'))
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const input = join(from, entry.name)
      const output = join(to, entry.name)
      if (entry.isDirectory()) {
        await copyDirectory(input, output, depth + 1)
      } else {
        const stat = await lstat(input)
        if (!stat.isFile()) throw new Error(t('runtime.plugins.packageRegularFilesOnly'))
        bytes += stat.size
        if (bytes > MAX_PACKAGE_BYTES) throw new Error(t('runtime.plugins.packageTooLarge'))
        await copyFile(input, output, constants.COPYFILE_EXCL)
      }
    }
  }
  await copyDirectory(source, destination, 0)
}

async function cleanStaging(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch((error: unknown) =>
    log.warn('Could not clean plugin staging directory', { path, error: pluginError(error) }),
  )
}

export async function installPluginPackage(
  root: string,
  manifestPath: string,
  installedIds: ReadonlyMap<string, InstalledPlugin>,
): Promise<InstalledPlugin> {
  if (installedIds.size >= MAX_PLUGINS) throw new Error(t('runtime.plugins.limitReached'))
  const path = resolve(manifestPath)
  if (basename(path) !== MANIFEST_FILENAME) throw new Error(t('runtime.plugins.selectManifest'))
  const source = await realpath(dirname(path))
  const { id } = await readManifest(join(source, MANIFEST_FILENAME))
  if (installedIds.has(id)) throw new Error(t('runtime.plugins.alreadyInstalled', { id }))
  // Do not let a package copy its own staging directory when the selected folder contains root.
  const installedPath = relative(source, await realpath(root))
  if (
    !installedPath ||
    (!isAbsolute(installedPath) && installedPath !== '..' && !installedPath.startsWith(`..${sep}`))
  )
    throw new Error(t('runtime.plugins.packageOutsideInstallDir'))
  const staging = await mkdtemp(join(root, '.install-'))
  const candidate = join(staging, id)
  try {
    await mkdir(candidate)
    await copyPackage(source, join(candidate, 'package'))
    const record = await readInstalled(staging, id)
    if (record.info.status === 'error') throw new Error(record.info.error)
    await rename(candidate, join(root, id))
    return {
      ...record,
      entry: record.entry
        ? join(root, id, 'package', relative(join(candidate, 'package'), record.entry))
        : null,
    }
  } finally {
    await cleanStaging(staging)
  }
}

function remotePointer(download: RemotePluginDownload): RemotePointer {
  return { sourceUrl: download.sourceUrl, release: `package-${crypto.randomUUID()}` }
}

async function writeRelease(
  directory: string,
  remote: RemotePointer,
  download: RemotePluginDownload,
): Promise<void> {
  const release = join(directory, remote.release)
  await mkdir(release)
  for (const [name, bytes] of download.files) {
    const path = join(release, name)
    // eslint-disable-next-line no-await-in-loop
    await mkdir(dirname(path), { recursive: true })
    // eslint-disable-next-line no-await-in-loop
    await writeFile(path, bytes, { flag: 'wx' })
  }
}

async function writeRemotePointer(directory: string, remote: RemotePointer): Promise<void> {
  const temporary = join(directory, `.remote-${crypto.randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(remote), { flag: 'wx' })
    await rename(temporary, join(directory, REMOTE_POINTER))
  } catch (error) {
    await cleanStaging(temporary)
    throw error
  }
}

export async function installRemotePluginPackage(
  root: string,
  download: RemotePluginDownload,
  installedIds: ReadonlyMap<string, InstalledPlugin>,
): Promise<InstalledPlugin> {
  if (installedIds.size >= MAX_PLUGINS) throw new Error(t('runtime.plugins.limitReached'))
  const { id } = download.manifest
  if (installedIds.has(id)) throw new Error(t('runtime.plugins.alreadyInstalled', { id }))
  const remote = remotePointer(download)
  const staging = await mkdtemp(join(root, '.install-'))
  const candidate = join(staging, id)
  try {
    await mkdir(candidate)
    await writeRelease(candidate, remote, download)
    const record = await readInstalledPackage(candidate, id, false, remote)
    await writeRemotePointer(candidate, remote)
    await rename(candidate, join(root, id))
    return {
      ...record,
      entry: record.entry ? join(root, id, relative(candidate, record.entry)) : null,
    }
  } finally {
    await cleanStaging(staging)
  }
}

interface StagedUpdate {
  record: InstalledPlugin
  commit(): Promise<void>
  discard(): Promise<void>
}

export async function stageRemotePluginUpdate(
  root: string,
  previous: InstalledPlugin,
  download: RemotePluginDownload,
): Promise<StagedUpdate> {
  const { id } = download.manifest
  const old = previous.remote
  if (!old || previous.info.id !== id || old.sourceUrl !== download.sourceUrl)
    throw new Error(t('runtime.plugins.updateMismatch'))
  const directory = join(root, id)
  if (!(await lstat(directory)).isDirectory())
    throw new Error(t('runtime.plugins.invalidInstalledDirectory'))
  const remote = remotePointer(download)
  const release = join(directory, remote.release)
  let record: InstalledPlugin
  try {
    await writeRelease(directory, remote, download)
    const enabled = await Bun.file(join(directory, 'enabled')).exists()
    record = await readInstalledPackage(directory, id, enabled, remote)
  } catch (error) {
    await cleanStaging(release)
    throw error
  }

  let state: 'staged' | 'committed' | 'discarded' = 'staged'
  let operation = Promise.resolve()
  const settle = (commit: boolean): Promise<void> => {
    const result = operation.then(async () => {
      if (!commit) {
        if (state === 'staged') {
          state = 'discarded'
          return cleanStaging(release)
        }
        return undefined
      }
      if (state === 'committed') return undefined
      if (state === 'discarded') throw new Error(t('runtime.plugins.updateDiscarded'))
      const current = await readRemotePointer(directory)
      if (current?.release !== old.release || current.sourceUrl !== old.sourceUrl)
        throw new Error(t('runtime.plugins.remoteChangedDuringUpdate'))
      await writeRemotePointer(directory, remote)
      state = 'committed'
      return cleanStaging(join(directory, old.release))
    })
    operation = result.catch(() => undefined)
    return result
  }
  return { record, commit: () => settle(true), discard: () => settle(false) }
}

export async function writePluginEnabled(
  root: string,
  id: string,
  enabled: boolean,
): Promise<void> {
  const path = join(root, id, 'enabled')
  if (enabled) await Bun.write(path, '1')
  else await rm(path, { force: true })
}

export async function removePluginPackage(root: string, id: string): Promise<void> {
  const staging = await mkdtemp(join(root, '.remove-'))
  try {
    await rename(join(root, id), join(staging, id))
  } finally {
    await cleanStaging(staging)
  }
}
