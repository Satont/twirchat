export interface KickRetryClock {
  now(): number
  schedule(callback: () => void, delayMs: number): () => void
}

export const kickRetryClock: KickRetryClock = {
  now: Date.now,
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    timer.unref?.()
    return () => clearTimeout(timer)
  },
}

export function kickReconnectDelay(failures: number): number {
  return Math.min(60000, 5000 * 2 ** Math.min(Math.max(failures - 1, 0), 4))
}

export function kickBackendFailure(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ECONNREFUSED' || error.code === 'ConnectionRefused')
  )
    return 'The Kick backend is unavailable (connection refused).'
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
    return 'The Kick backend request timed out.'
  return 'The Kick backend request failed. Check the backend connection.'
}
