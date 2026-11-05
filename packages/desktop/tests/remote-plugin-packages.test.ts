import { expect, test } from 'bun:test'

import {
  downloadRemotePlugin,
  readRemotePluginManifest,
  remoteManifestUrl,
  type PluginFetch,
} from '../src/plugins/remote-packages'

const source = 'https://plugins.example.org/streamx/manifest.json'
const signal = new AbortController().signal
const manifest = {
  id: 'streamx',
  name: 'StreamX',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'src/index.ts',
}

test('recognizes secure remote manifests without treating local drive paths as URLs', () => {
  expect(remoteManifestUrl('C:\\plugins\\streamx\\manifest.json')).toBeNull()
  expect(remoteManifestUrl('./plugins/manifest.json')).toBeNull()
  expect(() => remoteManifestUrl('http://example.org/manifest.json')).toThrow('HTTPS')
  expect(() => remoteManifestUrl('https://name:secret@example.org/manifest.json')).toThrow(
    'Invalid',
  )
  expect(
    remoteManifestUrl(
      'https://github.com/acme/chat/blob/refs/heads/team/chat/plugin/manifest.json',
    ),
  ).toBe('https://raw.githubusercontent.com/acme/chat/refs/heads/team/chat/plugin/manifest.json')
  expect(remoteManifestUrl('https://github.com.acme.org/acme/chat/blob/main/manifest.json')).toBe(
    'https://github.com.acme.org/acme/chat/blob/main/manifest.json',
  )
})

test.each([
  '../outside.ts',
  'src\\escape.ts',
  'src/CON.ts',
  'src/Aux/helper.js',
  'src/../other.ts',
  'src/path.',
  'src/encoded%2Fpath.ts',
  'src/Index.ts',
  'Src/other.ts',
  'src/index.ts/child.json',
  'MANIFEST.JSON',
])('rejects nonportable or conflicting package path %s', async (path) => {
  await expect(
    readRemotePluginManifest(source, signal, async () =>
      Response.json({ ...manifest, files: [path] }),
    ),
  ).rejects.toThrow(/remote plugin file path/i)
})

test('reads GitHub slash refs on the original URL and all release files at a resolved commit', async () => {
  const raw =
    'https://raw.githubusercontent.com/acme/chat/refs/heads/team/chat/plugin/manifest.json'
  const sha = 'abcdef'.repeat(6) + 'abcd'
  const base = `https://raw.githubusercontent.com/acme/chat/${sha}/plugin/`
  const requests: string[] = []
  const fetcher: PluginFetch = async (url, init) => {
    requests.push(url.href)
    expect(init.redirect).toBe('manual')
    if (url.host === 'api.github.com') {
      expect(new Headers(init.headers).get('Accept')).toBe('application/vnd.github.sha')
      if (decodeURIComponent(url.pathname).endsWith('/commits/refs/heads/team/chat'))
        return new Response(sha)
      return new Response('', { status: 404 })
    }
    if (url.href === raw || url.href === `${base}manifest.json`)
      return Response.json({ ...manifest, files: ['assets/data.json', manifest.entry] })
    if (url.href === `${base}${manifest.entry}`) return new Response('export default () => {}')
    if (url.href === `${base}assets/data.json`) return Response.json({ ready: true })
    throw new Error(`Unexpected request ${url.href}`)
  }
  const checked = await readRemotePluginManifest(raw, signal, fetcher)
  expect(requests).toEqual([raw])
  const download = await downloadRemotePlugin(checked, signal, fetcher)
  expect(requests).toEqual([
    raw,
    'https://api.github.com/repos/acme/chat/commits/refs%2Fheads%2Fteam%2Fchat%2Fplugin',
    'https://api.github.com/repos/acme/chat/commits/refs%2Fheads%2Fteam%2Fchat',
    `${base}manifest.json`,
    `${base}${manifest.entry}`,
    `${base}assets/data.json`,
  ])
  expect(download.sourceUrl).toBe(raw)
  expect([...download.files.keys()]).toEqual([manifest.entry, 'assets/data.json', 'manifest.json'])
})

test('checks the manifest again after downloading files from a generic HTTPS host', async () => {
  let manifests = 0
  const fetcher: PluginFetch = async (url) =>
    url.href === source
      ? Response.json({ ...manifest, extra: ++manifests })
      : new Response('export default () => {}')
  const checked = await readRemotePluginManifest(source, signal, fetcher)
  await expect(downloadRemotePlugin(checked, signal, fetcher)).rejects.toThrow(
    'manifest changed during download',
  )
})

test('rejects redirects and bounds streamed data without relying on Content-Length', async () => {
  await expect(
    readRemotePluginManifest(source, signal, async () =>
      Response.redirect('https://other.example.org/manifest.json'),
    ),
  ).rejects.toThrow('do not follow redirects')

  let canceled = false
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(20 * 1024))
      controller.enqueue(new Uint8Array(20 * 1024))
    },
    cancel() {
      canceled = true
    },
  })
  await expect(
    readRemotePluginManifest(source, signal, async () => new Response(body)),
  ).rejects.toThrow('size limit')
  expect(canceled).toBe(true)
})
