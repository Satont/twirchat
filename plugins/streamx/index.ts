import { setTimeout as sleep } from 'node:timers/promises'

import type {
  PluginDefinition,
  PluginTransport,
  PluginTransportContext,
  PluginTransportEmote,
  PluginTransportMessage,
} from '../../packages/desktop/src/plugins/api'

const ENDPOINT = 'https://streamx.satont.dev/api/query'
const SUBSCRIPTION_ID = '1'
const HISTORY_LIMIT = 50
const LIVE_BUFFER_LIMIT = 200
const HANDSHAKE_TIMEOUT = 15_000
const HEARTBEAT_INTERVAL = 25_000
const IDLE_TIMEOUT = 90_000
const MAX_RETRY_DELAY = 30_000
const MAX_MESSAGE_LENGTH = 16_384
const MAX_EMOTES = 64

const CHANNEL_QUERY = `query ChannelId($channelName: String!) {
  fetchUserByName(name: $channelName) { id }
}`
const MESSAGE_FIELDS = `
  id createdAt senderColor
  sender { id name displayName }
  segments {
    content
    ... on MessageSegmentEmote { emote { id name url width height } }
  }
`
const SUBSCRIPTION = `subscription NewChatMessages($channelID: UUID!) {
  chatMessages(channelID: $channelID) { ${MESSAGE_FIELDS} }
}`
const HISTORY_QUERY = `query ChatMessages($channelID: UUID!, $limit: Int) {
  chatMessagesLatest(channelID: $channelID, limit: $limit) { ${MESSAGE_FIELDS} }
}`

interface ChatSession {
  endpoint: URL
  socketUrl: URL
  channelId: string
  signal: AbortSignal
  context: PluginTransportContext
}

class ChannelNotFoundError extends Error {}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && Object.hasOwn(value, key)
    ? Reflect.get(value, key)
    : undefined
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function identity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 256 ? trimmed : undefined
}

function chatEmote(value: unknown, start: number, end: number): PluginTransportEmote | undefined {
  const id = identity(field(value, 'id'))
  const name = identity(field(value, 'name'))
  const source = field(value, 'url')
  if (!id || !name || typeof source !== 'string' || source.length > 2048) return undefined

  const url = URL.parse(source.startsWith('//') ? `https:${source}` : source)
  if (url?.protocol !== 'https:' || url.username || url.password || url.href.length > 2048)
    return undefined

  const width = field(value, 'width')
  const height = field(value, 'height')
  const aspectRatio =
    typeof width === 'number' &&
    Number.isInteger(width) &&
    width > 0 &&
    typeof height === 'number' &&
    Number.isInteger(height) &&
    height > 0
      ? width / height
      : undefined
  return { id, name, imageUrl: url.href, positions: [{ start, end }], aspectRatio }
}

function chatMessage(value: unknown): PluginTransportMessage | undefined {
  const id = identity(field(value, 'id'))
  const sender = field(value, 'sender')
  const senderId = identity(field(sender, 'id'))
  if (!id || !senderId) return undefined

  const username = identity(field(sender, 'name'))
  const name = identity(field(sender, 'displayName')) ?? username ?? 'Unknown'
  const senderColor = field(value, 'senderColor')
  const color =
    typeof senderColor === 'string' && /^#[\da-f]{6}$/iu.test(senderColor) ? senderColor : undefined
  let text = ''
  const emotes: PluginTransportEmote[] = []
  for (const segment of list(field(value, 'segments'))) {
    if (text.length === MAX_MESSAGE_LENGTH) break
    const content = field(segment, 'content')
    if (typeof content !== 'string' || content === '') continue
    if (text) text += ' '
    const start = text.length
    text += content.slice(0, MAX_MESSAGE_LENGTH - start)
    if (emotes.length === MAX_EMOTES || text.length - start !== content.length) continue
    const emote = chatEmote(field(segment, 'emote'), start, text.length - 1)
    if (emote) emotes.push(emote)
  }
  if (!text) return undefined

  const createdAt = field(value, 'createdAt')
  const timestamp = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN
  return {
    id,
    author: { id: senderId, name, username, ...(color ? { color } : {}) },
    text,
    ...(emotes.length > 0 ? { emotes } : {}),
    timestamp: timestamp >= 0 ? timestamp : undefined,
  }
}

async function query(
  endpoint: URL,
  queryText: string,
  variables: Record<string, string | number>,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: queryText, variables }),
    signal,
  })
  if (!response.ok) throw new Error(`StreamX request failed (HTTP ${response.status}).`)
  return response.json()
}

async function findChannel(endpoint: URL, channelName: string, signal: AbortSignal) {
  const result = await query(endpoint, CHANNEL_QUERY, { channelName }, signal)
  const channel = field(field(result, 'data'), 'fetchUserByName')
  const id = identity(field(channel, 'id'))
  if (id) return id
  const errors = list(field(result, 'errors'))
  if (
    (channel === null && errors.length === 0) ||
    errors.some(
      (error) =>
        field(error, 'message') === 'no rows in result set' &&
        list(field(error, 'path'))[0] === 'fetchUserByName',
    )
  ) {
    throw new ChannelNotFoundError(`StreamX channel "${channelName}" was not found.`)
  }
  throw new Error('StreamX could not look up the channel.')
}

function readChat({ endpoint, socketUrl, channelId, signal, context }: ChatSession): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl, 'graphql-transport-ws')
    const history = new AbortController()
    let pending: Map<string, PluginTransportMessage> | undefined = new Map()
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let lastFrame = Date.now()
    let subscribed = false
    let finished = false

    const send = (frame: object) => socket.send(JSON.stringify(frame))
    const stop = () => finish()
    const handshake = setTimeout(
      () => finish(new Error('StreamX connection timed out.')),
      HANDSHAKE_TIMEOUT,
    )

    function flushHistory(messages: readonly unknown[]) {
      if (!pending) return
      const merged = new Map<string, PluginTransportMessage>()
      for (const item of messages) {
        const message = chatMessage(item)
        if (message) merged.set(message.id, { ...message, historical: true })
      }
      for (const [id, message] of pending) merged.set(id, message)
      pending = undefined
      const sorted = [...merged.values()].toSorted(
        (left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0),
      )
      for (const message of sorted) context.emitMessage(message)
    }

    function finish(error?: Error) {
      if (finished) return
      finished = true
      signal.removeEventListener('abort', stop)
      clearTimeout(handshake)
      clearInterval(heartbeat)
      history.abort()
      if (socket.readyState < WebSocket.CLOSING) socket.close()
      if (signal.aborted) {
        pending = undefined
        resolve()
      } else {
        flushHistory([])
        reject(error ?? new Error('StreamX connection closed.'))
      }
    }

    async function subscribe() {
      send({
        id: SUBSCRIPTION_ID,
        type: 'subscribe',
        payload: { query: SUBSCRIPTION, variables: { channelID: channelId } },
      })
      subscribed = true
      clearTimeout(handshake)
      context.setStatus({ status: 'connected' })
      heartbeat = setInterval(() => {
        if (Date.now() - lastFrame >= IDLE_TIMEOUT) {
          finish(new Error('StreamX stopped responding.'))
        } else if (socket.readyState === WebSocket.OPEN) {
          send({ type: 'ping' })
        }
      }, HEARTBEAT_INTERVAL)

      const result = await query(
        endpoint,
        HISTORY_QUERY,
        { channelID: channelId, limit: HISTORY_LIMIT },
        AbortSignal.any([history.signal, AbortSignal.timeout(5_000)]),
      ).catch(() => undefined)
      if (!finished) {
        flushHistory(list(field(field(result, 'data'), 'chatMessagesLatest')).slice(-HISTORY_LIMIT))
      }
    }

    signal.addEventListener('abort', stop, { once: true })
    socket.addEventListener('open', () => {
      if (!finished) send({ type: 'connection_init', payload: {} })
    })
    socket.addEventListener('close', () => finish())
    socket.addEventListener('error', () => finish(new Error('StreamX WebSocket failed.')))
    socket.addEventListener('message', ({ data }) => {
      if (finished || typeof data !== 'string') return
      let frame: unknown
      try {
        frame = JSON.parse(data)
      } catch {
        return
      }
      lastFrame = Date.now()

      const type = field(frame, 'type')
      if (type === 'ping') {
        send({ type: 'pong', payload: field(frame, 'payload') })
        return
      }
      if (type === 'connection_ack' && !subscribed) {
        subscribe().catch(() => finish(new Error('Could not subscribe to StreamX chat.')))
        return
      }
      if (!subscribed || field(frame, 'id') !== SUBSCRIPTION_ID) return
      const payload = field(frame, 'payload')
      if (type === 'error' || type === 'complete' || list(field(payload, 'errors')).length > 0) {
        finish(new Error('StreamX ended the chat subscription.'))
        return
      }
      if (type !== 'next') return
      const message = chatMessage(field(field(payload, 'data'), 'chatMessages'))
      if (!message) return
      if (pending) {
        pending.set(message.id, message)
        if (pending.size > LIVE_BUFFER_LIMIT) {
          const oldest = pending.keys().next().value
          if (oldest !== undefined) pending.delete(oldest)
        }
      } else {
        context.emitMessage(message)
      }
    })
  })
}

export function createStreamxTransport(endpoint = ENDPOINT): PluginTransport {
  const queryUrl = new URL(endpoint)
  const socketUrl = new URL(queryUrl)
  socketUrl.protocol = queryUrl.protocol === 'https:' ? 'wss:' : 'ws:'

  return {
    name: 'StreamX',
    connect(channelName, context) {
      const controller = new AbortController()
      const { signal } = controller
      const stop = () => controller.abort()
      const cleanup = () => {
        context.signal.removeEventListener('abort', stop)
        stop()
      }
      if (context.signal.aborted) return cleanup
      context.signal.addEventListener('abort', stop, { once: true })

      async function run() {
        let channelId: string | undefined
        let retryDelay = 1000
        while (!signal.aborted) {
          context.setStatus({ status: 'connecting' })
          const started = Date.now()
          try {
            // eslint-disable-next-line no-await-in-loop
            channelId ??= await findChannel(
              queryUrl,
              channelName,
              AbortSignal.any([signal, AbortSignal.timeout(HANDSHAKE_TIMEOUT)]),
            )
            if (signal.aborted) return
            // eslint-disable-next-line no-await-in-loop
            await readChat({ endpoint: queryUrl, socketUrl, channelId, signal, context })
          } catch (error) {
            if (signal.aborted) return
            const message = error instanceof Error ? error.message : 'StreamX connection failed.'
            context.setStatus({ status: 'error', error: message.slice(0, 1000) })
            if (error instanceof ChannelNotFoundError) return
          }
          if (signal.aborted) return
          if (Date.now() - started >= MAX_RETRY_DELAY) retryDelay = 1000
          // eslint-disable-next-line no-await-in-loop
          await sleep(retryDelay, undefined, { signal })
          retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY)
        }
      }

      run().catch(() => {
        if (!signal.aborted)
          context.setStatus({ status: 'error', error: 'StreamX connection failed.' })
      })
      return cleanup
    },
  }
}

const activate: PluginDefinition = (api) => {
  api.registerTransport('chat', createStreamxTransport())
}

export default activate
