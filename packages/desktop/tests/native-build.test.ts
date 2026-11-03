import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import {
  boundedBuildJobs,
  nativeArtifactName,
  parseNativeSourceManifest,
} from '../scripts/build-gpuix-native'

describe('pinned native build contract', () => {
  test('maps supported host platforms to stable packaged names', () => {
    expect(nativeArtifactName('linux', 'x64')).toBe('gpuix.linux-x64.node')
    expect(nativeArtifactName('darwin', 'arm64')).toBe('gpuix.darwin-arm64.node')
    expect(nativeArtifactName('darwin', 'x64')).toBe('gpuix.darwin-x64.node')
    expect(nativeArtifactName('win32', 'x64')).toBe('gpuix.win32-x64.node')
    expect(nativeArtifactName('win32', 'arm64')).toBe('gpuix.win32-arm64.node')
    expect(() => nativeArtifactName('linux', 'arm64')).toThrow('No pinned')
  })

  test('bounds compiler parallelism before creating processes', () => {
    expect(boundedBuildJobs(undefined)).toBe(2)
    expect(boundedBuildJobs('1')).toBe(1)
    expect(boundedBuildJobs('2')).toBe(2)
    for (const value of ['3', '0', '-1', '1.5', 'nope'])
      expect(() => boundedBuildJobs(value)).toThrow('1 or 2')
  })
})

test('native source pins and patch checksums match the reviewed checkout contract', async () => {
  const root = resolve(import.meta.dir, '../native/gpuix')
  const raw: unknown = await Bun.file(resolve(root, 'source.json')).json()
  const manifest = parseNativeSourceManifest(raw)
  expect(JSON.stringify(manifest)).toBe(JSON.stringify(raw))
  expect(manifest.revision).toBe('2e31b47ff6432ceebe70e7fc7b0f51a76d7d30cf')
  expect(manifest.gpuiRevision).toBe('f77e5cfe9dad04288566f00c66ecf3c58d6f84b3')
  expect(manifest.rustToolchain).toBe('1.97.1')
  expect(manifest.patches.map((patch: { root: string }) => patch.root)).toEqual(['gpui', 'gpuix'])
  for (const patch of manifest.patches) {
    const bytes = new Uint8Array(await Bun.file(resolve(root, patch.path)).arrayBuffer())
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(patch.sha256)
  }
})

test('native source boundary rejects malformed pins, unsafe patch paths and unrecognized fields', () => {
  const manifest = {
    schema: 1,
    version: '0.11.0-twirchat.1',
    repository: 'https://github.com/remorses/gpuix.git',
    revision: '2e31b47ff6432ceebe70e7fc7b0f51a76d7d30cf',
    gpuiRevision: 'f77e5cfe9dad04288566f00c66ecf3c58d6f84b3',
    rustToolchain: '1.97.1',
    patches: [{ path: 'patches/native.patch', root: 'gpui', sha256: 'a'.repeat(64) }],
  }
  expect(() => parseNativeSourceManifest(manifest)).not.toThrow()
  for (const invalid of [
    null,
    { ...manifest, schema: 2 },
    { ...manifest, revision: 'main' },
    { ...manifest, rustToolchain: 'nightly' },
    { ...manifest, patches: [] },
    { ...manifest, unexpected: true },
    { ...manifest, patches: [{ ...manifest.patches[0], path: '../escape.patch' }] },
    { ...manifest, patches: [{ ...manifest.patches[0], root: 'unknown' }] },
    { ...manifest, patches: [{ ...manifest.patches[0], sha256: 'bad' }] },
  ])
    expect(() => parseNativeSourceManifest(invalid)).toThrow()
})
