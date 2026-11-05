import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginChannel, PluginEventMap, PluginTransportStatus } from '../src/plugins/api'
import { createPluginManager, type PluginManager } from '../src/plugins/manager'
import type { PluginFetch } from '../src/plugins/remote-packages'

const channel: PluginChannel = { platform: 'twitch', id: 'example', name: 'Example' }
const input = { text: '/plugin-test message', args: ['message'], channel }

type Listeners = { [Event in keyof PluginEventMap]: Set<(event: PluginEventMap[Event]) => void> }
type RemoteOptions = Pick<
  Parameters<typeof createPluginManager>[0],
  'remoteFetch' | 'remoteUpdateIntervalMs'
>

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'twirchat-plugin-test-'))
  const installed = join(directory, 'installed')
  const messages: string[] = []
  const listeners: Listeners = {
    message: new Set(),
    channelStatus: new Set(),
    chatEvent: new Set(),
    roomState: new Set(),
    moderation: new Set(),
    chatCleared: new Set(),
  }
  const managers: PluginManager[] = []
  function createManager(remoteOptions?: RemoteOptions) {
    const manager = createPluginManager({
      ...remoteOptions,
      directory: installed,
      appVersion: '1.2.3',
      host: {
        getChannels: () => Promise.resolve([channel]),
        sendMessage: (_channel, text) => {
          messages.push(text)
          return Promise.resolve()
        },
        addSystemMessage: (_channel, text) => {
          messages.push(text)
          return Promise.resolve()
        },
        subscribe<Event extends keyof PluginEventMap>(
          event: Event,
          listener: (payload: PluginEventMap[Event]) => void,
        ) {
          listeners[event].add(listener)
          return () => {
            listeners[event].delete(listener)
          }
        },
      },
      onChange() {},
    })
    managers.push(manager)
    return manager
  }
  async function createPackage(
    id: string,
    entry: string,
    options?: { apiVersion?: number; entryPath?: string },
  ) {
    const source = join(directory, `source-${id}`)
    await mkdir(source)
    const manifest = join(source, 'manifest.json')
    await Promise.all([
      Bun.write(
        manifest,
        JSON.stringify({
          id,
          name: id,
          version: '1.0.0',
          apiVersion: options?.apiVersion ?? 1,
          entry: options?.entryPath ?? 'index.ts',
        }),
      ),
      Bun.write(join(source, 'index.ts'), entry),
    ])
    return { manifest, source }
  }
  return {
    directory,
    installed,
    managers,
    messages,
    listeners,
    createManager,
    createPackage,
    async dispose() {
      await Promise.allSettled(managers.map((manager) => manager.dispose()))
      await rm(directory, { recursive: true, force: true })
    },
  }
}

function chatMessage(text: string): PluginEventMap['message'] {
  return {
    channel,
    id: text,
    author: { id: 'sender', name: 'Sender' },
    text,
    timestamp: Date.now(),
    type: 'message',
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 4000
  // eslint-disable-next-line no-await-in-loop
  while (!(await predicate())) {
    if (performance.now() >= deadline)
      throw new Error('Timed out waiting for plugin test condition.')
    // eslint-disable-next-line no-await-in-loop
    await Bun.sleep(5)
  }
}

const remoteManifestUrl = 'https://plugins.example.com/chat/manifest.json'
const remoteEntryUrl = 'https://plugins.example.com/chat/index.ts'

function remoteEntry(version: string): string {
  return `
    export default (api) => {
      api.registerCommand('plugin-test', ({channel}) => api.sendMessage(channel, ${JSON.stringify(version)}))
      api.registerTransport('chat', {
        name: 'Remote Chat',
        connect(channel, {emitMessage}) {
          emitMessage({id: channel, author: {id: 'source', name: 'Source'}, text: ${JSON.stringify(version)}})
        },
      })
    }
  `
}

function remoteFixture() {
  const manifest = {
    id: 'remote-chat',
    name: 'Remote Chat',
    version: '1.0.0',
    apiVersion: 1,
    entry: 'index.ts',
  }
  const requests: string[] = []
  const remote = {
    manifest,
    requests,
    source: remoteEntry(manifest.version),
    update(version: string) {
      manifest.version = version
      remote.source = remoteEntry(version)
    },
  }
  const fetcher: PluginFetch = async (url, { signal }) => {
    signal?.throwIfAborted()
    requests.push(url.href)
    if (url.href === remoteManifestUrl) return Response.json(manifest)
    if (url.href === remoteEntryUrl) return new Response(remote.source)
    return new Response(null, { status: 404 })
  }
  return Object.assign(remote, { fetcher })
}

test('remote plugins install disabled, update enabled commands and transports, and retain their source after restart', async () => {
  const testData = await fixture()
  const remote = remoteFixture()
  try {
    const manager = testData.createManager({ remoteFetch: remote.fetcher })
    await manager.initialize()
    await manager.install(remoteManifestUrl)
    expect(manager.list()[0]).toMatchObject({
      id: remote.manifest.id,
      version: '1.0.0',
      sourceUrl: remoteManifestUrl,
      enabled: false,
      status: 'disabled',
    })
    expect(manager.commandNames()).toEqual([])
    await manager.setEnabled(remote.manifest.id, true)
    await manager.runCommand('plugin-test', input)
    expect(testData.messages).toEqual(['1.0.0'])

    remote.requests.length = 0
    remote.update('2.0.0')
    const updates = await Promise.all([
      manager.checkForUpdate(remote.manifest.id),
      manager.checkForUpdate(remote.manifest.id),
    ])
    expect(updates).toEqual([true, true])
    expect(remote.requests.filter((url) => url === remoteEntryUrl)).toHaveLength(1)
    expect(manager.list()[0]).toMatchObject({ version: '2.0.0', enabled: true, status: 'running' })
    await manager.runCommand('plugin-test', input)
    expect(testData.messages).toEqual(['1.0.0', '2.0.0'])
    const received: string[] = []
    const connection = await manager.openTransport('plugin:remote-chat:chat', 'room', {
      message: (message) => received.push(message.text),
      status() {},
    })
    await waitFor(() => received.length > 0)
    expect(received).toEqual(['2.0.0'])
    await connection.close()
    await manager.dispose()

    remote.requests.length = 0
    const restarted = testData.createManager({ remoteFetch: remote.fetcher })
    await restarted.initialize()
    expect(restarted.list()[0]).toMatchObject({
      sourceUrl: remoteManifestUrl,
      version: '2.0.0',
      enabled: true,
      status: 'running',
    })
    await waitFor(() => remote.requests.length > 0)
    expect(remote.requests).toEqual([remoteManifestUrl])
  } finally {
    await testData.dispose()
  }
})

test('a failed remote activation restores the current package and incompatible or older versions are not downloaded', async () => {
  const testData = await fixture()
  const remote = remoteFixture()
  try {
    const manager = testData.createManager({ remoteFetch: remote.fetcher })
    const id = remote.manifest.id
    await manager.install(remoteManifestUrl)
    await manager.setEnabled(id, true)
    remote.manifest.version = '2.0.0'
    remote.source = "export default () => { throw new Error('candidate activation failed') }"
    await expect(manager.checkForUpdate(id)).rejects.toThrow('candidate activation failed')
    expect(manager.list()[0]).toMatchObject({
      version: '1.0.0',
      enabled: true,
      status: 'running',
      updateError: 'candidate activation failed',
    })
    await manager.runCommand('plugin-test', input)
    expect(testData.messages).toEqual(['1.0.0'])

    remote.requests.length = 0
    remote.manifest.version = '0.9.0'
    expect(await manager.checkForUpdate(id)).toBe(false)
    expect(manager.list()[0]?.updateError).toBeUndefined()
    expect(remote.requests).toEqual([remoteManifestUrl])

    remote.requests.length = 0
    remote.manifest.version = '2.0.0'
    remote.manifest.apiVersion = 999
    await expect(manager.checkForUpdate(id)).rejects.toThrow('incompatible')
    expect(remote.requests).toEqual([remoteManifestUrl])
    expect(manager.list()[0]).toMatchObject({ version: '1.0.0', status: 'running' })

    remote.requests.length = 0
    remote.manifest.apiVersion = 1
    remote.manifest.id = 'other-plugin'
    await expect(manager.checkForUpdate(id)).rejects.toThrow('different plugin')
    expect(remote.requests).toEqual([remoteManifestUrl])
    await manager.dispose()

    remote.manifest.version = '1.0.0'
    remote.manifest.id = id
    const restarted = testData.createManager({ remoteFetch: remote.fetcher })
    await restarted.initialize()
    await restarted.runCommand('plugin-test', input)
    expect(testData.messages).toEqual(['1.0.0', '1.0.0'])
  } finally {
    await testData.dispose()
  }
})

test('the automatic updater checks periodically and aborts an in-flight request on shutdown', async () => {
  const testData = await fixture()
  const remote = remoteFixture()
  let blockRequests = false
  let inFlight: AbortSignal | undefined
  const fetcher: PluginFetch = async (url, init) => {
    if (!blockRequests) return remote.fetcher(url, init)
    const { signal } = init
    if (!signal) throw new Error('Remote requests must be cancellable.')
    signal.throwIfAborted()
    inFlight = signal
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true })
    })
  }
  try {
    const manager = testData.createManager({ remoteFetch: fetcher, remoteUpdateIntervalMs: 25 })
    await manager.initialize()
    await manager.install(remoteManifestUrl)
    remote.update('2.0.0')
    await waitFor(() => manager.list()[0]?.version === '2.0.0')
    expect(manager.list()[0]).toMatchObject({ enabled: false, status: 'disabled' })

    blockRequests = true
    await waitFor(() => inFlight !== undefined)
    const check = manager.checkForUpdate(remote.manifest.id).catch((error: unknown) => error)
    await manager.setEnabled(remote.manifest.id, true)
    expect(manager.list()[0]?.status).toBe('running')
    await manager.dispose()
    expect(await check).toMatchObject({ message: 'request aborted' })
    expect(inFlight?.aborted).toBe(true)
  } finally {
    await testData.dispose()
  }
})

test('plugins stay disabled after install, run commands and events, and restore saved enablement', async () => {
  const testData = await fixture()
  try {
    const { manifest, source } = await testData.createPackage(
      'example',
      `
      import { prefix } from './helper.ts'
      export default (api) => {
        if (api.version !== 1 || api.appVersion !== '1.2.3') throw new Error('Wrong SDK version')
        api.registerCommand('plugin-test', async ({ args }) => {
          const [channel] = await api.getChannels()
          await api.sendMessage(channel, prefix + args[0])
        })
        api.on('message', ({ channel, text }) => api.addSystemMessage(channel, 'event: ' + text))
      }
    `,
    )
    await Bun.write(join(source, 'helper.ts'), `export const prefix = 'command: '`)
    const manager = testData.createManager()
    await manager.initialize()
    await manager.install(manifest)
    await rm(source, { recursive: true })
    expect(manager.list()[0]).toMatchObject({ status: 'disabled', enabled: false })
    expect(manager.commandNames()).toEqual([])
    expect(testData.listeners.message.size).toBe(0)

    await manager.setEnabled('example', true)
    expect(manager.list()[0]).toMatchObject({ status: 'running', enabled: true })
    expect(manager.hasCommand('plugin-test')).toBe(true)
    expect(manager.commandNames()).toEqual(['plugin-test'])
    expect(testData.listeners.message.size).toBe(1)
    await manager.runCommand('plugin-test', input)
    for (const listener of testData.listeners.message) listener(chatMessage('hello'))
    await waitFor(() => testData.messages.length === 2)
    expect(testData.messages).toEqual(['command: message', 'event: hello'])

    await manager.dispose()
    expect(testData.listeners.message.size).toBe(0)
    const restored = testData.createManager()
    await restored.initialize()
    expect(restored.list()[0]).toMatchObject({ status: 'running', enabled: true })
    await restored.setEnabled('example', false)
    expect(testData.listeners.message.size).toBe(0)
    expect(restored.hasCommand('plugin-test')).toBe(false)
    await restored.remove('example')
    expect(restored.list()).toEqual([])
  } finally {
    await testData.dispose()
  }
})

test('plugin manifests reject traversal and incompatible versions stay visible and inert', async () => {
  const testData = await fixture()
  try {
    const manager = testData.createManager()
    const future = await testData.createPackage('future', `throw new Error('must not run')`, {
      apiVersion: 50,
    })
    await manager.install(future.manifest)
    expect(manager.list()[0]).toMatchObject({ status: 'incompatible', enabled: false })
    await expect(manager.setEnabled('future', true)).rejects.toThrow('incompatible')
    const traversal = await testData.createPackage('traversal', '', { entryPath: '../escape.ts' })
    await expect(manager.install(traversal.manifest)).rejects.toThrow('Invalid plugin manifest')
    if (process.platform !== 'win32') {
      const linked = await testData.createPackage('linked', '')
      await symlink(join(future.source, 'index.ts'), join(linked.source, 'external.ts'))
      await expect(manager.install(linked.manifest)).rejects.toThrow('regular files')
    }
    expect(manager.list()).toHaveLength(1)
  } finally {
    await testData.dispose()
  }
})

test('an event handler failure removes the failed plugin capabilities while another plugin runs', async () => {
  const testData = await fixture()
  try {
    const manager = testData.createManager()
    const broken = await testData.createPackage(
      'broken',
      `
      export default (api) => {
        api.registerCommand('broken', () => {})
        api.on('message', () => { throw new Error('broken event') })
      }
    `,
    )
    const healthy = await testData.createPackage(
      'healthy',
      `
      export default (api) => {
        api.registerCommand('plugin-test', ({ channel }) => api.addSystemMessage(channel, 'healthy'))
        api.on('message', ({ channel }) => api.addSystemMessage(channel, 'healthy event'))
      }
    `,
    )
    await manager.install(broken.manifest)
    await manager.install(healthy.manifest)
    await manager.setEnabled('broken', true)
    await manager.setEnabled('healthy', true)
    expect(testData.listeners.message.size).toBe(1)
    for (const listener of testData.listeners.message) listener(chatMessage('go'))
    await waitFor(() =>
      manager.list().some(({ id, status }) => id === 'broken' && status === 'error'),
    )
    expect(manager.list().find(({ id }) => id === 'broken')?.error).toBe('broken event')
    expect(manager.commandNames()).toEqual(['plugin-test'])
    expect(testData.listeners.message.size).toBe(1)
    await manager.runCommand('plugin-test', input)
    expect(testData.messages).toContain('healthy')
    expect(testData.messages).toContain('healthy event')
  } finally {
    await testData.dispose()
  }
})

test('a busy plugin cannot block desktop work and is force-stopped on disable', async () => {
  const testData = await fixture()
  try {
    const started = join(testData.directory, 'started')
    const manager = testData.createManager()
    const busy = await testData.createPackage(
      'busy',
      `
      import { writeFileSync } from 'node:fs'
      export default (api) => api.registerCommand('plugin-test', () => {
        writeFileSync(${JSON.stringify(started)}, '1')
        while (true) {}
      })
    `,
    )
    await manager.install(busy.manifest)
    await manager.setEnabled('busy', true)
    const result = manager.runCommand('plugin-test', input).catch((error: unknown) => error)
    await waitFor(() => Bun.file(started).exists())
    await manager.setEnabled('busy', false)
    expect(await result).toEqual(new Error('Plugin was disabled.'))
    expect(manager.list()[0]?.status).toBe('disabled')
    expect(manager.hasCommand('plugin-test')).toBe(false)
  } finally {
    await testData.dispose()
  }
})

test('a slow plugin queue is bounded and reports dropped events', async () => {
  const testData = await fixture()
  try {
    const manager = testData.createManager()
    const slow = await testData.createPackage(
      'slow',
      `
      export default (api) => api.on('message', async ({ channel, text }) => {
        await Bun.sleep(1)
        await api.addSystemMessage(channel, text)
      })
    `,
    )
    await manager.install(slow.manifest)
    await manager.setEnabled('slow', true)
    for (const listener of testData.listeners.message) {
      for (let index = 0; index < 700; index++) listener(chatMessage(String(index)))
    }
    await waitFor(() => testData.messages.length === 512)
    expect(manager.list()[0]).toMatchObject({
      status: 'running',
      error: 'Some chat events were dropped while this plugin was busy.',
    })
    expect(testData.messages).toEqual(Array.from({ length: 512 }, (_, index) => String(index)))
  } finally {
    await testData.dispose()
  }
})

test('transport routes incoming and outgoing messages and cleans connections on disable', async () => {
  const testData = await fixture()
  try {
    const marker = join(testData.directory, 'transport-cleaned')
    const cleanup = join(testData.directory, 'plugin-cleaned')
    const manager = testData.createManager()
    const transport = await testData.createPackage(
      'connector',
      `
      export default (api) => {
        api.registerTransport('demo', {
          name: 'Demo',
          connect(channel, context) {
            context.emitMessage({ id: channel, author: { id: '1', name: 'Demo' }, text: 'Connected' })
            return async () => Bun.write(${JSON.stringify(marker)}, String(context.signal.aborted))
          },
          sendMessage(channel, text, context) {
            context.emitMessage({ id: channel + ':reply', author: { id: '1', name: 'Demo' }, text })
          },
        })
        return async () => Bun.write(${JSON.stringify(cleanup)}, 'cleaned')
      }
    `,
    )
    await manager.install(transport.manifest)
    await manager.setEnabled('connector', true)
    const registered = manager.transports()
    expect(registered).toEqual([{ platform: 'plugin:connector:demo', name: 'Demo', canSend: true }])
    expect(manager.transports()).toBe(registered)
    const statuses: PluginTransportStatus[] = []
    const received: string[] = []
    const connection = await manager.openTransport('plugin:connector:demo', 'room', {
      status: (status) => statuses.push(status),
      message: ({ text }) => received.push(text),
    })
    await connection.sendMessage('A message')
    await waitFor(() => received.length === 2)
    expect(received).toEqual(['Connected', 'A message'])
    expect(statuses).toEqual([{ status: 'connected' }])
    await manager.setEnabled('connector', false)
    expect(statuses).toEqual([{ status: 'connected' }, { status: 'disconnected' }])
    expect(manager.transports()).toEqual([])
    expect(await Bun.file(marker).text()).toBe('true')
    expect(await Bun.file(cleanup).text()).toBe('cleaned')
    await connection.close()
    await expect(connection.sendMessage('offline')).rejects.toThrow('closed')
  } finally {
    await testData.dispose()
  }
})
