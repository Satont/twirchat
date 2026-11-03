import { createHash } from 'node:crypto'
import { mkdir, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { z } from 'zod'

const sourceManifestSchema = z.strictObject({
  schema: z.literal(1),
  version: z.string().min(1),
  repository: z.url(),
  revision: z.string().regex(/^[a-f\d]{40}$/u),
  gpuiRevision: z.string().regex(/^[a-f\d]{40}$/u),
  rustToolchain: z.string().regex(/^\d+\.\d+\.\d+$/u),
  patches: z
    .array(
      z.strictObject({
        path: z.string().regex(/^patches\/[a-z\d-]+\.patch$/u),
        root: z.enum(['gpuix', 'gpui']),
        sha256: z.string().regex(/^[a-f\d]{64}$/u),
      }),
    )
    .min(1),
})
const cachedArtifactSchema = z.object({
  apiVersion: z.literal(3),
  patchDigest: z.string(),
  upstreamSHA: z.string(),
  gpuiSHA: z.string(),
  target: z.string(),
  sha256: z.string().regex(/^[a-f\d]{64}$/u),
})

export function parseNativeSourceManifest(value: unknown): z.infer<typeof sourceManifestSchema> {
  return sourceManifestSchema.parse(value)
}

const nativeRoot = resolve(import.meta.dir, '../native/gpuix')

export function nativeArtifactName(platform = process.platform, arch = process.arch): string {
  const target = `${platform}-${arch}`
  if (target === 'linux-x64') return 'gpuix.linux-x64.node'
  if (target === 'darwin-arm64') return 'gpuix.darwin-arm64.node'
  if (target === 'darwin-x64') return 'gpuix.darwin-x64.node'
  if (target === 'win32-x64') return 'gpuix.win32-x64.node'
  if (target === 'win32-arm64') return 'gpuix.win32-arm64.node'
  throw new Error(`No pinned GPUIX native build for ${target}`)
}

export function boundedBuildJobs(value: string | undefined): number {
  if (!value) return 2
  const jobs = Number(value)
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 2)
    throw new Error('CARGO_BUILD_JOBS must be 1 or 2 for the native GPUIX build.')
  return jobs
}

async function command(args: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const child = Bun.spawn(args, {
    cwd,
    env: { ...process.env, ...env },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const stdout = new Response(child.stdout).text()
  const [code, output] = await Promise.all([child.exited, stdout])
  if (code !== 0) throw new Error(`${args[0]} ${args[1] ?? ''} failed (${code}).`)
  return output.trim()
}

export async function buildNative(args: string[] = process.argv.slice(2)): Promise<void> {
  const mode = args[0] ?? 'build'
  if (!['build', 'check', 'test', 'prepare'].includes(mode) || args.length > 1)
    throw new Error('Usage: bun scripts/build-gpuix-native.ts [build|check|test|prepare]')
  const manifest = parseNativeSourceManifest(await Bun.file(join(nativeRoot, 'source.json')).json())
  const patchBytes = await Promise.all(
    manifest.patches.map(async (patch) => {
      if (!/^patches\/[a-z\d-]+\.patch$/u.test(patch.path)) throw new Error('Invalid patch path.')
      const bytes = new Uint8Array(await Bun.file(join(nativeRoot, patch.path)).arrayBuffer())
      if (createHash('sha256').update(bytes).digest('hex') !== patch.sha256)
        throw new Error(`Patch checksum mismatch: ${patch.path}`)
      return bytes
    }),
  )
  const identity = createHash('sha256')
    .update(JSON.stringify({ manifest, platform: process.platform, arch: process.arch }))
    .update(Buffer.concat(patchBytes))
    .digest('hex')
    .slice(0, 16)
  const artifactRoot = resolve(import.meta.dir, '../dist/native')
  const destination = join(artifactRoot, nativeArtifactName())
  if (
    mode === 'build' &&
    (await Bun.file(`${destination}.json`).exists()) &&
    (await Bun.file(destination).exists())
  ) {
    const cached = cachedArtifactSchema.safeParse(await Bun.file(`${destination}.json`).json())
    const previous = cached.success ? cached.data : null
    if (
      previous !== null &&
      previous.apiVersion === 3 &&
      previous.patchDigest === identity &&
      previous.upstreamSHA === manifest.revision &&
      previous.gpuiSHA === manifest.gpuiRevision &&
      previous.target === `${process.platform}-${process.arch}`
    ) {
      const digest = createHash('sha256')
        .update(new Uint8Array(await Bun.file(destination).arrayBuffer()))
        .digest('hex')
      if (digest === previous.sha256) {
        console.log(destination)
        return
      }
    }
  }
  const cache = resolve(
    process.env.TWIRCHAT_NATIVE_CACHE ?? join(homedir(), '.cache/twirchat/native'),
  )
  const checkout = join(cache, `${manifest.revision.slice(0, 12)}-${identity}`)
  const stamp = join(checkout, '.twirchat-patches-applied')
  await mkdir(cache, { recursive: true })
  if (!(await Bun.file(stamp).exists())) {
    // Never reset a checkout: interrupted preparation is visible and cannot destroy local edits.
    if (await Bun.file(join(checkout, '.git/HEAD')).exists())
      throw new Error(`Incomplete native checkout: ${checkout}. Remove it explicitly, then retry.`)
    await command(
      ['git', 'clone', '--no-checkout', '--filter=blob:none', manifest.repository, checkout],
      cache,
    )
    await command(['git', 'checkout', '--detach', manifest.revision], checkout)
    const revision = await command(['git', 'rev-parse', 'HEAD'], checkout)
    if (revision !== manifest.revision)
      throw new Error('GPUIX source revision does not match the pin.')
    const gpui = join(checkout, 'zed')
    await command(['git', 'submodule', 'update', '--init', '--depth', '1', 'zed'], checkout)
    const gpuiRevision = await command(['git', 'rev-parse', 'HEAD'], gpui)
    if (gpuiRevision !== manifest.gpuiRevision)
      throw new Error('GPUI source revision does not match the pin.')
    for (const patch of manifest.patches) {
      const cwd = patch.root === 'gpui' ? gpui : checkout
      const path = join(nativeRoot, patch.path)
      await command(['git', 'apply', '--check', path], cwd)
      await command(['git', 'apply', path], cwd)
    }
    await Bun.write(stamp, identity)
  }
  if ((await Bun.file(stamp).text()) !== identity) throw new Error('Native patch stamp mismatch.')
  if ((await command(['git', 'rev-parse', 'HEAD'], checkout)) !== manifest.revision)
    throw new Error('Cached GPUIX source revision changed.')
  if (
    (await command(['git', 'rev-parse', 'HEAD'], join(checkout, 'zed'))) !== manifest.gpuiRevision
  )
    throw new Error('Cached GPUI source revision changed.')
  if (mode === 'prepare') {
    console.log(checkout)
    return
  }
  const jobs = boundedBuildJobs(process.env.CARGO_BUILD_JOBS)
  const env = {
    CARGO_BUILD_JOBS: String(jobs),
    CARGO_TARGET_DIR: process.env.TWIRCHAT_NATIVE_TARGET_DIR ?? join(cache, 'target', identity),
  }
  const common = [
    '--locked',
    '--manifest-path',
    'packages/native/Cargo.toml',
    '--no-default-features',
  ]
  const cargoArgs =
    mode === 'build'
      ? ['build', '--release']
      : mode === 'test'
        ? ['test', '--release', '--lib']
        : ['check']
  await command(['cargo', `+${manifest.rustToolchain}`, ...cargoArgs, ...common], checkout, env)
  if (mode !== 'build') return
  const source = join(
    env.CARGO_TARGET_DIR,
    'release',
    process.platform === 'win32'
      ? 'gpuix_native.dll'
      : process.platform === 'darwin'
        ? 'libgpuix_native.dylib'
        : 'libgpuix_native.so',
  )
  await mkdir(artifactRoot, { recursive: true })
  await Bun.write(`${destination}.tmp`, Bun.file(source))
  await rename(`${destination}.tmp`, destination)
  const sha256 = createHash('sha256')
    .update(new Uint8Array(await Bun.file(destination).arrayBuffer()))
    .digest('hex')
  await Bun.write(
    `${destination}.json`,
    `${JSON.stringify({ apiVersion: 3, version: manifest.version, upstreamSHA: manifest.revision, gpuiSHA: manifest.gpuiRevision, patchDigest: identity, rustToolchain: manifest.rustToolchain, target: `${process.platform}-${process.arch}`, size: Bun.file(destination).size, sha256 }, null, 2)}\n`,
  )
  console.log(destination)
}

if (import.meta.main) await buildNative()
