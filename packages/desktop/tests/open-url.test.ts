import { expect, test } from 'bun:test'

import { browserCommand } from '../src/gpuix/backend/open-url'

const WINDOWS_HANDLER = ['rundll32', 'url.dll,FileProtocolHandler']

test('Windows opens URLs without a shell', () => {
  for (const url of ['https://a.b/|calc', 'https://a.b/^&calc', 'https://a.b/?x=1&y=2']) {
    const command = browserCommand(url, 'win32')
    expect(command.slice(0, 2)).toEqual(WINDOWS_HANDLER)
    expect(command).toHaveLength(3)
  }
})

test('OAuth query strings reach the browser intact', () => {
  const url = 'https://id.twitch.tv/oauth2/authorize?client_id=a&state=b&scope=c+d'
  expect(browserCommand(url, 'win32')[2]).toBe(url)
})

test('each platform uses its own opener', () => {
  expect(browserCommand('https://a.b/', 'darwin')).toEqual(['open', 'https://a.b/'])
  expect(browserCommand('https://a.b/', 'linux')).toEqual(['xdg-open', 'https://a.b/'])
})

test('only web URLs are accepted', () => {
  for (const url of [
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'ms-msdt:/id',
    'calc',
    '',
  ]) {
    expect(() => browserCommand(url, 'win32')).toThrow()
    expect(() => browserCommand(url, 'linux')).toThrow()
  }
})
