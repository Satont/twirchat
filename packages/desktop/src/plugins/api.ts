export const PLUGIN_API_VERSION = 1

export interface PluginInfo {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly enabled: boolean
  readonly status: 'disabled' | 'starting' | 'running' | 'incompatible' | 'error'
  readonly error?: string
}

export interface PluginChannel {
  platform: string
  id: string
  name: string
  watchedChannelId?: string
}

export interface PluginCommandContext {
  text: string
  args: string[]
  channel: PluginChannel | null
}

export interface PluginEventMap {
  message: {
    channel: PluginChannel
    id: string
    author: { id: string; name: string; username?: string }
    text: string
    timestamp: number
    type: 'message' | 'action' | 'system'
  }
  channelStatus: { channel: PluginChannel } & PluginTransportStatus
  roomState: {
    channel: PluginChannel
    slowSeconds?: number
    followersOnlyMinutes?: number | null
    subscribersOnly?: boolean
    emoteOnly?: boolean
    uniqueChat?: boolean
  }
  moderation: {
    channel: PluginChannel
    action: 'delete_message' | 'timeout' | 'ban'
    messageId?: string
    targetUserId?: string
    durationSeconds?: number
  }
  chatCleared: { channel: PluginChannel }
  chatEvent: {
    channel: PluginChannel | null
    id: string
    type: string
    user: { id: string; name: string }
    timestamp: number
  }
}

export interface PluginTransportMessage {
  id: string
  author: { id: string; name: string; username?: string }
  text: string
  timestamp?: number
}

export interface PluginTransportStatus {
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}

export type PluginPlatform = `plugin:${string}:${string}`

export interface PluginTransportInfo {
  readonly platform: PluginPlatform
  readonly name: string
  readonly canSend: boolean
}

export interface PluginTransportContext {
  readonly signal: AbortSignal
  emitMessage(message: PluginTransportMessage): void
  setStatus(status: PluginTransportStatus): void
}

export interface PluginTransport {
  name: string
  connect(
    channelId: string,
    context: PluginTransportContext,
  ): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>
  sendMessage?(
    channelId: string,
    text: string,
    context: PluginTransportContext,
  ): void | Promise<void>
}

export interface PluginApi {
  readonly version: typeof PLUGIN_API_VERSION
  readonly appVersion: string
  registerCommand(
    name: string,
    handler: (input: PluginCommandContext) => void | Promise<void>,
  ): void
  on<Event extends keyof PluginEventMap>(
    event: Event,
    handler: (payload: PluginEventMap[Event]) => void | Promise<void>,
  ): void
  registerTransport(id: string, transport: PluginTransport): void
  getChannels(): Promise<PluginChannel[]>
  sendMessage(channel: PluginChannel, text: string): Promise<void>
  addSystemMessage(channel: PluginChannel, text: string): Promise<void>
}

export type PluginCleanup = () => void | Promise<void>
export type PluginDefinition = (
  api: PluginApi,
) => void | PluginCleanup | Promise<void | PluginCleanup>

export interface PluginTransportConnection {
  sendMessage(text: string): Promise<void>
  close(): Promise<void>
}

export interface PluginTransportCallbacks {
  message(message: PluginTransportMessage): void
  status(status: PluginTransportStatus): void
}
