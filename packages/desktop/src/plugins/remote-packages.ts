import { z } from 'zod'

import {
  MANIFEST_FILENAME,
  MAX_MANIFEST_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_DEPTH,
  MAX_PACKAGE_ENTRIES,
  manifestSchema,
} from './manifest'

const RAW_GITHUB = 'https://raw.githubusercontent.com'
const GITHUB_API = 'https://api.github.com'
const MAX_GITHUB_REF_PROBES = 16
const GITHUB_SHA = /^[\da-f]{40}$/iu
export const MAX_REMOTE_MANIFEST_URL_LENGTH = 2048
const remoteManifestSchema = manifestSchema.extend({
  files: z.array(z.string().max(512)).max(MAX_PACKAGE_ENTRIES).optional(),
})

export type PluginFetch = (url: URL, init: RequestInit) => Promise<Response>

export interface RemotePluginManifest {
  readonly sourceUrl: string
  readonly manifest: z.infer<typeof remoteManifestSchema>
  readonly manifestHash: string
}

export interface RemotePluginDownload extends RemotePluginManifest {
  readonly files: ReadonlyMap<string, Uint8Array>
}

interface PackageEntry {
  path: string
  directory: boolean
}

export function remoteManifestUrl(input: string): string | null {
  const value = input.trim()
  if (/^[a-z]:(?!\/\/)/iu.test(value) || !/^[a-z][a-z\d+.-]*:/iu.test(value)) return null
  if (!/^https:\/\//iu.test(value)) throw new Error('Remote plugin manifests require HTTPS.')
  const authority = /^https:\/\/([^/?#\\]+)/iu.exec(value)?.[1]
  if (!authority || authority.includes('@') || value.length > MAX_REMOTE_MANIFEST_URL_LENGTH)
    throw new Error('Invalid remote plugin manifest URL.')
  let url = new URL(value)
  if (url.username || url.password)
    throw new Error('Remote plugin URLs cannot include credentials.')
  url.hash = ''
  if (url.origin === 'https://github.com') {
    const [, owner, repo, route, ...path] = url.pathname.split('/')
    if (owner && repo && (route === 'blob' || route === 'raw')) {
      if (path.length < 2 || !path.every(Boolean))
        throw new Error('Invalid GitHub plugin manifest URL.')
      url = new URL(`/${owner}/${repo}/${path.join('/')}${url.search}`, RAW_GITHUB)
    }
  }
  if (url.href.length > MAX_REMOTE_MANIFEST_URL_LENGTH)
    throw new Error('Invalid remote plugin manifest URL.')
  return url.href
}

function packagePaths(manifest: RemotePluginManifest['manifest']): string[] {
  const entries = new Map<string, PackageEntry>([
    [MANIFEST_FILENAME, { path: MANIFEST_FILENAME, directory: false }],
  ])
  const paths = new Set([manifest.entry])
  const declared = new Set<string>()
  for (const path of manifest.files ?? []) {
    if (declared.has(path)) throw new Error('Duplicate remote plugin file.')
    declared.add(path)
    paths.add(path)
  }
  for (const path of paths) {
    const segments = path.split('/')
    if (segments.length > MAX_PACKAGE_DEPTH + 1)
      throw new Error('Plugin package is nested too deeply.')
    let prefix = ''
    for (const [index, segment] of segments.entries()) {
      if (
        !/^[a-z\d_][a-z\d_.-]{0,159}$/iu.test(segment) ||
        segment.endsWith('.') ||
        segment.toLowerCase() === 'node_modules' ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)
      ) {
        throw new Error('Invalid remote plugin file path.')
      }
      prefix += index === 0 ? segment : `/${segment}`
      const key = prefix.toLowerCase()
      const directory = index < segments.length - 1
      const previous = entries.get(key)
      if (previous && (previous.path !== prefix || !previous.directory || !directory))
        throw new Error('Conflicting remote plugin file paths.')
      if (!previous) entries.set(key, { path: prefix, directory })
      if (entries.size > MAX_PACKAGE_ENTRIES)
        throw new Error('Plugin package contains too many files.')
    }
  }
  return [...paths]
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error('Invalid JSON in remote plugin response.')
  }
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  await body?.cancel().catch(() => undefined)
}

async function responseFor(
  url: URL,
  signal: AbortSignal,
  fetcher: PluginFetch,
  headers?: HeadersInit,
): Promise<Response> {
  signal.throwIfAborted()
  const response = await fetcher(url, { signal, redirect: 'manual', credentials: 'omit', headers })
  if (response.status >= 300 && response.status < 400) {
    await cancelBody(response.body)
    throw new Error('Remote plugin downloads do not follow redirects.')
  }
  return response
}

async function boundedBytes(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.ok || Number(response.headers.get('content-length')) > limit) {
    await cancelBody(response.body)
    if (!response.ok) throw new Error(`Remote plugin request failed (HTTP ${response.status}).`)
    throw new Error('Remote plugin download exceeds its size limit.')
  }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const abort = () => {
    reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', abort, { once: true })
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      signal.throwIfAborted()
      // eslint-disable-next-line no-await-in-loop
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > limit) throw new Error('Remote plugin download exceeds its size limit.')
      if (result.value.byteLength) chunks.push(result.value)
    }
    signal.throwIfAborted()
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function readManifest(url: URL, signal: AbortSignal, fetcher: PluginFetch) {
  const bytes = await boundedBytes(
    await responseFor(url, signal, fetcher),
    MAX_MANIFEST_BYTES,
    signal,
  )
  const parsed = remoteManifestSchema.safeParse(parseJson(bytes))
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join('.')
    throw new Error(`Invalid plugin manifest${path ? ` (${path})` : ''}.`)
  }
  return { manifest: parsed.data, bytes, hash: Bun.CryptoHasher.hash('sha256', bytes, 'hex') }
}

export async function readRemotePluginManifest(
  input: string,
  signal: AbortSignal,
  fetcher: PluginFetch = fetch,
): Promise<RemotePluginManifest> {
  const sourceUrl = remoteManifestUrl(input)
  if (!sourceUrl) throw new Error('Expected a remote plugin manifest URL.')
  const { manifest, hash } = await readManifest(new URL(sourceUrl), signal, fetcher)
  packagePaths(manifest)
  return { sourceUrl, manifest, manifestHash: hash }
}

async function pinGithubManifest(
  url: URL,
  signal: AbortSignal,
  fetcher: PluginFetch,
): Promise<URL> {
  const [, owner, repo, ...path] = url.pathname.split('/')
  if (!owner || !repo || path.length < 2 || !path.every(Boolean))
    throw new Error('Invalid GitHub plugin manifest URL.')
  if (!/^[a-z\d_.-]+$/iu.test(owner) || !/^[a-z\d_.-]+$/iu.test(repo))
    throw new Error('Invalid GitHub plugin repository.')
  const explicitRef = path[0] === 'refs' && (path[1] === 'heads' || path[1] === 'tags')
  const start = explicitRef ? 2 : 0
  if (!explicitRef && path[0] && GITHUB_SHA.test(path[0])) return url
  if (path.length - 1 - start > MAX_GITHUB_REF_PROBES)
    throw new Error('The GitHub plugin URL is too deeply nested. Use a commit URL.')

  for (let split = path.length - 1; split > start; split--) {
    const ref = decodeURIComponent(path.slice(0, split).join('/'))
    const api = new URL(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, GITHUB_API)
    // eslint-disable-next-line no-await-in-loop
    const response = await responseFor(api, signal, fetcher, {
      Accept: 'application/vnd.github.sha',
    })
    if (response.status === 404 || response.status === 422) {
      // eslint-disable-next-line no-await-in-loop
      await cancelBody(response.body)
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const bytes = await boundedBytes(response, 128, signal)
    const sha = new TextDecoder().decode(bytes).trim()
    if (!GITHUB_SHA.test(sha)) throw new Error('GitHub did not return a valid plugin commit.')
    return new URL(`/${owner}/${repo}/${sha}/${path.slice(split).join('/')}`, RAW_GITHUB)
  }
  throw new Error('Could not resolve the GitHub plugin ref.')
}

function verifyManifest(checked: RemotePluginManifest, hash: string) {
  if (checked.manifestHash !== hash)
    throw new Error('The remote plugin manifest changed during download. Try again.')
}

export async function downloadRemotePlugin(
  checked: RemotePluginManifest,
  signal: AbortSignal,
  fetcher: PluginFetch = fetch,
): Promise<RemotePluginDownload> {
  const source = new URL(checked.sourceUrl)
  const github = source.origin === RAW_GITHUB
  const url = github ? await pinGithubManifest(source, signal, fetcher) : source
  const pinned = github ? await readManifest(url, signal, fetcher) : undefined
  if (pinned) verifyManifest(checked, pinned.hash)

  const files = new Map<string, Uint8Array>()
  let remaining = MAX_PACKAGE_BYTES - (pinned?.bytes.byteLength ?? 0)
  const directory = new URL('.', url)
  for (const path of packagePaths(checked.manifest)) {
    const file = new URL(path, directory)
    // eslint-disable-next-line no-await-in-loop
    const response = await responseFor(file, signal, fetcher)
    // eslint-disable-next-line no-await-in-loop
    const bytes = await boundedBytes(response, remaining, signal)
    files.set(path, bytes)
    remaining -= bytes.byteLength
  }

  const final = pinned ?? (await readManifest(source, signal, fetcher))
  if (!pinned) verifyManifest(checked, final.hash)
  if (!pinned && final.bytes.byteLength > remaining)
    throw new Error('Remote plugin download exceeds its size limit.')
  files.set(MANIFEST_FILENAME, final.bytes)
  return { ...checked, files }
}
