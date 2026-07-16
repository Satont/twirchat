import type { PlatformStatus, PlatformStatusInfo } from '@twirchat/shared/types'

const CONNECTION_NOTICE_DEDUP_MS = 5_000

export interface ConnectionNotice {
  durationMs: number
  kind: 'info' | 'success' | 'error'
  text: string
}

export interface ConnectionNoticeStore {
  observe(channelKey: string, status: PlatformStatusInfo): ConnectionNotice | null
}

type Schedule = (callback: () => void, durationMs: number) => unknown

type ObservedStatus = {
  state: PlatformStatus
  timestamp: number
}

function channelName(channelKey: string): string {
  const separator = channelKey.indexOf(':')
  const name = separator === -1 ? channelKey : channelKey.slice(separator + 1)
  return name || 'channel'
}

function noticeFor(channelKey: string, status: PlatformStatusInfo): ConnectionNotice {
  const name = channelName(channelKey)

  switch (status.status) {
    case 'connected':
      return { durationMs: 3_000, kind: 'success', text: `Connected to ${name}` }
    case 'disconnected':
      return { durationMs: 3_000, kind: 'info', text: `${name} disconnected` }
    case 'error':
      return {
        durationMs: 6_000,
        kind: 'error',
        text: status.error?.trim() || `Could not connect to ${name}`,
      }
    case 'connecting':
      return { durationMs: 3_000, kind: 'info', text: `Connecting to ${name}…` }
  }
}

export function createConnectionNoticeStore(
  now: () => number = Date.now,
  schedule: Schedule = (callback, durationMs) => setTimeout(callback, durationMs),
): ConnectionNoticeStore {
  const observed = new Map<string, ObservedStatus>()

  function observe(channelKey: string, status: PlatformStatusInfo): ConnectionNotice | null {
    const timestamp = now()
    const previous = observed.get(channelKey)
    if (
      previous &&
      previous.state === status.status &&
      timestamp - previous.timestamp < CONNECTION_NOTICE_DEDUP_MS
    ) {
      return null
    }

    const current = { state: status.status, timestamp }
    observed.set(channelKey, current)
    schedule(() => {
      if (observed.get(channelKey) === current) observed.delete(channelKey)
    }, CONNECTION_NOTICE_DEDUP_MS)

    return noticeFor(channelKey, status)
  }

  return { observe }
}
