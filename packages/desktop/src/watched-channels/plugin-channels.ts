import { logger } from '@twirchat/shared/logger'

import { t } from '../gpuix/i18n'
import type {
  PluginTransportCallbacks,
  PluginTransportConnection,
  PluginTransportInfo,
  PluginTransportMessage,
  PluginTransportStatus,
} from '../plugins/api'
import { runInBackground } from '../services/background-task'
import { getDb } from '../store/db'
import { PluginWatchedChannelsStore } from '../store/plugin-watched-channels-store'
import { WatchedChannelsLayoutStore } from '../store/watched-channels-layout-store'
import type { PluginPlatform, PluginWatchedChannel } from './plugin-channel-types'

const MAX_MESSAGES = 200
const MAX_CONNECTION_OPERATIONS = 4
const BATCH_MS = 32
const log = logger('plugin-channels')

export interface PluginChannelMessage extends Omit<PluginTransportMessage, 'timestamp'> {
  timestamp: number
  kind: 'message' | 'system'
}

export interface PluginChannelSnapshot {
  messages: readonly PluginChannelMessage[]
  status: PluginTransportStatus
  canSend: boolean
}

interface TransportBinding {
  info: PluginTransportInfo
  connection?: PluginTransportConnection
}

interface ActiveChannel {
  channel: PluginWatchedChannel
  messages: PluginChannelMessage[]
  messageIds: Set<string>
  nextMessage: number
  status: PluginTransportStatus
  binding?: TransportBinding
  publishTimer?: ReturnType<typeof setTimeout>
}

type ChannelListener = (snapshot: PluginChannelSnapshot) => void

interface PluginChannelOptions {
  manager: {
    transports(): readonly PluginTransportInfo[]
    openTransport(
      platform: string,
      channelId: string,
      callbacks: PluginTransportCallbacks,
    ): Promise<PluginTransportConnection>
  }
  onMessage?: (channel: PluginWatchedChannel, message: PluginTransportMessage) => void
  onStatus?: (channel: PluginWatchedChannel, status: PluginTransportStatus) => void
}

const disconnected: PluginChannelSnapshot = {
  messages: [],
  status: { status: 'disconnected' },
  canSend: false,
}

export function createPluginChannels({ manager, onMessage, onStatus }: PluginChannelOptions) {
  const active = new Map<string, ActiveChannel>()
  const listeners = new Map<string, Set<ChannelListener>>()
  const pending = new Set<Promise<void>>()
  const opening = new Map<ActiveChannel, TransportBinding>()
  const closing: PluginTransportConnection[] = []
  let transports = new Map<PluginPlatform, PluginTransportInfo>()
  let previousTransports: readonly PluginTransportInfo[] | undefined
  let disposed = false

  function snapshot(entry: ActiveChannel): PluginChannelSnapshot {
    const start = entry.messages.length === MAX_MESSAGES ? entry.nextMessage : 0
    const ready = Boolean(entry.binding?.connection)
    return {
      messages:
        start === 0
          ? entry.messages.slice()
          : entry.messages.slice(start).concat(entry.messages.slice(0, start)),
      status:
        entry.status.status === 'connected' && !ready ? { status: 'connecting' } : entry.status,
      canSend: ready && Boolean(entry.binding?.info.canSend),
    }
  }

  function schedulePublish(entry: ActiveChannel) {
    const id = entry.channel.id
    if (entry.publishTimer !== undefined || !listeners.has(id)) return
    entry.publishTimer = setTimeout(() => {
      entry.publishTimer = undefined
      const current = active.get(id)
      if (current && current !== entry) return
      const next = current ? snapshot(entry) : disconnected
      for (const listener of listeners.get(id) ?? []) listener(next)
    }, BATCH_MS)
  }

  function setStatus(entry: ActiveChannel, status: PluginTransportStatus) {
    if (entry.status.status === status.status && entry.status.error === status.error) return
    entry.status = status
    schedulePublish(entry)
    onStatus?.(entry.channel, status)
  }

  function append(entry: ActiveChannel, message: PluginChannelMessage): boolean {
    if (entry.messageIds.has(message.id)) return false
    const expired = entry.messages[entry.nextMessage]
    if (expired) entry.messageIds.delete(expired.id)
    entry.messages[entry.nextMessage] = message
    entry.messageIds.add(message.id)
    entry.nextMessage = (entry.nextMessage + 1) % MAX_MESSAGES
    schedulePublish(entry)
    return true
  }

  function track(operation: Promise<void>) {
    const work = operation.catch((cause) =>
      log.warn('Plugin transport could not close', { error: String(cause) }),
    )
    pending.add(work)
    runInBackground(
      work.finally(() => {
        pending.delete(work)
        pump()
      }),
      'Plugin transport queue failed',
    )
  }

  function pump() {
    while (pending.size < MAX_CONNECTION_OPERATIONS && closing.length) {
      const connection = closing.pop()
      if (connection) track(connection.close())
    }
    for (const [entry, binding] of opening) {
      if (pending.size >= MAX_CONNECTION_OPERATIONS) break
      opening.delete(entry)
      track(openConnection(entry, binding))
    }
  }

  function detach(entry: ActiveChannel) {
    const binding = entry.binding
    entry.binding = undefined
    opening.delete(entry)
    if (binding?.connection) closing.push(binding.connection)
  }

  function reconcile(entry: ActiveChannel) {
    const { channel } = entry
    const transport = transports.get(channel.platform)
    if (transport === entry.binding?.info && transport) return
    detach(entry)
    if (!transport) {
      if (entry.status.status !== 'error')
        setStatus(entry, {
          status: 'disconnected',
          error: t('misc.pluginChannels.enablePlugin', { name: channel.transportName }),
        })
      return
    }
    const binding: TransportBinding = { info: transport }
    entry.binding = binding
    setStatus(entry, { status: 'connecting' })
    opening.set(entry, binding)
  }

  async function openConnection(entry: ActiveChannel, binding: TransportBinding) {
    const { channel } = entry
    let connection: PluginTransportConnection
    try {
      connection = await manager.openTransport(binding.info.platform, channel.channelSlug, {
        message(message) {
          if (entry.binding !== binding) return
          if (
            append(entry, {
              ...message,
              timestamp: message.timestamp ?? Date.now(),
              kind: 'message',
            })
          )
            onMessage?.(channel, message)
        },
        status(status) {
          if (entry.binding === binding) setStatus(entry, status)
        },
      })
    } catch (cause) {
      if (entry.binding === binding)
        setStatus(entry, {
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        })
      return
    }
    if (entry.binding !== binding) {
      await connection.close()
      return
    }
    binding.connection = connection
    schedulePublish(entry)
  }

  function stop(id: string, entry: ActiveChannel) {
    active.delete(id)
    detach(entry)
    if (entry.publishTimer !== undefined) clearTimeout(entry.publishTimer)
    entry.publishTimer = undefined
    if (!disposed) {
      schedulePublish(entry)
      onStatus?.(entry.channel, disconnected.status)
    }
  }

  function transportChanged() {
    const current = manager.transports()
    if (current === previousTransports || disposed) return
    previousTransports = current
    transports = new Map(current.map((transport) => [transport.platform, transport]))
    for (const entry of active.values()) reconcile(entry)
    pump()
  }

  transportChanged()
  return {
    transportChanged,
    transports(): readonly PluginTransportInfo[] {
      return previousTransports ?? []
    },
    list: () => PluginWatchedChannelsStore.findAll(),
    add(platform: PluginPlatform, channelSlug: string): PluginWatchedChannel {
      const transport = transports.get(platform)
      if (!transport) throw new Error(t('misc.pluginChannels.transportUnavailable'))
      if (!channelSlug.trim() || channelSlug.length > 256)
        throw new Error(t('misc.pluginChannels.channelIdentifier'))
      return PluginWatchedChannelsStore.upsert({
        platform,
        channelSlug,
        transportName: transport.name,
      })
    },
    remove(id: string): boolean {
      if (!PluginWatchedChannelsStore.has(id)) return false
      getDb().transaction(() => {
        PluginWatchedChannelsStore.remove(id)
        WatchedChannelsLayoutStore.cleanupRemovedChannel(id)
      })()
      const entry = active.get(id)
      if (entry) stop(id, entry)
      pump()
      return true
    },
    setActive(ids: ReadonlySet<string>) {
      if (disposed) return
      for (const [id, entry] of active) {
        if (!ids.has(id)) stop(id, entry)
      }
      const channels = ids.size === 0 ? [] : PluginWatchedChannelsStore.findAll()
      for (const channel of channels) {
        if (!ids.has(channel.id) || active.has(channel.id)) continue
        const entry: ActiveChannel = {
          channel,
          messages: [],
          messageIds: new Set(),
          nextMessage: 0,
          status: disconnected.status,
        }
        active.set(channel.id, entry)
        reconcile(entry)
      }
      pump()
    },
    observe(id: string, listener: ChannelListener): () => void {
      const registered = listeners.get(id) ?? new Set()
      registered.add(listener)
      listeners.set(id, registered)
      const entry = active.get(id)
      listener(entry ? snapshot(entry) : disconnected)
      return () => {
        registered.delete(listener)
        if (registered.size === 0 && listeners.get(id) === registered) listeners.delete(id)
      }
    },
    async sendMessage(id: string, text: string): Promise<void> {
      const entry = active.get(id)
      const binding = entry?.binding
      if (!binding?.connection || entry?.status.status !== 'connected')
        throw new Error(t('misc.pluginChannels.notConnected'))
      if (!binding.info.canSend) throw new Error(t('misc.pluginChannels.readOnly'))
      if (!text.trim() || text.length > 4000)
        throw new Error(t('misc.pluginChannels.messageLength'))
      await binding.connection.sendMessage(text)
    },
    addSystemMessage(id: string, text: string): void {
      const entry = active.get(id)
      if (!entry) throw new Error(t('misc.pluginChannels.notOpen'))
      append(entry, {
        id: crypto.randomUUID(),
        author: { id: 'system', name: 'TwirChat' },
        text,
        timestamp: Date.now(),
        kind: 'system',
      })
    },
    async dispose(): Promise<void> {
      disposed = true
      for (const [id, entry] of active) stop(id, entry)
      listeners.clear()
      pump()
      while (pending.size > 0) {
        // Each completed batch admits the next set of connection cleanups.
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(pending)
      }
    },
  }
}

export type PluginChannels = ReturnType<typeof createPluginChannels>
