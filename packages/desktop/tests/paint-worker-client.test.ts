import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import { createPaintWorkerClient } from '../src/services/paint-worker-client'

const directory = mkdtempSync(join(tmpdir(), 'twirchat-paint-worker-'))
const fakeWorker = join(directory, 'fake-worker.ts')
// The fake replies with its pid, so tests can tell whether a job reused the process.
await Bun.write(
  fakeWorker,
  `process.on('message', (message) => {
  const path = message.job.path
  if (path === 'crash') process.exit(3)
  if (path === 'hang') return
  if (path === 'garbage') return process.send({ nonsense: true })
  if (path === 'fail') return process.send({ id: message.id, ok: false, error: 'bad image' })
  process.send({ id: message.id, ok: true, value: process.pid })
})
process.on('disconnect', () => process.exit(0))
`,
)

afterAll(() => rmSync(directory, { recursive: true, force: true }))

function client(options: { jobTimeoutMs?: number; idleExitMs?: number } = {}) {
  return createPaintWorkerClient({ command: () => [process.execPath, fakeWorker], ...options })
}

function job(path: string) {
  return { kind: 'avatar', path, size: 28, scale: 2, dbPath: 'unused' } satisfies Parameters<
    ReturnType<typeof client>['run']
  >[0]
}

const pid = z.number().int()

test('jobs reuse one worker process', async () => {
  const worker = client()
  try {
    const pids = (await Promise.all([worker.run(job('a')), worker.run(job('b'))])).map((value) =>
      pid.parse(value),
    )
    pids.push(pid.parse(await worker.run(job('c'))))
    expect(new Set(pids).size).toBe(1)
  } finally {
    await worker.close()
  }
})

test('a job error rejects only that job', async () => {
  const worker = client()
  try {
    const results = await Promise.allSettled([worker.run(job('fail')), worker.run(job('ok'))])
    expect(results[0]).toMatchObject({ status: 'rejected', reason: { message: 'bad image' } })
    expect(results[1].status).toBe('fulfilled')
  } finally {
    await worker.close()
  }
})

test('a crash rejects pending jobs and the next job starts a new process', async () => {
  const worker = client()
  try {
    const first = pid.parse(await worker.run(job('a')))
    const results = await Promise.allSettled([worker.run(job('hang')), worker.run(job('crash'))])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(pid.parse(await worker.run(job('b')))).not.toBe(first)
  } finally {
    await worker.close()
  }
})

test('a stuck job times out and the worker recovers', async () => {
  const worker = client({ jobTimeoutMs: 100 })
  try {
    const first = pid.parse(await worker.run(job('a')))
    await expect(worker.run(job('hang'))).rejects.toThrow('timed out')
    expect(pid.parse(await worker.run(job('b')))).not.toBe(first)
  } finally {
    await worker.close()
  }
})

test('an invalid reply stops the worker', async () => {
  const worker = client()
  try {
    const results = await Promise.allSettled([worker.run(job('hang')), worker.run(job('garbage'))])
    expect(results).toMatchObject([
      { status: 'rejected', reason: { message: 'The image worker sent an invalid reply.' } },
      { status: 'rejected', reason: { message: 'The image worker sent an invalid reply.' } },
    ])
  } finally {
    await worker.close()
  }
})

test('an idle worker exits and restarts on demand', async () => {
  const worker = client({ idleExitMs: 50 })
  try {
    const first = pid.parse(await worker.run(job('a')))
    await Bun.sleep(300)
    expect(() => process.kill(first, 0)).toThrow()
    expect(pid.parse(await worker.run(job('b')))).not.toBe(first)
  } finally {
    await worker.close()
  }
})

test('a command that cannot start rejects the job', async () => {
  const worker = createPaintWorkerClient({ command: () => [join(directory, 'missing-binary')] })
  await expect(worker.run(job('a'))).rejects.toThrow()
  await worker.close()
})
