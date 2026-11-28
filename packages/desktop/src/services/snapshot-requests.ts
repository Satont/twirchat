import { runInBackground } from './background-task'

interface WaitingSnapshot {
  start(): void
  reject(error: Error): void
}

/** Coalesce overlapping snapshots and bound requests across all active chat splits. */
export function createSnapshotRequests<T = unknown>(maxConcurrent = 2) {
  const pending: WaitingSnapshot[] = []
  const requests = new Map<
    string,
    { sections?: readonly string[]; promise: Promise<T>; larger: WaitingSnapshot[] }
  >()
  let active = 0
  let stopped: Error | undefined

  function checkRunning(): void {
    if (stopped) throw stopped
  }

  function drain(): void {
    while (!stopped && active < maxConcurrent && pending.length) pending.shift()?.start()
  }

  function enqueue(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      pending.push({
        reject,
        start() {
          active++
          runInBackground(
            Promise.resolve()
              .then(() => {
                checkRunning()
                return run()
              })
              .then(resolve, reject)
              .finally(() => {
                active--
                drain()
              }),
            'snapshot-requests background operation failed',
          )
        },
      })
      drain()
    })
  }

  function request(
    key: string,
    sections: readonly string[] | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    if (stopped) return Promise.reject(stopped)
    const current = requests.get(key)
    if (current) {
      if (
        !current.sections ||
        (sections && sections.every((part) => current.sections?.includes(part)))
      )
        return current.promise
      // A larger snapshot waits for the current one rather than duplicating channel traffic.
      return new Promise((resolve, reject) => {
        current.larger.push({ start: () => resolve(request(key, sections, run)), reject })
      })
    }
    const larger: WaitingSnapshot[] = []
    const promise = enqueue(run).finally(() => {
      requests.delete(key)
      for (const waiter of larger.splice(0)) waiter.start()
    })
    requests.set(key, { sections, promise, larger })
    return promise
  }

  function stop(): void {
    if (stopped) return
    stopped = new Error('Snapshot requests are stopped.')
    for (const job of pending.splice(0)) job.reject(stopped)
    for (const { larger } of requests.values())
      for (const waiter of larger.splice(0)) waiter.reject(stopped)
    requests.clear()
  }

  return { checkRunning, request, stop }
}
