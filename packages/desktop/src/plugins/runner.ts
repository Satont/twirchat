import { pathToFileURL } from 'node:url'

import {
  PLUGIN_API_VERSION,
  type PluginApi,
  type PluginCleanup,
  type PluginCommandContext,
  type PluginEventMap,
  type PluginTransport,
  type PluginTransportContext,
} from './api'
import {
  commandNameSchema,
  eventNameSchema,
  hostActionSchema,
  MAX_BATCH,
  MAX_COMMANDS,
  MAX_CONNECTIONS,
  MAX_EVENT_QUEUE,
  MAX_PENDING_REQUESTS,
  MAX_TRANSPORTS,
  pluginError,
  transportIdSchema,
  transportMessageSchema,
  transportStatusSchema,
  workerInboundSchema,
  workerOutboundSchema,
  type HostAction,
  type HostResult,
  type PluginEvent,
  type TransportUpdate,
  type WorkerAction,
  type WorkerOutbound,
} from './protocol'

type EventHandler<Event extends keyof PluginEventMap> = (
  payload: PluginEventMap[Event],
) => void | Promise<void>

type EventHandlers = { [Event in keyof PluginEventMap]: Set<EventHandler<Event>> }
type CommandHandler = (input: PluginCommandContext) => void | Promise<void>
interface ChannelConnection {
  channelId: string
  transport: PluginTransport
  context: PluginTransportContext
  abort: AbortController
  cleanup?: PluginCleanup
}

const entry = process.argv[2]
const appVersion = process.argv[3]
if (!entry || !appVersion || !process.send) throw new Error('Plugin runner requires desktop IPC.')

const commands = new Map<string, CommandHandler>()
const events: EventHandlers = {
  message: new Set(),
  channelStatus: new Set(),
  chatEvent: new Set(),
  roomState: new Set(),
  moderation: new Set(),
  chatCleared: new Set(),
}
const transports = new Map<string, PluginTransport>()
const connections = new Map<number, ChannelConnection>()
const hostRequests = new Map<number, PromiseWithResolvers<HostResult>>()
let nextHostId = 0
let active = false
let failed = false
let stopping = false
let cleanupPlugin: PluginCleanup | undefined

function send(message: WorkerOutbound): void {
  process.send?.(message)
}

function fail(error: unknown): void {
  if (failed) return
  failed = true
  send({ kind: 'fatal', error: pluginError(error) })
  setTimeout(() => process.exit(1), 100)
}

function ensureRegistering(): void {
  if (active) throw new Error('Register plugin capabilities during activation.')
}

async function requestHost(value: HostAction): Promise<HostResult> {
  if (stopping) throw new Error('Plugin is shutting down.')
  if (hostRequests.size >= MAX_PENDING_REQUESTS) throw new Error('Too many plugin API requests.')
  const id = ++nextHostId
  const pending = Promise.withResolvers<HostResult>()
  hostRequests.set(id, pending)
  try {
    send({ kind: 'hostRequest', id, value: hostActionSchema.parse(value) })
    return await pending.promise
  } finally {
    hostRequests.delete(id)
  }
}

const api: PluginApi = Object.freeze<PluginApi>({
  version: PLUGIN_API_VERSION,
  appVersion,
  registerCommand(name, handler) {
    ensureRegistering()
    const key = commandNameSchema.parse(name.replace(/^\//u, '').toLowerCase())
    if (typeof handler !== 'function' || commands.has(key) || commands.size >= MAX_COMMANDS)
      throw new Error(`Could not register command /${key}.`)
    commands.set(key, handler)
  },
  on(event, handler) {
    ensureRegistering()
    eventNameSchema.parse(event)
    if (typeof handler !== 'function' || events[event].size >= MAX_COMMANDS)
      throw new Error(`Could not register a ${event} handler.`)
    events[event].add(handler)
  },
  registerTransport(id, transport) {
    ensureRegistering()
    const key = transportIdSchema.parse(id)
    if (
      typeof transport.connect !== 'function' ||
      (transport.sendMessage !== undefined && typeof transport.sendMessage !== 'function') ||
      transports.has(key) ||
      transports.size >= MAX_TRANSPORTS
    )
      throw new Error(`Could not register transport ${key}.`)
    transports.set(key, transport)
  },
  async getChannels() {
    return (await requestHost({ action: 'getChannels' })) ?? []
  },
  async sendMessage(channel, text) {
    await requestHost({ action: 'sendMessage', channel, text })
  },
  async addSystemMessage(channel, text) {
    await requestHost({ action: 'addSystemMessage', channel, text })
  },
})

let transportSequence = 0
let unacknowledged: number | undefined
let transportFlush: ReturnType<typeof setTimeout> | undefined
const queuedUpdates: TransportUpdate[] = []

function flushTransportUpdates(): void {
  transportFlush = undefined
  if (failed || unacknowledged !== undefined || !queuedUpdates.length) return
  unacknowledged = ++transportSequence
  send({
    kind: 'transportUpdates',
    id: unacknowledged,
    updates: queuedUpdates.splice(0, MAX_BATCH),
  })
}

function scheduleTransportFlush(): void {
  if (unacknowledged === undefined && transportFlush === undefined && queuedUpdates.length)
    transportFlush = setTimeout(flushTransportUpdates, 0)
}

function queueTransportUpdate(update: TransportUpdate): void {
  if (queuedUpdates.length >= MAX_EVENT_QUEUE) {
    fail('Plugin transport exceeded the pending message limit.')
    return
  }
  queuedUpdates.push(update)
  scheduleTransportFlush()
}

async function dispatchEvent<Event extends keyof PluginEventMap>(message: {
  event: Event
  payload: PluginEventMap[Event]
}): Promise<void> {
  // Handlers observe events in arrival order, including when they are async.
  // eslint-disable-next-line no-await-in-loop
  for (const handler of events[message.event]) await handler(message.payload)
}

async function dispatchEvents(batch: readonly PluginEvent[]): Promise<void> {
  // eslint-disable-next-line no-await-in-loop
  for (const event of batch) await dispatchEvent(event)
}

async function dispatch(action: WorkerAction): Promise<void> {
  if (!active) throw new Error('Plugin is still activating.')
  switch (action.action) {
    case 'ping':
      return
    case 'command': {
      const handler = commands.get(action.name)
      if (!handler) throw new Error(`Plugin command /${action.name} is unavailable.`)
      await handler(action.input)
      return
    }
    case 'events':
      await dispatchEvents(action.events)
      return
    case 'connect': {
      const { connectionId, channelId, transportId } = action
      const transport = transports.get(transportId)
      if (!transport || connections.has(connectionId) || connections.size >= MAX_CONNECTIONS)
        throw new Error('Plugin transport is unavailable.')
      const abort = new AbortController()
      let hasStatus = false
      const context: PluginTransportContext = {
        signal: abort.signal,
        emitMessage(message) {
          if (abort.signal.aborted) return
          queueTransportUpdate({
            kind: 'message',
            connectionId,
            message: transportMessageSchema.parse(message),
          })
        },
        setStatus(status) {
          if (abort.signal.aborted) return
          hasStatus = true
          queueTransportUpdate({
            kind: 'status',
            connectionId,
            status: transportStatusSchema.parse(status),
          })
        },
      }
      const connection: ChannelConnection = { channelId, transport, context, abort }
      connections.set(connectionId, connection)
      try {
        const cleanup = await transport.connect(channelId, context)
        if (typeof cleanup === 'function') {
          if (abort.signal.aborted) await cleanup()
          else connection.cleanup = cleanup
        }
        if (!hasStatus) context.setStatus({ status: 'connected' })
      } catch (error) {
        connections.delete(connectionId)
        abort.abort()
        throw error
      }
      return
    }
    case 'disconnect': {
      await disconnect(action.connectionId)
      return
    }
    case 'send': {
      const connection = connections.get(action.connectionId)
      if (!connection?.transport.sendMessage) throw new Error('This plugin channel is read-only.')
      await connection.transport.sendMessage(connection.channelId, action.text, connection.context)
    }
  }
}

async function disconnect(connectionId: number): Promise<void> {
  const connection = connections.get(connectionId)
  if (!connection) return
  connections.delete(connectionId)
  connection.abort.abort()
  await connection.cleanup?.()
}

async function shutdown(): Promise<void> {
  stopping = true
  const disconnects = Array.from(connections.keys(), disconnect)
  await Promise.allSettled(disconnects)
  await cleanupPlugin?.()
  process.exit(0)
}

process.on('message', (data: unknown) => {
  if (failed || stopping) return
  const message = workerInboundSchema.safeParse(data)
  if (!message.success) {
    fail('Invalid desktop IPC message.')
    return
  }
  const value = message.data
  switch (value.kind) {
    case 'stop':
      void shutdown().catch(() => process.exit(1))
      return
    case 'hostResult': {
      const pending = hostRequests.get(value.id)
      if (value.reply.ok) pending?.resolve(value.reply.value)
      else pending?.reject(new Error(value.reply.error))
      return
    }
    case 'transportAck':
      if (unacknowledged === value.id) {
        unacknowledged = undefined
        scheduleTransportFlush()
      }
      return
    case 'request':
      void dispatch(value.value)
        .then(() => send({ kind: 'result', id: value.id, reply: { ok: true } }))
        .catch((error: unknown) => {
          if (value.value.action === 'events') fail(error)
          else
            send({ kind: 'result', id: value.id, reply: { ok: false, error: pluginError(error) } })
        })
        .catch(fail)
  }
})
process.on('disconnect', () => process.exit(0))
process.on('uncaughtException', fail)
process.on('unhandledRejection', fail)

try {
  const module: unknown = await import(pathToFileURL(entry).href)
  if (
    !module ||
    typeof module !== 'object' ||
    !('default' in module) ||
    typeof module.default !== 'function'
  )
    throw new Error('Plugin entry must default-export an activation function.')
  const activation: unknown = module.default(api)
  const cleanup: unknown = await Promise.resolve(activation)
  if (typeof cleanup === 'function')
    cleanupPlugin = async () => {
      const result: unknown = cleanup()
      await Promise.resolve(result)
    }
  active = true
  const ready = workerOutboundSchema.parse({
    kind: 'ready',
    registration: {
      commands: [...commands.keys()],
      events: eventNameSchema.options.filter((event) => events[event].size > 0),
      transports: Array.from(transports, ([id, transport]) => ({
        id,
        name: transport.name,
        canSend: typeof transport.sendMessage === 'function',
      })),
    },
  })
  send(ready)
} catch (error) {
  fail(error)
}
