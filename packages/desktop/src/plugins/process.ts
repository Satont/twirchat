import { dirname, join } from 'node:path'

import {
  MAX_CONNECTIONS,
  MAX_PENDING_REQUESTS,
  REQUEST_TIMEOUT_MS,
  pluginError,
  workerOutboundSchema,
  type HostAction,
  type HostResult,
  type PluginRegistration,
  type TransportUpdate,
  type WorkerAction,
  type WorkerInbound,
} from './protocol'

export const PACKAGED_PLUGIN_RUNNER = 'plugin-runner.js'

const HEARTBEAT_MS = 10_000
const GRACEFUL_STOP_MS = 350
const ENVIRONMENT_KEYS = new Set([
  'APPDATA',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'PATH',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
])

interface PluginProcessOptions {
  entry: string
  appVersion: string
  packagedExecutable?: string
  hostAction(action: HostAction): Promise<HostResult>
  onTransportUpdates(updates: TransportUpdate[]): void
  onFailure(error: string): void
}

interface PendingRequest {
  timer: ReturnType<typeof setTimeout>
  result: PromiseWithResolvers<void>
}

export interface PluginProcess {
  ready: Promise<PluginRegistration>
  request(value: WorkerAction): Promise<void>
  close(): Promise<void>
  kill(): void
}

export function startPluginProcess(options: PluginProcessOptions): PluginProcess {
  const standalone = import.meta.dir.includes('$bunfs') || import.meta.dir.includes('~BUN')
  const packaged = options.packagedExecutable ?? (standalone ? process.execPath : undefined)
  const runner = packaged
    ? join(dirname(packaged), PACKAGED_PLUGIN_RUNNER)
    : join(import.meta.dir, 'runner.ts')
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => ENVIRONMENT_KEYS.has(key.toUpperCase())),
  )
  if (packaged) environment.BUN_BE_BUN = '1'

  const ready = Promise.withResolvers<PluginRegistration>()
  const pending = new Map<number, PendingRequest>()
  let requestSequence = 0
  let activeHostActions = 0
  let registered = false
  let stopped = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const child = Bun.spawn(
    [
      packaged ?? process.execPath,
      '--no-install',
      '--no-env-file',
      runner,
      options.entry,
      options.appVersion,
    ],
    {
      cwd: dirname(options.entry),
      env: environment,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      windowsHide: true,
      ipc: receive,
      onDisconnect() {
        fail('Plugin process disconnected.')
      },
    },
  )
  const activation = setTimeout(() => fail('Plugin activation timed out.'), REQUEST_TIMEOUT_MS)
  void child.exited
    .then((code) => fail(`Plugin process exited (${code}).`))
    .catch((error: unknown) => fail(pluginError(error)))

  function kill(): void {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }

  function stop(reason: string, graceful = false): void {
    if (stopped) return
    stopped = true
    clearTimeout(activation)
    clearInterval(heartbeat)
    if (!registered) ready.reject(new Error(reason))
    for (const pendingRequest of pending.values()) {
      clearTimeout(pendingRequest.timer)
      pendingRequest.result.reject(new Error(reason))
    }
    pending.clear()
    if (!registered || !graceful) {
      kill()
      return
    }
    try {
      child.send({ kind: 'stop' } satisfies WorkerInbound)
      const deadline = setTimeout(kill, GRACEFUL_STOP_MS)
      void child.exited.finally(() => clearTimeout(deadline)).catch(() => {})
    } catch {
      kill()
    }
  }

  function fail(error: string): void {
    if (stopped) return
    stop(error)
    options.onFailure(error)
  }

  function send(value: WorkerInbound): void {
    if (!stopped) child.send(value)
  }

  async function request(value: WorkerAction): Promise<void> {
    if (stopped) throw new Error('Plugin is no longer running.')
    // Channel teardown has reserved capacity even when ordinary plugin requests saturate IPC.
    const limit =
      value.action === 'disconnect' ? MAX_PENDING_REQUESTS + MAX_CONNECTIONS : MAX_PENDING_REQUESTS
    if (pending.size >= limit) throw new Error('Too many pending plugin requests.')
    const id = ++requestSequence
    const result = Promise.withResolvers<void>()
    const timer = setTimeout(() => fail(`Plugin ${value.action} timed out.`), REQUEST_TIMEOUT_MS)
    try {
      send({ kind: 'request', id, value })
    } catch (error) {
      clearTimeout(timer)
      fail(pluginError(error))
      throw error
    }
    pending.set(id, { result, timer })
    return result.promise
  }

  async function runHostAction(id: number, value: HostAction): Promise<void> {
    if (activeHostActions >= MAX_PENDING_REQUESTS) {
      send({
        kind: 'hostResult',
        id,
        reply: { ok: false, error: 'Too many pending desktop requests.' },
      })
      return
    }
    activeHostActions++
    try {
      const result = await options.hostAction(value)
      send({ kind: 'hostResult', id, reply: { ok: true, value: result } })
    } catch (error) {
      send({ kind: 'hostResult', id, reply: { ok: false, error: pluginError(error) } })
    } finally {
      activeHostActions--
    }
  }

  function receive(data: unknown): void {
    if (stopped) return
    const parsed = workerOutboundSchema.safeParse(data)
    if (!parsed.success) {
      fail('Invalid plugin IPC message.')
      return
    }
    const message = parsed.data
    try {
      switch (message.kind) {
        case 'ready':
          if (registered) throw new Error('Plugin sent duplicate registration.')
          registered = true
          clearTimeout(activation)
          ready.resolve(message.registration)
          heartbeat = setInterval(() => {
            if (!pending.size) void request({ action: 'ping' }).catch(() => {})
          }, HEARTBEAT_MS)
          heartbeat.unref()
          return
        case 'fatal':
          fail(message.error)
          return
        case 'result': {
          const active = pending.get(message.id)
          if (!active) return
          pending.delete(message.id)
          clearTimeout(active.timer)
          if (message.reply.ok) active.result.resolve()
          else active.result.reject(new Error(message.reply.error))
          return
        }
        case 'hostRequest':
          void runHostAction(message.id, message.value).catch((error: unknown) =>
            fail(pluginError(error)),
          )
          return
        case 'transportUpdates':
          options.onTransportUpdates(message.updates)
          send({ kind: 'transportAck', id: message.id })
          return
      }
    } catch (error) {
      fail(pluginError(error))
    }
  }

  return {
    ready: ready.promise,
    request,
    async close() {
      stop('Plugin was disabled.', true)
      await child.exited
    },
    kill,
  }
}
