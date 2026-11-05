import { resolve } from 'node:path'

import { logger } from '@twirchat/shared/logger'

import { APP_VERSION } from '../build-info'
import {
  PLUGIN_API_VERSION,
  type PluginChannel,
  type PluginCommandContext,
  type PluginEventMap,
  type PluginInfo,
  type PluginPlatform,
  type PluginTransportCallbacks,
  type PluginTransportConnection,
  type PluginTransportInfo,
  type PluginTransportStatus,
} from './api'
import {
  installPluginPackage,
  installRemotePluginPackage,
  listInstalledPlugins,
  removePluginPackage,
  stageRemotePluginUpdate,
  writePluginEnabled,
  type InstalledPlugin,
} from './packages'
import { startPluginProcess, type PluginProcess } from './process'
import {
  MAX_BATCH,
  MAX_CONNECTIONS,
  MAX_EVENT_QUEUE,
  MAX_PLUGINS,
  pluginError,
  type HostAction,
  type HostResult,
  type PluginEvent,
  type TransportUpdate,
} from './protocol'
import {
  downloadRemotePlugin,
  readRemotePluginManifest,
  remoteManifestUrl,
  type PluginFetch,
  type RemotePluginDownload,
} from './remote-packages'

const log = logger('plugins')
const REMOTE_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000
const REMOTE_REQUEST_TIMEOUT_MS = 60_000

function requireCompatible(apiVersion: number): void {
  if (apiVersion !== PLUGIN_API_VERSION)
    throw new Error(
      `Plugin API ${apiVersion} is incompatible with TwirChat API ${PLUGIN_API_VERSION}.`,
    )
}

type PluginEventName = keyof PluginEventMap

export interface PluginHost {
  sendMessage(channel: PluginChannel, text: string): Promise<void>
  addSystemMessage(channel: PluginChannel, text: string): Promise<void>
  getChannels(): Promise<PluginChannel[]>
  subscribe<Event extends PluginEventName>(
    event: Event,
    listener: (payload: PluginEventMap[Event]) => void,
  ): () => void
}

interface PluginManagerOptions {
  directory: string
  appVersion?: string
  remoteFetch?: PluginFetch
  remoteUpdateIntervalMs?: number
  host: PluginHost
  onChange(): void
}

interface ActivePlugin {
  installed: InstalledPlugin
  child: PluginProcess
  commands: string[]
  transports: PluginPlatform[]
  subscriptions: (() => void)[]
  connections: Map<number, PluginTransportCallbacks>
  nextConnectionId: number
  eventQueue: PluginEvent[]
  eventTimer?: ReturnType<typeof setTimeout>
  sendingEvents: boolean
  droppedEvents: boolean
}

interface RegisteredTransport {
  info: PluginTransportInfo
  owner: ActivePlugin
  transportId: string
}

interface EventRoute {
  consumers: Set<ActivePlugin>
  dispose?: () => void
}

interface RemoteUpdate {
  record: InstalledPlugin
  abort: AbortController
  task: Promise<boolean>
}

export interface PluginManager {
  initialize(): Promise<void>
  list(): readonly PluginInfo[]
  install(manifestPath: string): Promise<void>
  checkForUpdate(id: string): Promise<boolean>
  setEnabled(id: string, enabled: boolean): Promise<void>
  remove(id: string): Promise<void>
  dispose(): Promise<void>
  hasCommand(name: string): boolean
  commandNames(): readonly string[]
  runCommand(name: string, input: PluginCommandContext): Promise<void>
  transports(): readonly PluginTransportInfo[]
  openTransport(
    platform: string,
    channelId: string,
    callbacks: PluginTransportCallbacks,
  ): Promise<PluginTransportConnection>
}

export function createPluginManager(options: PluginManagerOptions): PluginManager {
  const directory = resolve(options.directory)
  const { host } = options
  const installed = new Map<string, InstalledPlugin>()
  const active = new Map<string, ActivePlugin>()
  const workers = new Map<InstalledPlugin, ActivePlugin>()
  const children = new Set<PluginProcess>()
  const closing = new Map<PluginProcess, Promise<void>>()
  const commands = new Map<string, ActivePlugin>()
  const transports = new Map<string, RegisteredTransport>()
  const routes = new Map<PluginEventName, EventRoute>()
  const remoteLifetime = new AbortController()
  const remoteUpdates = new Map<string, RemoteUpdate>()
  let remoteInstall: Promise<void> | undefined
  let updateTimer: ReturnType<typeof setInterval> | undefined
  let backgroundUpdates: Promise<void> | undefined
  let infoSnapshot: readonly PluginInfo[] = Object.freeze([])
  let commandsSnapshot: readonly string[] = Object.freeze([])
  let transportsSnapshot: readonly PluginTransportInfo[] = Object.freeze([])
  let mutations = Promise.resolve()
  let loading: Promise<void> | undefined
  let initialized: Promise<void> | undefined
  let startup: Promise<void>[] = []
  let disposed: Promise<void> | undefined

  function publish(): void {
    infoSnapshot = Object.freeze(
      Array.from(installed.values(), (plugin) => plugin.info).toSorted((a, b) =>
        a.id.localeCompare(b.id),
      ),
    )
    options.onChange()
  }

  function publishCapabilities(): void {
    const nextCommands = [...commands.keys()].toSorted()
    if (
      commandsSnapshot.length !== nextCommands.length ||
      nextCommands.some((name, index) => commandsSnapshot[index] !== name)
    )
      commandsSnapshot = Object.freeze(nextCommands)
    const nextTransports = Array.from(transports.values(), ({ info }) => info)
    if (
      transportsSnapshot.length !== nextTransports.length ||
      nextTransports.some((info, index) => transportsSnapshot[index] !== info)
    )
      transportsSnapshot = Object.freeze(nextTransports)
  }

  function setInfo(record: InstalledPlugin, changes: Partial<PluginInfo>): void {
    record.info = Object.freeze({ ...record.info, ...changes })
    publish()
  }

  async function executeHostAction(value: HostAction): Promise<HostResult> {
    switch (value.action) {
      case 'getChannels':
        return (await host.getChannels()).slice(0, 4096)
      case 'sendMessage':
        await host.sendMessage(value.channel, value.text)
        return null
      case 'addSystemMessage':
        await host.addSystemMessage(value.channel, value.text)
        return null
    }
    const unhandled: never = value
    return unhandled
  }

  function scheduleEvents(plugin: ActivePlugin): void {
    if (plugin.eventTimer !== undefined || plugin.sendingEvents || !plugin.eventQueue.length) return
    plugin.eventTimer = setTimeout(() => {
      plugin.eventTimer = undefined
      plugin.sendingEvents = true
      if (plugin.droppedEvents) {
        plugin.droppedEvents = false
        if (!plugin.installed.info.error)
          setInfo(plugin.installed, {
            error: 'Some chat events were dropped while this plugin was busy.',
          })
      }
      void plugin.child
        .request({ action: 'events', events: plugin.eventQueue.splice(0, MAX_BATCH) })
        .then(() => {
          plugin.sendingEvents = false
          return scheduleEvents(plugin)
        })
        .catch((error: unknown) => fail(plugin, pluginError(error)))
    }, 0)
  }

  function forwardEvent(route: EventRoute, event: PluginEvent): void {
    for (const plugin of route.consumers) {
      if (plugin.eventQueue.length >= MAX_EVENT_QUEUE) {
        plugin.droppedEvents = true
        continue
      }
      plugin.eventQueue.push(event)
      scheduleEvents(plugin)
    }
  }

  function subscribe(event: PluginEventName, plugin: ActivePlugin): () => void {
    let route = routes.get(event)
    if (!route) {
      const next: EventRoute = { consumers: new Set([plugin]) }
      routes.set(event, next)
      const subscription: Record<PluginEventName, () => () => void> = {
        message: () =>
          host.subscribe('message', (payload) => forwardEvent(next, { event: 'message', payload })),
        channelStatus: () =>
          host.subscribe('channelStatus', (payload) =>
            forwardEvent(next, { event: 'channelStatus', payload }),
          ),
        chatEvent: () =>
          host.subscribe('chatEvent', (payload) =>
            forwardEvent(next, { event: 'chatEvent', payload }),
          ),
        roomState: () =>
          host.subscribe('roomState', (payload) =>
            forwardEvent(next, { event: 'roomState', payload }),
          ),
        moderation: () =>
          host.subscribe('moderation', (payload) =>
            forwardEvent(next, { event: 'moderation', payload }),
          ),
        chatCleared: () =>
          host.subscribe('chatCleared', (payload) =>
            forwardEvent(next, { event: 'chatCleared', payload }),
          ),
      }
      try {
        next.dispose = subscription[event]()
      } catch (error) {
        routes.delete(event)
        throw error
      }
      route = next
    } else route.consumers.add(plugin)
    return () => {
      const current = routes.get(event)
      if (!current) return
      current.consumers.delete(plugin)
      if (current.consumers.size === 0) {
        routes.delete(event)
        current.dispose?.()
      }
    }
  }

  function terminateOnExit(): void {
    for (const child of children) child.kill()
  }

  function stopChild(plugin: ActivePlugin): Promise<void> {
    const { child, installed: record } = plugin
    const inProgress = closing.get(child)
    if (inProgress) return inProgress
    const task = child.close().finally(() => {
      children.delete(child)
      closing.delete(child)
      if (workers.get(record) === plugin) workers.delete(record)
      if (children.size === 0) process.removeListener('exit', terminateOnExit)
    })
    closing.set(child, task)
    return task
  }

  function forget(plugin: ActivePlugin, status: PluginTransportStatus): void {
    active.delete(plugin.installed.info.id)
    for (const name of plugin.commands) commands.delete(name)
    for (const platform of plugin.transports) transports.delete(platform)
    for (const unsubscribe of plugin.subscriptions) unsubscribe()
    clearTimeout(plugin.eventTimer)
    plugin.eventQueue.length = 0
    publishCapabilities()
    const connections = [...plugin.connections.values()]
    plugin.connections.clear()
    for (const callbacks of connections) callbacks.status(status)
  }

  function fail(plugin: ActivePlugin, error: string): void {
    const { id } = plugin.installed.info
    if (active.get(id) !== plugin) return
    log.warn('Plugin stopped', { id, error })
    forget(plugin, { status: 'error', error })
    void stopChild(plugin).catch((reason: unknown) => {
      log.warn('Could not stop plugin process', { id, error: pluginError(reason) })
    })
    setInfo(plugin.installed, { status: 'error', error })
  }

  function forwardTransportUpdates(plugin: ActivePlugin, updates: TransportUpdate[]): void {
    for (const update of updates) {
      const callbacks = plugin.connections.get(update.connectionId)
      if (update.kind === 'message') callbacks?.message(update.message)
      else callbacks?.status(update.status)
    }
  }

  async function activate(record: InstalledPlugin): Promise<void> {
    if (!record.entry || disposed) return
    const { id } = record.info
    setInfo(record, { status: 'starting', error: undefined })
    let child: PluginProcess
    try {
      child = startPluginProcess({
        entry: record.entry,
        appVersion: options.appVersion ?? APP_VERSION,
        hostAction: executeHostAction,
        onTransportUpdates: (updates) => {
          const plugin = active.get(id)
          if (plugin?.child === child) forwardTransportUpdates(plugin, updates)
        },
        onFailure: (error) => {
          const plugin = active.get(id)
          if (plugin?.child === child) fail(plugin, error)
        },
      })
    } catch (error) {
      setInfo(record, { status: 'error', error: pluginError(error) })
      return
    }
    const plugin: ActivePlugin = {
      installed: record,
      child,
      commands: [],
      transports: [],
      subscriptions: [],
      connections: new Map(),
      nextConnectionId: 0,
      eventQueue: [],
      sendingEvents: false,
      droppedEvents: false,
    }
    if (children.size === 0) process.once('exit', terminateOnExit)
    children.add(child)
    workers.set(record, plugin)
    active.set(id, plugin)
    try {
      const registration = await child.ready
      if (active.get(id) !== plugin) return
      for (const name of registration.commands) {
        const owner = commands.get(name)
        if (owner)
          throw new Error(`/${name} is already registered by ${owner.installed.info.name}.`)
        commands.set(name, plugin)
        plugin.commands.push(name)
      }
      for (const { id: transportId, name, canSend } of registration.transports) {
        const platform: PluginPlatform = `plugin:${id}:${transportId}`
        const info = Object.freeze({ platform, name, canSend })
        transports.set(platform, { info, owner: plugin, transportId })
        plugin.transports.push(platform)
      }
      for (const event of registration.events) plugin.subscriptions.push(subscribe(event, plugin))
      publishCapabilities()
      setInfo(record, { status: 'running' })
    } catch (error) {
      fail(plugin, pluginError(error))
    }
  }

  async function loadInstalled(): Promise<void> {
    const records = await listInstalledPlugins(directory)
    if (disposed) return
    for (const record of records) {
      record.info = Object.freeze(record.info)
      installed.set(record.info.id, record)
    }
    if (records.length) publish()
    startup = records.filter((record) => record.info.enabled).map(activate)
  }

  function load(): Promise<void> {
    return (loading ??= loadInstalled())
  }

  function mutate<Result>(action: () => Promise<Result>): Promise<Result> {
    const task = mutations.then(async () => {
      await load()
      if (disposed) throw new Error('The plugin manager is shutting down.')
      return action()
    })
    mutations = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  function stop(record: InstalledPlugin): Promise<void> {
    const plugin = workers.get(record)
    if (!plugin) return Promise.resolve()
    const stopped = stopChild(plugin)
    if (active.get(record.info.id) === plugin) forget(plugin, { status: 'disconnected' })
    return stopped
  }

  function publishInstalled(record: InstalledPlugin): void {
    record.info = Object.freeze(record.info)
    installed.set(record.info.id, record)
    publish()
  }

  async function installRemote(sourceUrl: string): Promise<void> {
    await load()
    const signal = AbortSignal.any([
      remoteLifetime.signal,
      AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS),
    ])
    signal.throwIfAborted()
    const manifest = await readRemotePluginManifest(sourceUrl, signal, options.remoteFetch)
    requireCompatible(manifest.manifest.apiVersion)
    if (installed.size >= MAX_PLUGINS) throw new Error('The installed plugin limit was reached.')
    if (installed.has(manifest.manifest.id))
      throw new Error(`Plugin ${manifest.manifest.id} is already installed.`)
    const download = await downloadRemotePlugin(manifest, signal, options.remoteFetch)
    await mutate(async () => {
      signal.throwIfAborted()
      publishInstalled(await installRemotePluginPackage(directory, download, installed))
    })
  }

  function applyRemoteUpdate(
    previous: InstalledPlugin,
    download: RemotePluginDownload,
    signal: AbortSignal,
  ): Promise<boolean> {
    return mutate(async () => {
      const { id } = previous.info
      if (installed.get(id) !== previous) return false
      signal.throwIfAborted()
      const stage = await stageRemotePluginUpdate(directory, previous, download)
      const candidate = stage.record
      try {
        signal.throwIfAborted()
        await stop(previous)
        signal.throwIfAborted()
        if (candidate.info.enabled) {
          await activate(candidate)
          if (candidate.info.status !== 'running')
            throw new Error(candidate.info.error ?? 'Updated plugin did not activate.')
        }
        signal.throwIfAborted()
        await stage.commit()
      } catch (error) {
        try {
          await stop(candidate)
          await stage.discard()
        } catch (reason) {
          log.warn('Could not clean up updated plugin', { id, error: pluginError(reason) })
        }
        if (previous.info.enabled && !active.has(id) && !disposed) await activate(previous)
        throw error
      }
      publishInstalled(candidate)
      return true
    })
  }

  async function updateRemote(
    record: InstalledPlugin,
    sourceUrl: string,
    abort: AbortController,
  ): Promise<boolean> {
    const { id, version } = record.info
    const signal = AbortSignal.any([
      remoteLifetime.signal,
      abort.signal,
      AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS),
    ])
    try {
      signal.throwIfAborted()
      const manifest = await readRemotePluginManifest(sourceUrl, signal, options.remoteFetch)
      if (manifest.manifest.id !== id)
        throw new Error('The remote manifest belongs to a different plugin.')
      if (Bun.semver.order(version, manifest.manifest.version) >= 0) {
        if (installed.get(id) === record && record.info.updateError)
          setInfo(record, { updateError: undefined })
        return false
      }
      requireCompatible(manifest.manifest.apiVersion)
      signal.throwIfAborted()
      const download = await downloadRemotePlugin(manifest, signal, options.remoteFetch)
      return await applyRemoteUpdate(record, download, signal)
    } catch (error) {
      if (!disposed && !abort.signal.aborted && installed.get(id) === record)
        setInfo(record, { updateError: pluginError(error) })
      throw error
    }
  }

  async function checkForUpdate(id: string): Promise<boolean> {
    await load()
    remoteLifetime.signal.throwIfAborted()
    const record = installed.get(id)
    if (!record) throw new Error('This plugin is no longer installed.')
    if (!record.remote) throw new Error('This plugin has no remote update source.')
    const pending = remoteUpdates.get(id)
    if (pending?.record === record) return pending.task
    const abort = new AbortController()
    const task = updateRemote(record, record.remote.sourceUrl, abort).finally(() => {
      if (remoteUpdates.get(id)?.record === record) remoteUpdates.delete(id)
    })
    remoteUpdates.set(id, { record, abort, task })
    return task
  }

  async function checkRemotePlugins(): Promise<void> {
    const records = [...installed.values()]
    for (const record of records) {
      const { id } = record.info
      if (disposed) return
      if (!record.remote || installed.get(id) !== record) continue
      // eslint-disable-next-line no-await-in-loop
      await checkForUpdate(id).catch((error: unknown) => {
        if (!disposed && installed.get(id) === record)
          log.warn('Could not update plugin', { id, error: pluginError(error) })
      })
    }
  }

  function scheduleRemoteUpdates(): void {
    if (disposed || backgroundUpdates) return
    backgroundUpdates = checkRemotePlugins().finally(() => {
      backgroundUpdates = undefined
    })
    void backgroundUpdates.catch((error: unknown) => {
      log.warn('Could not check plugin updates', { error: pluginError(error) })
    })
  }

  return {
    initialize() {
      return (initialized ??= load().then(async () => {
        await Promise.all(startup)
        startup = []
        if (!disposed) {
          updateTimer = setInterval(
            scheduleRemoteUpdates,
            options.remoteUpdateIntervalMs ?? REMOTE_UPDATE_INTERVAL_MS,
          )
          updateTimer.unref()
          scheduleRemoteUpdates()
        }
        return undefined
      }))
    },
    list: () => infoSnapshot,
    async install(manifestPath) {
      const sourceUrl = remoteManifestUrl(manifestPath)
      if (sourceUrl) {
        if (remoteInstall) throw new Error('Another remote plugin installation is in progress.')
        remoteInstall = installRemote(sourceUrl).finally(() => {
          remoteInstall = undefined
        })
        return remoteInstall
      }
      return mutate(async () => {
        publishInstalled(await installPluginPackage(directory, manifestPath, installed))
      })
    },
    checkForUpdate,
    async setEnabled(id, enabled) {
      const result = await mutate(async () => {
        const record = installed.get(id)
        if (!record) throw new Error('This plugin is no longer installed.')
        if (!record.entry && enabled)
          throw new Error(record.info.error ?? 'Plugin is incompatible.')
        if (record.info.enabled !== enabled) await writePluginEnabled(directory, id, enabled)
        if (enabled) {
          if (active.has(id)) return null
          record.info = Object.freeze({ ...record.info, enabled: true })
          return { activation: activate(record) }
        }
        await stop(record)
        setInfo(
          record,
          record.entry
            ? { enabled: false, status: 'disabled', error: undefined }
            : { enabled: false },
        )
        return null
      })
      await result?.activation
    },
    remove(id) {
      return mutate(async () => {
        const record = installed.get(id)
        if (!record) throw new Error('This plugin is no longer installed.')
        await stop(record)
        try {
          await removePluginPackage(directory, id)
        } catch (error) {
          if (record.info.enabled) {
            void activate(record).catch((reason: unknown) => {
              log.warn('Could not restore plugin after removal failed', {
                id,
                error: pluginError(reason),
              })
            })
          }
          throw error
        }
        installed.delete(id)
        remoteUpdates.get(id)?.abort.abort()
        publish()
      })
    },
    dispose() {
      if (!disposed) {
        const result = Promise.withResolvers<void>()
        disposed = result.promise
        clearInterval(updateTimer)
        remoteLifetime.abort()
        const remoteTasks = Promise.allSettled([
          remoteInstall,
          backgroundUpdates,
          ...Array.from(remoteUpdates.values(), (update) => update.task),
        ])
        const tasks = [...active.values()].map(({ installed: record }) => stop(record))
        void Promise.all([mutations, remoteTasks, ...closing.values(), ...tasks]).then(
          () => result.resolve(),
          (error: unknown) => result.reject(error),
        )
      }
      return disposed
    },
    hasCommand: (name) => commands.has(name),
    commandNames: () => commandsSnapshot,
    async runCommand(name, input) {
      const plugin = commands.get(name)
      if (!plugin) throw new Error(`Plugin command /${name} is unavailable.`)
      await plugin.child.request({ action: 'command', name, input })
    },
    transports: () => transportsSnapshot,
    async openTransport(platform, channelId, callbacks) {
      const registration = transports.get(platform)
      if (!registration) throw new Error('This plugin transport is unavailable.')
      const { owner, transportId, info } = registration
      if (owner.connections.size >= MAX_CONNECTIONS)
        throw new Error('Plugin channel limit reached.')
      const connectionId = ++owner.nextConnectionId
      owner.connections.set(connectionId, callbacks)
      try {
        await owner.child.request({ action: 'connect', transportId, channelId, connectionId })
      } catch (error) {
        owner.connections.delete(connectionId)
        throw error
      }
      return {
        async close() {
          if (!owner.connections.delete(connectionId)) return
          await owner.child.request({ action: 'disconnect', connectionId })
        },
        async sendMessage(text) {
          if (!info.canSend) throw new Error('This plugin channel is read-only.')
          if (!owner.connections.has(connectionId))
            throw new Error('This plugin channel is closed.')
          await owner.child.request({ action: 'send', connectionId, text })
        },
      }
    },
  }
}
