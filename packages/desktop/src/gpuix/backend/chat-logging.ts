import { createHash } from 'node:crypto'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import type { ChatLoggingSettings } from './chat-history'

interface LogEntry {
  root: string
  path: string
  line: string
  limit: number
  bytes: number
}
const MAX_QUEUED_BYTES = 8 * 1024 * 1024
function clean(text: string): string {
  return text.replace(/\p{Cc}/gu, ' ')
}
const component = (value: string) =>
  `${value.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 70) || 'channel'}-${createHash('sha256').update(value).digest('hex').slice(0, 8)}`

/** Buffered, serialized append-only logging. No filesystem writes while disabled. */
export function createChatFileLogger() {
  let queue: LogEntry[] = []
  let queuedBytes = 0
  let active: Promise<void> | null = null
  let activeCount = 0
  let activeBytes = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let error: string | null = null
  let retryAt = 0
  let sequence = 0
  const session = new Date().toISOString().replace(/[:.]/gu, '-')
  const sizes = new Map<string, number>()
  const flush = async (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    if (active) {
      await active
      if (queue.length && Date.now() >= retryAt) await flush()
      return
    }
    if (!queue.length) return
    const batch = queue
    queue = []
    queuedBytes = 0
    activeCount = batch.length
    activeBytes = batch.reduce((total, entry) => total + entry.bytes, 0)
    active = (async () => {
      const completed = new Set<LogEntry>()
      try {
        const groups = new Map<string, LogEntry[]>()
        for (const entry of batch) {
          const group = groups.get(entry.path)
          if (group) group.push(entry)
          else groups.set(entry.path, [entry])
        }
        for (const [path, entries] of groups) {
          await mkdir(dirname(path), { recursive: true })
          let size =
            sizes.get(path) ??
            (await stat(path)
              .then((value) => value.size)
              .catch(() => 0))
          let chunk: LogEntry[] = []
          let bytes = 0
          const write = async () => {
            if (!chunk.length) return
            try {
              await appendFile(path, chunk.map((entry) => entry.line).join(''), 'utf8')
            } catch (failure) {
              sizes.delete(path)
              throw failure
            }
            size += bytes
            sizes.set(path, size)
            for (const entry of chunk) completed.add(entry)
            activeCount -= chunk.length
            activeBytes -= bytes
            chunk = []
            bytes = 0
          }
          for (const entry of entries) {
            if (
              chunk.length &&
              (size + bytes + entry.bytes > entry.limit || bytes + entry.bytes > 64 * 1024)
            )
              await write()
            if (size > 0 && size + entry.bytes > entry.limit) {
              await rename(path, path.replace(/\.log$/u, `.${Date.now()}-${sequence++}.log`)).catch(
                (failure: unknown) => {
                  if (
                    !(
                      failure !== null &&
                      typeof failure === 'object' &&
                      'code' in failure &&
                      failure.code === 'ENOENT'
                    )
                  )
                    throw failure
                },
              )
              size = 0
              sizes.set(path, 0)
            }
            chunk.push(entry)
            bytes += entry.bytes
          }
          await write()
          if (sizes.size > 1000) sizes.delete(sizes.keys().next().value!)
        }
        error = null
        retryAt = 0
      } catch (failure) {
        const remaining = batch.filter((entry) => !completed.has(entry))
        queue = [...remaining, ...queue]
        queuedBytes += remaining.reduce((sum, entry) => sum + entry.bytes, 0)
        error = failure instanceof Error ? failure.message : String(failure)
        retryAt = Date.now() + 5000
      } finally {
        active = null
        activeCount = 0
        activeBytes = 0
      }
    })()
    await active
    if (queue.length && Date.now() >= retryAt) await flush()
  }
  return {
    enqueue(message: NormalizedChatMessage, settings: ChatLoggingSettings): void {
      if (!settings.enabled) return
      if (
        settings.channels.length &&
        !settings.channels.some(
          (channel) =>
            channel.platform === message.platform &&
            channel.channelId.toLowerCase() === message.channelId.toLowerCase(),
        )
      )
        return
      const date = new Date(message.timestamp)
      if (!Number.isFinite(date.getTime())) return
      let line = `${settings.timestamps ? `[${date.toISOString()}] ` : ''}${clean(message.author.displayName)}: ${clean(message.text)}\n`
      const limit = Math.min(16 * 1024, settings.maxFileBytes)
      const encoded = Buffer.from(line)
      if (encoded.byteLength > limit)
        line = `${new TextDecoder().decode(encoded.subarray(0, limit - 4), { stream: true })}…\n`
      const bytes = Buffer.byteLength(line)
      if (queuedBytes + activeBytes + bytes > MAX_QUEUED_BYTES) {
        error = 'The chat log queue is full. Some messages remain available only in local history.'
        return
      }
      const name = settings.rotation === 'session' ? session : date.toISOString().slice(0, 10)
      queue.push({
        root: settings.directory,
        path: join(
          settings.directory,
          message.platform,
          component(message.channelId),
          `${name}.log`,
        ),
        line,
        limit: settings.maxFileBytes,
        bytes,
      })
      queuedBytes += bytes
      if (!timer) {
        timer = setTimeout(() => void flush(), Math.max(50, retryAt - Date.now()))
        timer.unref()
      }
    },
    flush,
    relocate(directory: string): void {
      queue = queue.map((entry) => ({
        ...entry,
        root: directory,
        path: join(directory, relative(entry.root, entry.path)),
      }))
      error = null
      retryAt = 0
    },
    status: () => ({ error, queued: queue.length + activeCount }),
  }
}
