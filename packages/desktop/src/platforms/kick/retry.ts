import { t } from '../../gpuix/i18n'

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
    return t('misc.kick.backendRefused')
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
    return t('misc.kick.backendTimeout')
  return t('misc.kick.backendFailed')
}
