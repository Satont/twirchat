import { VKPLAY_WS_URL } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

const log = logger('vkplay-centrifuge')

const errorSchema = z.object({
  code: z.number().int(),
  message: z.string().optional(),
})
const replySchema = z.object({
  connect: z
    .object({
      client: z.string().optional(),
      expires: z.boolean().optional(),
      ping: z.number().optional(),
      pong: z.boolean().optional(),
      ttl: z.number().optional(),
      version: z.string().optional(),
    })
    .optional(),
  error: errorSchema.optional(),
  id: z.number().int(),
  subscribe: z.object({}).optional(),
})

export const vkPlayPushSchema = z.object({
  push: z.object({
    channel: z.string(),
    pub: z.object({ data: z.unknown(), offset: z.number().optional() }),
  }),
})

export type VkPlayPush = z.infer<typeof vkPlayPushSchema>

interface PendingCommand {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

export class VkPlayCentrifuge {
  private socket: WebSocket | null = null
  private nextId = 0
  private pending = new Map<number, PendingCommand>()
  private closed = false

  constructor(
    private readonly handlers: {
      onClose: (reason: string) => void
      onPush: (push: VkPlayPush['push']) => void
    },
  ) {}

  async connect(token: string): Promise<void> {
    this.closed = false
    const socket = openSocket(VKPLAY_WS_URL)
    this.socket = socket
    socket.addEventListener('message', (event) => this.onMessage(event.data))
    socket.addEventListener('close', (event) => this.onClose(event.code, event.reason))
    socket.addEventListener('error', () => this.onClose(0, 'connection error'))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('VK Play Live websocket timed out.')), 15000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        this.command({ connect: { name: 'js', token } }).then(
          () => resolve(),
          (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
        )
      })
      socket.addEventListener('close', () => {
        clearTimeout(timer)
        reject(new Error('VK Play Live websocket closed before connecting.'))
      })
    })
  }

  async subscribe(channel: string): Promise<void> {
    await this.command({ subscribe: { channel } })
  }

  close(): void {
    this.closed = true
    this.rejectPending(new Error('VK Play Live chat connection closed.'))
    this.socket?.close()
    this.socket = null
  }

  private command(payload: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('VK Play Live realtime is not connected.'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('VK Play Live realtime command timed out.'))
      }, 15000)
      this.pending.set(id, { reject, resolve, timer })
      socket.send(JSON.stringify({ ...payload, id }))
    })
  }

  private onMessage(raw: unknown): void {
    const data = typeof raw === 'string' ? raw : null
    if (!data) return
    if (data === '{}') {
      this.socket?.send('{}')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    const reply = replySchema.safeParse(parsed)
    if (reply.success) {
      const pending = this.pending.get(reply.data.id)
      if (!pending) return
      this.pending.delete(reply.data.id)
      clearTimeout(pending.timer)
      if (reply.data.error) {
        pending.reject(new Error(reply.data.error.message ?? 'VK Play Live realtime error.'))
        return
      }
      pending.resolve(reply.data)
      return
    }
    const push = vkPlayPushSchema.safeParse(parsed)
    if (push.success) this.handlers.onPush(push.data.push)
  }

  private onClose(code: number, reason: string): void {
    if (this.closed) return
    this.closed = true
    this.rejectPending(new Error('VK Play Live chat connection closed.'))
    log.info('Realtime connection closed', { code, reason })
    this.handlers.onClose(reason || `closed (${code})`)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function openSocket(url: string): WebSocket {
  const socket: unknown = Reflect.construct(WebSocket, [
    url,
    { headers: { Origin: 'https://live.vkvideo.ru' } },
  ])
  if (!(socket instanceof WebSocket)) throw new Error('VK Play Live websocket could not start.')
  return socket
}
