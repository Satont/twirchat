import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { z } from 'zod'

import { PACKAGED_PLUGIN_RUNNER, startPluginProcess } from '../src/plugins/process'
import {
  GPUIX_SOURCE_REVISION,
  GPUI_SOURCE_REVISION,
  validateNativeRuntimeManifest,
} from '../src/services/native-runtime'
import { nativeArtifactName, parseNativeSourceManifest } from './build-gpuix-native'

const packageManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  os: z.array(z.string()).optional(),
  cpu: z.array(z.string()).optional(),
  libc: z.array(z.string()).optional(),
})
function runtimeLibc(sharpManifest: string): string | null {
  if (process.platform !== 'linux') return null
  const module: unknown = createRequire(sharpManifest)('detect-libc')
  if (
    !module ||
    typeof module !== 'object' ||
    !('familySync' in module) ||
    typeof module.familySync !== 'function'
  )
    throw new Error('Sharp runtime libc detection is unavailable.')
  const family: unknown = module.familySync()
  return z.string().nullable().parse(family)
}
const desktop = resolve(import.meta.dir, '..')
export async function stageNativeRuntime(options: {
  output: string
  sourceRoot?: string
  artifactRoot?: string
}): Promise<string> {
  const sourceRoot = options.sourceRoot ?? join(desktop, 'native/gpuix')
  const artifactRoot = options.artifactRoot ?? join(desktop, 'dist/native')
  const name = nativeArtifactName()
  const path = join(artifactRoot, name)
  const source = parseNativeSourceManifest(await Bun.file(join(sourceRoot, 'source.json')).json())
  if (
    source.schema !== 1 ||
    source.revision !== GPUIX_SOURCE_REVISION ||
    source.gpuiRevision !== GPUI_SOURCE_REVISION ||
    !Array.isArray(source.patches) ||
    !source.patches.length
  )
    throw new Error('Native packaging source pins do not match this application.')
  const patches = await Promise.all(
    source.patches.map(async (patch) => {
      if (
        !['gpuix', 'gpui'].includes(patch.root) ||
        !/^patches\/[a-z\d-]+\.patch$/u.test(patch.path)
      )
        throw new Error('Invalid native patch path.')
      const bytes = Buffer.from(await Bun.file(join(sourceRoot, patch.path)).arrayBuffer())
      if (createHash('sha256').update(bytes).digest('hex') !== patch.sha256)
        throw new Error(`Native patch checksum mismatch: ${patch.path}`)
      return bytes
    }),
  )
  const identity = createHash('sha256')
    .update(JSON.stringify({ manifest: source, platform: process.platform, arch: process.arch }))
    .update(Buffer.concat(patches))
    .digest('hex')
    .slice(0, 16)
  const rawManifest = z
    .object({ version: z.string(), rustToolchain: z.string() })
    .passthrough()
    .parse(await Bun.file(`${path}.json`).json())
  if (rawManifest.version !== source.version || rawManifest.rustToolchain !== source.rustToolchain)
    throw new Error('Native artifact version or toolchain is stale.')
  const manifest = validateNativeRuntimeManifest(rawManifest, `${process.platform}-${process.arch}`)
  if (manifest.patchDigest !== identity)
    throw new Error('Native artifact patch digest is stale; run bun run build:native.')
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer())
  if (
    bytes.length !== manifest.size ||
    createHash('sha256').update(bytes).digest('hex') !== manifest.sha256
  )
    throw new Error('Native artifact size or SHA-256 mismatch.')
  assertNativeBinaryTarget(bytes, process.platform, process.arch)
  const destination = join(resolve(options.output), 'native')
  if (resolve(artifactRoot) !== destination) {
    await rm(destination, { recursive: true, force: true })
    await mkdir(destination, { recursive: true })
    await Bun.write(join(destination, name), bytes)
    await Bun.write(join(destination, `${name}.json`), JSON.stringify(rawManifest, null, 2) + '\n')
  }
  const staged = join(destination, name)
  const stagedBytes = Buffer.from(await Bun.file(staged).arrayBuffer())
  if (
    stagedBytes.length !== manifest.size ||
    createHash('sha256').update(stagedBytes).digest('hex') !== manifest.sha256
  )
    throw new Error('Staged native artifact verification failed.')
  return staged
}

export function assertNativeBinaryTarget(bytes: Buffer, platform: string, arch: string): void {
  let valid = false
  if (
    platform === 'linux' &&
    bytes.length >= 64 &&
    bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  ) {
    valid =
      bytes[4] === 2 &&
      bytes[5] === 1 &&
      bytes.readUInt16LE(18) === (arch === 'x64' ? 62 : arch === 'arm64' ? 183 : -1)
  } else if (platform === 'darwin' && bytes.length >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf) {
    valid =
      bytes.readUInt32LE(4) === (arch === 'arm64' ? 0x100000c : arch === 'x64' ? 0x1000007 : -1)
  } else if (platform === 'win32' && bytes.length >= 64 && bytes.toString('ascii', 0, 2) === 'MZ') {
    const offset = bytes.readUInt32LE(60)
    valid =
      offset <= bytes.length - 6 &&
      bytes.toString('ascii', offset, offset + 4) === 'PE\0\0' &&
      bytes.readUInt16LE(offset + 4) === (arch === 'x64' ? 0x8664 : arch === 'arm64' ? 0xaa64 : -1)
  }
  if (!valid) throw new Error(`Native binary architecture does not match ${platform}-${arch}.`)
}

export async function packageRuntimeAssets(directory = join(desktop, 'dist')): Promise<void> {
  const output = resolve(directory)
  await mkdir(output, { recursive: true })
  await stageNativeRuntime({ output })

  // Copy the already-installed, lockfile-resolved dependency graph. No build-time download.
  const sharpManifest = createRequire(join(desktop, 'package.json')).resolve('sharp/package.json')
  const libc = runtimeLibc(sharpManifest)
  const accepts = (values: string[] | undefined, actual: string): boolean =>
    !values ||
    (!values.includes(`!${actual}`) &&
      (values.every((value) => value.startsWith('!')) || values.includes(actual)))
  const queue = [{ name: 'sharp', issuer: join(desktop, 'package.json'), optional: false }]
  const copied = new Map<string, string>()
  await rm(join(output, 'node_modules'), { recursive: true, force: true })
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index]
    if (!item) continue
    let manifestPath: string
    try {
      manifestPath = createRequire(item.issuer).resolve(`${item.name}/package.json`)
    } catch (error) {
      if (item.optional) continue
      throw error
    }
    // Dependency traversal and package copying are intentionally ordered and bounded by the graph.
    // eslint-disable-next-line no-await-in-loop
    const manifest = packageManifestSchema.parse(await Bun.file(manifestPath).json())
    if (
      !accepts(manifest.os, process.platform) ||
      !accepts(manifest.cpu, process.arch) ||
      (libc && !accepts(manifest.libc, libc))
    )
      continue
    if (copied.has(manifest.name)) {
      if (copied.get(manifest.name) !== manifest.version)
        throw new Error(`Conflicting runtime dependency versions: ${manifest.name}`)
      continue
    }
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(manifest.name))
      throw new Error('Invalid runtime package name.')
    const destination = join(output, 'node_modules', manifest.name)
    // eslint-disable-next-line no-await-in-loop
    await mkdir(dirname(destination), { recursive: true })
    // eslint-disable-next-line no-await-in-loop
    await cp(dirname(manifestPath), destination, {
      recursive: true,
      dereference: true,
      filter: (source) => basename(source) !== 'node_modules',
    })
    copied.set(manifest.name, manifest.version)
    for (const name of Object.keys(manifest.dependencies ?? {}))
      queue.push({ name, issuer: manifestPath, optional: false })
    for (const name of Object.keys(manifest.optionalDependencies ?? {}))
      queue.push({ name, issuer: manifestPath, optional: true })
  }

  const worker = await Bun.build({
    entrypoints: [join(desktop, 'src/services/paint-worker.ts')],
    target: 'bun',
    outdir: output,
    naming: 'paint-worker.js',
  })
  if (!worker.success) throw new AggregateError(worker.logs, 'Could not build the paint worker.')
  const pluginRunner = await Bun.build({
    entrypoints: [join(desktop, 'src/plugins/runner.ts')],
    target: 'bun',
    outdir: output,
    naming: PACKAGED_PLUGIN_RUNNER,
  })
  if (!pluginRunner.success)
    throw new AggregateError(pluginRunner.logs, 'Could not build the plugin runner.')
  const overlay = join(desktop, 'dist/overlay')
  if (overlay !== join(output, 'overlay')) {
    await rm(join(output, 'overlay'), { recursive: true, force: true })
    await cp(overlay, join(output, 'overlay'), { recursive: true })
  }
  await rm(join(output, 'fonts'), { recursive: true, force: true })
  await cp(join(desktop, 'public/fonts'), join(output, 'fonts'), { recursive: true })

  const binaryName = ['twirchat', 'twirchat.exe', 'TwirChat'].find(
    (name) => Bun.file(join(output, name)).size > 0,
  )
  if (!binaryName)
    throw new Error('Build the desktop executable before staging its runtime assets.')
  const temporary = await mkdtemp(join(tmpdir(), 'twirchat-runtime-check-'))
  try {
    // The compiled executable supplies Bun itself; this proves native addon resolution
    // and bundled-font rasterization from an unrelated working directory.
    const child = Bun.spawn([join(output, binaryName), join(output, 'paint-worker.js')], {
      cwd: temporary,
      env: { ...process.env, BUN_BE_BUN: '1', TWIRCHAT_PAINT_WORKER: '1' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    })
    await child.stdin.write(
      JSON.stringify({
        name: 'Runtime check',
        paint: {
          id: 'runtime-check',
          name: 'Runtime check',
          layers: [{ type: 'color', color: '#7c3aed', opacity: 1 }],
          shadows: [],
        },
        fontSize: 14,
        fontFamily: 'Inter',
        dbPath: join(temporary, 'profile/db.sqlite'),
      }),
    )
    await child.stdin.end()
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (code !== 0) throw new Error(`Packaged paint renderer failed: ${stderr.slice(0, 2000)}`)
    const result = z.object({ path: z.string() }).parse(JSON.parse(stdout))
    if (typeof result.path !== 'string' || !(await Bun.file(result.path).exists()))
      throw new Error('Packaged paint renderer did not create its output.')
    const pluginEntry = join(temporary, 'smoke-plugin.ts')
    await Bun.write(
      pluginEntry,
      `export default (api) => api.registerCommand('runtime-check', () => {})`,
    )
    const plugin = startPluginProcess({
      entry: pluginEntry,
      appVersion: 'packaging-smoke',
      packagedExecutable: join(output, binaryName),
      hostAction: () => Promise.resolve(null),
      onTransportUpdates() {},
      onFailure() {},
    })
    try {
      const registration = await plugin.ready
      if (!registration.commands.includes('runtime-check'))
        throw new Error('Packaged plugin runner did not register its command.')
      await plugin.request({
        action: 'command',
        name: 'runtime-check',
        input: { channel: null, text: '/runtime-check', args: [] },
      })
    } finally {
      await plugin.close()
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  console.log(`Runtime assets staged and verified (${copied.size} installed Sharp packages).`)
}

if (import.meta.main) await packageRuntimeAssets(process.argv[2])
