import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  isMachO,
  parseReleaseBuildArguments,
  refreshSignedNativeManifest,
  releaseBuildPaths,
} from '../scripts/build-release'
import { backendWebSocketUrl } from '../src/build-info'
import { GPUI_SOURCE_REVISION, GPUIX_SOURCE_REVISION } from '../src/services/native-runtime'

test('release backend websocket follows the configured HTTP endpoint', () => {
  expect(backendWebSocketUrl('https://chat.twir.app')).toBe('wss://chat.twir.app/ws')
  expect(backendWebSocketUrl('http://127.0.0.1:3000/')).toBe('ws://127.0.0.1:3000/ws')
  expect(backendWebSocketUrl('https://example.com/chat/')).toBe('wss://example.com/chat/ws')
  expect(backendWebSocketUrl('https://example.com', 'wss://custom.example/socket')).toBe(
    'wss://custom.example/socket',
  )
  expect(() => backendWebSocketUrl('ftp://example.com')).toThrow('HTTP')
})

test('release build rejects malformed versions and secret-bearing backend URLs before building', () => {
  expect(parseReleaseBuildArguments(['1.0.0', 'https://chat.twir.app/'])).toEqual({
    version: '1.0.0',
    backendUrl: 'https://chat.twir.app',
  })
  expect(parseReleaseBuildArguments(['0.0.0-ci.42', 'https://chat.twir.app']).version).toBe(
    '0.0.0-ci.42',
  )
  for (const args of [
    [],
    ['v1.0.0', 'https://chat.twir.app'],
    ['01.0.0', 'https://chat.twir.app'],
    ['1.0.0', 'https://user:secret@example.com'],
    ['1.0.0', 'https://example.com?token=secret'],
    ['1.0.0', 'ftp://example.com'],
    ['1.0.0', 'https://chat.twir.app', 'unexpected'],
  ])
    expect(() => parseReleaseBuildArguments(args)).toThrow()
})

test('native release package paths agree with platform entry executable names', () => {
  expect(releaseBuildPaths('linux').executable).toEndWith(join('bin', 'twirchat'))
  expect(releaseBuildPaths('win32').executable).toEndWith(join('bin', 'twirchat.exe'))
  const mac = releaseBuildPaths('darwin')
  expect(mac.packDirectory).toEndWith(join('bin', 'TwirChat.app'))
  expect(mac.executable).toEndWith(join('bin', 'TwirChat.app', 'Contents', 'MacOS', 'TwirChat'))
  expect(() => releaseBuildPaths('freebsd')).toThrow('Unsupported')
})

test('signed native manifest keeps source provenance while describing final signed bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twirchat-signing-'))
  try {
    const path = join(directory, 'gpuix.node')
    const original = {
      apiVersion: 3,
      upstreamSHA: GPUIX_SOURCE_REVISION,
      gpuiSHA: GPUI_SOURCE_REVISION,
      target: `${process.platform}-${process.arch}`,
      version: '0.11.0-twirchat.3',
      rustToolchain: '1.97.1',
      patchDigest: '0123456789abcdef',
      size: 4,
      sha256: '0'.repeat(64),
    }
    await Bun.write(path, 'signed-native-fixture')
    await Bun.write(`${path}.json`, JSON.stringify(original))
    await refreshSignedNativeManifest(path)
    const manifest: unknown = await Bun.file(`${path}.json`).json()
    expect(manifest).toEqual({
      ...original,
      size: 21,
      sha256: createHash('sha256').update('signed-native-fixture').digest('hex'),
    })
    await Bun.write(`${path}.json`, JSON.stringify({ ...original, upstreamSHA: '0'.repeat(40) }))
    await expect(refreshSignedNativeManifest(path)).rejects.toThrow('does not match')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Mac signing identifies thin and universal Mach-O rather than data files', () => {
  expect(isMachO(Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe]))).toBe(true)
  expect(isMachO(Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]))).toBe(true)
  expect(isMachO(Uint8Array.from([0xbf, 0xba, 0xfe, 0xca]))).toBe(true)
  expect(isMachO(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46]))).toBe(false)
  expect(isMachO(new Uint8Array())).toBe(false)
})
