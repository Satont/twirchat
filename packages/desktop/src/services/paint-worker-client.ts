import { dirname, join } from 'node:path'

import { z } from 'zod'

export const PACKAGED_PAINT_WORKER = 'paint-worker.js'

const JOB_TIMEOUT_MS = 30_000
const IDLE_EXIT_MS = 60_000
const MAX_PENDING_JOBS = 300

export const paintWorkerJobSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('avatar'),
    path: z.string(),
    size: z.number(),
    scale: z.number(),
    dbPath: z.string(),
  }),
  z.object({
    kind: z.literal('emote'),
    path: z.string(),
    width: z.number(),
    height: z.number(),
    modifiers: z.array(z.string()),
    dbPath: z.string(),
    backendUrl: z.string().url().optional(),
  }),
  z.object({
    kind: z.literal('paint'),
    name: z.string(),
    paint: z.unknown(),
    fontSize: z.number(),
    fontFamily: z.string(),
    dbPath: z.string(),
    backendUrl: z.string().url().optional(),
  }),
])

export type PaintWorkerJob = z.infer<typeof paintWorkerJobSchema>

export const paintWorkerRequestSchema = z.object({
  id: z.number().int(),
  job: z.unknown(),
})

const paintWorkerReplySchema = z.discriminatedUnion('ok', [
  z.object({ id: z.number().int(), ok: z.literal(true), value: z.unknown() }),
  z.object({ id: z.number().int(), ok: z.literal(false), error: z.string() }),
])

export type PaintWorkerReply = z.infer<typeof paintWorkerReplySchema>

interface PaintWorkerClientOptions {
  command: () => string[]
  env?: Record<string, string | undefined>
  cwd?: string
  jobTimeoutMs?: number
  idleExitMs?: number
}

interface PendingJob {
  timer: ReturnType<typeof setTimeout>
  result: PromiseWithResolvers<unknown>
}

interface WorkerProcess {
  child: Bun.Subprocess
  pending: Map<number, PendingJob>
  stopped: boolean
}

/**
 * One long-lived image worker. Starting a packaged process per image took about half a second;
 * the separate process still keeps native image decoding failures out of the UI process.
 */
export function createPaintWorkerClient(options: PaintWorkerClientOptions) {
  const jobTimeoutMs = options.jobTimeoutMs ?? JOB_TIMEOUT_MS
  const idleExitMs = options.idleExitMs ?? IDLE_EXIT_MS
  let current: WorkerProcess | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0

  function stop(worker: WorkerProcess, reason: string): void {
    if (worker.stopped) return
    worker.stopped = true
    if (current === worker) current = undefined
    for (const job of worker.pending.values()) {
      clearTimeout(job.timer)
      job.result.reject(new Error(reason))
    }
    worker.pending.clear()
    if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill()
  }

  function receive(worker: WorkerProcess, data: unknown): void {
    const parsed = paintWorkerReplySchema.safeParse(data)
    if (!parsed.success) {
      stop(worker, 'The image worker sent an invalid reply.')
      return
    }
    const reply = parsed.data
    const job = worker.pending.get(reply.id)
    if (!job) return
    worker.pending.delete(reply.id)
    clearTimeout(job.timer)
    if (reply.ok) job.result.resolve(reply.value)
    else job.result.reject(new Error(reply.error))
    if (worker.pending.size === 0) scheduleIdleExit(worker)
  }

  function scheduleIdleExit(worker: WorkerProcess): void {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (worker.pending.size === 0) stop(worker, 'The image worker was idle.')
    }, idleExitMs)
    idleTimer.unref()
  }

  function start(): WorkerProcess {
    // IPC callbacks need the record that owns the child, which exists only after spawning.
    const owner: { worker?: WorkerProcess } = {}
    const child = Bun.spawn(options.command(), {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: { ...process.env, ...options.env },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      windowsHide: true,
      ipc(message) {
        if (owner.worker) receive(owner.worker, message)
      },
      onDisconnect() {
        if (owner.worker) stop(owner.worker, 'The image worker disconnected.')
      },
    })
    const worker: WorkerProcess = { child, pending: new Map(), stopped: false }
    owner.worker = worker
    child.exited.then(
      (code) => stop(worker, `The image worker exited (${code}).`),
      (error: unknown) => stop(worker, `The image worker failed: ${String(error)}`),
    )
    return worker
  }

  function run(job: PaintWorkerJob): Promise<unknown> {
    let worker: WorkerProcess
    try {
      worker = current ?? start()
    } catch (error) {
      return Promise.reject(error)
    }
    current = worker
    if (worker.pending.size >= MAX_PENDING_JOBS)
      return Promise.reject(new Error('The image worker queue is full.'))
    clearTimeout(idleTimer)
    const id = ++sequence
    const result = Promise.withResolvers<unknown>()
    const timer = setTimeout(() => stop(worker, 'The image worker timed out.'), jobTimeoutMs)
    worker.pending.set(id, { timer, result })
    try {
      worker.child.send({ id, job })
    } catch (error) {
      stop(worker, `The image worker is unavailable: ${String(error)}`)
    }
    return result.promise
  }

  function close(): Promise<void> {
    clearTimeout(idleTimer)
    const worker = current
    if (!worker) return Promise.resolve()
    stop(worker, 'The image worker was closed.')
    return worker.child.exited.then(() => undefined)
  }

  return { run, close }
}

export const paintWorker = createPaintWorkerClient({
  command: () => [process.execPath, join(dirname(process.execPath), PACKAGED_PAINT_WORKER)],
  env: { BUN_BE_BUN: '1' },
})
