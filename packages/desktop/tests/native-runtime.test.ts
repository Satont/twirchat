import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  GPUI_SOURCE_REVISION,
  GPUIX_SOURCE_REVISION,
  resolveNativeRuntime,
  validateNativeRuntimeManifest,
} from '../src/services/native-runtime'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const manifest = () => ({
  apiVersion: 3,
  upstreamSHA: GPUIX_SOURCE_REVISION,
  gpuiSHA: GPUI_SOURCE_REVISION,
  target: 'linux-x64',
  size: 4,
  patchDigest: '0123456789abcdef',
  sha256: '0'.repeat(64),
})
test('native runtime resolution refuses mismatched targets and source revisions', () => {
  expect(() => validateNativeRuntimeManifest(manifest(), 'win32-x64')).toThrow('does not match')
  expect(() =>
    validateNativeRuntimeManifest({ ...manifest(), upstreamSHA: '0'.repeat(40) }, 'linux-x64'),
  ).toThrow('does not match')
})
test('native runtime resolution finds the packaged artifact and rejects truncation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'twirchat-native-runtime-'))
  directories.push(directory)
  const path = join(directory, 'gpuix.linux-x64.node')
  await Bun.write(path, 'test')
  await Bun.write(`${path}.json`, JSON.stringify(manifest()))
  expect(resolveNativeRuntime({ platform: 'linux', arch: 'x64', directories: [directory] })).toBe(
    path,
  )
  await Bun.write(path, 'cut')
  expect(() =>
    resolveNativeRuntime({ platform: 'linux', arch: 'x64', directories: [directory] }),
  ).toThrow('incomplete')
})
test('an explicit runtime override never silently falls back to another binary', () => {
  expect(() => resolveNativeRuntime({ override: '/nonexistent/twirchat-native.node' })).toThrow(
    'missing',
  )
})

test('manifest decoding rejects malformed fields and constructs a validated manifest', () => {
  for (const value of [
    null,
    [],
    'manifest',
    { ...manifest(), size: '4' },
    { ...manifest(), size: Infinity },
    { ...manifest(), sha256: 123 },
    { ...manifest(), patchDigest: {} },
  ]) {
    expect(() => validateNativeRuntimeManifest(value, 'linux-x64')).toThrow()
  }
  const input = { ...manifest(), untrusted: { nativePath: '/other/addon.node' } }
  const validated = validateNativeRuntimeManifest(input, 'linux-x64')
  expect(validated).toEqual(manifest())
  expect(validated).not.toBe(input)
})
