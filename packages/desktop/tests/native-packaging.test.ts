import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseNativeSourceManifest } from '../scripts/build-gpuix-native'
import { nativeArtifactName } from '../scripts/build-gpuix-native'
import { assertNativeBinaryTarget, stageNativeRuntime } from '../scripts/package-runtime-assets'
import { GPUI_SOURCE_REVISION, GPUIX_SOURCE_REVISION } from '../src/services/native-runtime'
import { literal } from './fixture-values'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
function binary(platform = process.platform, arch = process.arch): Buffer {
  const bytes = Buffer.alloc(128)
  if (platform === 'linux') {
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
    bytes.writeUInt16LE(arch === 'x64' ? 62 : 183, 18)
  } else if (platform === 'darwin') {
    bytes.writeUInt32LE(0xfeedfacf, 0)
    bytes.writeUInt32LE(arch === 'arm64' ? 0x100000c : 0x1000007, 4)
  } else {
    bytes.write('MZ')
    bytes.writeUInt32LE(64, 60)
    bytes.write('PE\0\0', 64)
    bytes.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 68)
  }
  return bytes
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'twirchat-native-package-'))
  directories.push(directory)
  const sourceRoot = join(directory, 'source')
  const artifactRoot = join(directory, 'artifacts')
  const output = join(directory, 'package')
  await Promise.all([mkdir(join(sourceRoot, 'patches'), { recursive: true }), mkdir(artifactRoot)])
  const patch = Buffer.from('pinned patch bytes')
  await Bun.write(join(sourceRoot, 'patches/test.patch'), patch)
  const source = parseNativeSourceManifest({
    schema: 1,
    version: '0.11.0-test',
    repository: 'https://github.com/remorses/gpuix.git',
    rustToolchain: '1.97.1',
    revision: GPUIX_SOURCE_REVISION,
    gpuiRevision: GPUI_SOURCE_REVISION,
    patches: [{ path: 'patches/test.patch', root: 'gpuix', sha256: sha(patch) }],
  })
  await Bun.write(join(sourceRoot, 'source.json'), JSON.stringify(source))
  const patchDigest = createHash('sha256')
    .update(JSON.stringify({ manifest: source, platform: process.platform, arch: process.arch }))
    .update(patch)
    .digest('hex')
    .slice(0, 16)
  const bytes = binary()
  const manifest = {
    apiVersion: 3,
    version: source.version,
    rustToolchain: source.rustToolchain,
    target: `${process.platform}-${process.arch}`,
    upstreamSHA: GPUIX_SOURCE_REVISION,
    gpuiSHA: GPUI_SOURCE_REVISION,
    patchDigest,
    size: bytes.length,
    sha256: sha(bytes),
  }
  const path = join(artifactRoot, nativeArtifactName())
  await Bun.write(path, bytes)
  await Bun.write(`${path}.json`, JSON.stringify(manifest))
  return { sourceRoot, artifactRoot, output, path, manifest, bytes }
}

test('stages only verified current native addon and matching manifest beside executable', async () => {
  const f = await fixture()
  const path = await stageNativeRuntime(f)
  expect(path).toBe(join(f.output, 'native', nativeArtifactName()))
  expect(Array.from(new Uint8Array(await Bun.file(path).arrayBuffer()))).toEqual(
    Array.from(f.bytes),
  )
  expect(await Bun.file(`${path}.json`).json()).toEqual(f.manifest)
  expect(
    await stageNativeRuntime({
      ...f,
      output: f.output,
      artifactRoot: join(f.output, 'native'),
    }),
  ).toEndWith(nativeArtifactName())
})
test('rejects corrupt native bytes even when the size is unchanged', async () => {
  const f = await fixture()
  f.bytes[100] = 1
  await Bun.write(f.path, f.bytes)
  await expect(stageNativeRuntime(f)).rejects.toThrow('SHA-256')
})
test('rejects another target and stale patch identity', async () => {
  const f = await fixture()
  await Bun.write(`${f.path}.json`, JSON.stringify({ ...f.manifest, target: 'unsupported-target' }))
  await expect(stageNativeRuntime(f)).rejects.toThrow('does not match')
  await Bun.write(`${f.path}.json`, JSON.stringify({ ...f.manifest, patchDigest: '0'.repeat(16) }))
  await expect(stageNativeRuntime(f)).rejects.toThrow('patch digest')
})
test('refuses changed patch bytes before staging any addon', async () => {
  const f = await fixture()
  await Bun.write(join(f.sourceRoot, 'patches/test.patch'), 'tampered')
  await expect(stageNativeRuntime(f)).rejects.toThrow('checksum')
  expect(await Bun.file(join(f.output, 'native', nativeArtifactName())).exists()).toBe(false)
})
test('checks actual ELF, Mach-O and PE machine types rather than trusting filenames', () => {
  for (const [platform, arch] of literal([
    ['linux', 'x64'],
    ['darwin', 'arm64'],
    ['win32', 'x64'],
    ['win32', 'arm64'],
  ])) {
    expect(() => assertNativeBinaryTarget(binary(platform, arch), platform, arch)).not.toThrow()
    expect(() =>
      assertNativeBinaryTarget(binary(platform, arch), platform, arch === 'x64' ? 'arm64' : 'x64'),
    ).toThrow('architecture')
  }
  expect(() => assertNativeBinaryTarget(Buffer.from('broken'), 'linux', 'x64')).toThrow(
    'architecture',
  )
})
