import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, opendir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { PLUGIN_API_VERSION, type PluginInfo } from './api'
import { MAX_PLUGINS, pluginError, pluginIdSchema } from './protocol'

const MANIFEST_FILENAME = 'manifest.json'
const MAX_MANIFEST_BYTES = 32 * 1024
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024
const MAX_PACKAGE_ENTRIES = 512
const MAX_PACKAGE_DEPTH = 12
const log = logger('plugins')

const manifestSchema = z.object({
  id: pluginIdSchema,
  name: z.string().trim().min(1).max(100),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-[a-z\d]+(?:[.-][a-z\d]+)*)?$/iu)
    .max(80),
  apiVersion: z.number().int().positive(),
  entry: z
    .string()
    .regex(/^(?:[a-z\d_][a-z\d_-]*\/)*[a-z\d_][a-z\d_.-]*\.(?:[cm]?[jt]s)$/iu)
    .max(160),
})

type Manifest = z.infer<typeof manifestSchema>
export interface InstalledPlugin {
  readonly entry: string | null
  info: PluginInfo
}

async function readManifest(path: string): Promise<Manifest> {
  const stats = await lstat(path)
  if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES)
    throw new Error('Expected a regular plugin manifest of at most 32 KiB.')
  const value: unknown = await Bun.file(path).json()
  const parsed = manifestSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Invalid plugin manifest${issue ? ` (${issue.path.join('.')})` : ''}.`)
  }
  return parsed.data
}

async function readInstalled(root: string, id: string): Promise<InstalledPlugin> {
  const source = join(root, id, 'package')
  const enabled = await Bun.file(join(root, id, 'enabled')).exists()
  try {
    const manifest = await readManifest(join(source, MANIFEST_FILENAME))
    if (manifest.id !== id) throw new Error('Installed plugin ID does not match its directory.')
    const { name, version, apiVersion } = manifest
    if (apiVersion !== PLUGIN_API_VERSION)
      return {
        entry: null,
        info: {
          id,
          name,
          version,
          enabled,
          status: 'incompatible',
          error: `Plugin API ${apiVersion} is incompatible with TwirChat API ${PLUGIN_API_VERSION}.`,
        },
      }
    // Check every ancestor in case the installed files were changed outside TwirChat.
    const segments = manifest.entry.split('/')
    let entry = source
    if (!(await lstat(source)).isDirectory())
      throw new Error('Invalid installed package directory.')
    for (const [index, segment] of segments.entries()) {
      entry = join(entry, segment)
      // eslint-disable-next-line no-await-in-loop
      const stat = await lstat(entry)
      if (index === segments.length - 1 ? !stat.isFile() : !stat.isDirectory())
        throw new Error('Plugin entry must be a regular file inside its package.')
    }
    return { entry, info: { id, name, version, enabled, status: 'disabled' } }
  } catch (error) {
    return {
      entry: null,
      info: { id, name: id, version: '', enabled, status: 'error', error: pluginError(error) },
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
    if (depth > MAX_PACKAGE_DEPTH) throw new Error('Plugin package is nested too deeply.')
    await mkdir(to)
    for await (const entry of await opendir(from)) {
      if (++count > MAX_PACKAGE_ENTRIES) throw new Error('Plugin package contains too many files.')
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const input = join(from, entry.name)
      const output = join(to, entry.name)
      if (entry.isDirectory()) {
        await copyDirectory(input, output, depth + 1)
      } else {
        const stat = await lstat(input)
        if (!stat.isFile()) throw new Error('Plugin packages may contain regular files only.')
        bytes += stat.size
        if (bytes > MAX_PACKAGE_BYTES) throw new Error('Plugin package exceeds 16 MiB.')
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
  if (installedIds.size >= MAX_PLUGINS) throw new Error('The installed plugin limit was reached.')
  const path = resolve(manifestPath)
  if (basename(path) !== MANIFEST_FILENAME) throw new Error('Select the plugin manifest.json file.')
  const source = await realpath(dirname(path))
  const { id } = await readManifest(join(source, MANIFEST_FILENAME))
  if (installedIds.has(id)) throw new Error(`Plugin ${id} is already installed.`)
  // Do not let a package copy its own staging directory when the selected folder contains root.
  const installedPath = relative(source, await realpath(root))
  if (
    !installedPath ||
    (!isAbsolute(installedPath) && installedPath !== '..' && !installedPath.startsWith(`..${sep}`))
  )
    throw new Error('Select a plugin package outside the installed plugin directory.')
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
