import { expect, test } from 'bun:test'
import { resolveWindowChromePlatform } from '../src/views/main/services/window-chrome'

test('uses compact chrome for native Windows and macOS only', () => {
  expect(
    resolveWindowChromePlatform({
      nativePlatform: 'windows',
      isDevelopment: false,
      search: '',
    }),
  ).toBe('windows')
  expect(
    resolveWindowChromePlatform({
      nativePlatform: 'darwin',
      isDevelopment: false,
      search: '',
    }),
  ).toBe('macos')
  expect(
    resolveWindowChromePlatform({
      nativePlatform: 'linux',
      isDevelopment: false,
      search: '',
    }),
  ).toBe('native')
})

test('allows compact chrome previews only in development', () => {
  expect(
    resolveWindowChromePlatform({
      nativePlatform: 'linux',
      isDevelopment: true,
      search: '?windowChrome=windows',
    }),
  ).toBe('windows')
  expect(
    resolveWindowChromePlatform({
      nativePlatform: 'linux',
      isDevelopment: true,
      search: '?windowChrome=macos',
    }),
  ).toBe('macos')
  expect(
    resolveWindowChromePlatform({
      nativePlatform: 'linux',
      isDevelopment: false,
      search: '?windowChrome=windows',
    }),
  ).toBe('native')
})

test('ignores unsupported preview values', () => {
  expect(
    resolveWindowChromePlatform({
      nativePlatform: 'linux',
      isDevelopment: true,
      search: '?windowChrome=linux',
    }),
  ).toBe('native')
})
