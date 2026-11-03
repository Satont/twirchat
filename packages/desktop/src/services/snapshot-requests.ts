import { runInBackground } from './background-task'
/** Coalesce overlapping snapshots and bound requests across all active chat splits. */
export function createSnapshotRequests<T = unknown>(maxConcurrent = 2) {
  const pending: (() => void)[] = []
  const requests = new Map<string, { sections?: readonly string[]; promise: Promise<T> }>()
  let active = 0
  function drain(): void {
    while (active < maxConcurrent && pending.length) pending.shift()?.()
  }
  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      pending.push(() => {
        active++
        runInBackground(
          Promise.resolve()
            .then(run)
            .then(resolve, reject)
            .finally(() => {
              active--
              drain()
            }),
          'snapshot-requests background operation failed',
        )
      })
      drain()
    })
  }
  function request(
    key: string,
    sections: readonly string[] | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    const current = requests.get(key)
    if (current) {
      if (
        !current.sections ||
        (sections && sections.every((part) => current.sections?.includes(part)))
      )
        return current.promise
      // A larger snapshot waits for the current one rather than duplicating channel traffic.
      return current.promise.catch(() => undefined).then(() => request(key, sections, run))
    }
    const promise = enqueue(run).finally(() => {
      if (requests.get(key)?.promise === promise) requests.delete(key)
    })
    requests.set(key, { sections, promise })
    return promise
  }
  return { request }
}
