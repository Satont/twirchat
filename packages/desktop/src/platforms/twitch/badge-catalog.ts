import { logger } from '@twirchat/shared/logger'
import type { Badge } from '@twirchat/shared/types'

import { backendFetch } from '../../runtime-config'
import { parseTwitchBadgeCatalog, type TwitchBadgeResolver } from './badge-data'
import { twitchIrcChannelName } from './send-outcomes'

const log = logger('twitch-badges')

export interface StoredTwitchBadgeCatalog {
  payload: unknown
  fetchedAt: number
}

/** Persists the last good catalog per scope so a restart never depends on the backend. */
export interface TwitchBadgeCatalogStorage {
  read(scope: string): StoredTwitchBadgeCatalog | undefined
  write(scope: string, payload: unknown, fetchedAt: number): void
}

export interface TwitchBadgeCatalogOptions {
  fetch?: typeof backendFetch
  storage?: TwitchBadgeCatalogStorage
  now?: () => number
  random?: () => number
  /** Runs `callback` after `delayMs` and returns a function that cancels it. */
  schedule?: (callback: () => void, delayMs: number) => () => void
}

interface Entry {
  scope: string
  path: string
  ttlMs: number
  badges: ReadonlyMap<string, Badge> | undefined
  fetchedAt: number
  /** Earliest next request after the backend rejected this scope (4xx or invalid payload). */
  rejectedUntil: number
  holders: number
  attempts: number
  cancelRefresh: (() => void) | undefined
}

type Outcome =
  | { kind: 'ok'; payload: unknown }
  | { kind: 'outage'; retryAfterMs: number }
  | {
      kind: 'rejected'
    }

export const GLOBAL_TWITCH_BADGE_SCOPE = 'global'
const REQUEST_TIMEOUT_MS = 5000
const MAX_CONCURRENT_REQUESTS = 3
const GLOBAL_TTL_MS = 2 * 60 * 60 * 1000
const CHANNEL_TTL_MS = 45 * 60 * 1000
const BACKOFF_BASE_MS = 5000
const BACKOFF_MAX_MS = 5 * 60 * 1000
const REJECTED_RETRY_MS = 30 * 60 * 1000
const MAX_IDLE_CHANNELS = 64
/**
 * Sets a channel can override with its own artwork. The global catalog has Twitch's default
 * versions under the same ids, which are only correct once the channel catalog is known and lacks
 * them; before that a global match would freeze the wrong icon into the message.
 */
const CHANNEL_SCOPED_SETS = new Set(['subscriber', 'bits'])

const channelScope = (channel: string) => `channel:${twitchIrcChannelName(channel)}`

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs)
  return () => clearTimeout(timer)
}

function retryAfterMs(response: Response, now: number): number {
  const header = response.headers.get('Retry-After')
  if (!header) return 0
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - now) : 0
}

/**
 * Twitch badge catalogs shared by every live adapter and history import: global badges once,
 * channel badges per channel, both restored from storage at once and revalidated in background.
 *
 * Every request goes to the same backend, so failures share one backoff: while it is failing a
 * single probe request runs at a time and the rest wait in the queue instead of retrying on their
 * own timers. Stored and previously fetched catalogs keep resolving badges meanwhile.
 */
export function createTwitchBadgeCatalog(options: TwitchBadgeCatalogOptions = {}) {
  const request = options.fetch ?? backendFetch
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const schedule = options.schedule ?? defaultSchedule
  const lifetime = new AbortController()
  const entries = new Map<string, Entry>()
  const queue = new Set<string>()
  /** Scopes with a request running; a release and re-acquire reuse it instead of starting another. */
  const inFlight = new Set<string>()
  const listeners = new Set<() => void>()
  let active = 0
  let failures = 0
  let lastFailureAt = Number.NEGATIVE_INFINITY
  let retryAt = 0
  let cancelGate: (() => void) | undefined

  const hydrate = (entry: Entry) => {
    try {
      const stored = options.storage?.read(entry.scope)
      if (!stored) return
      entry.badges = parseTwitchBadgeCatalog(stored.payload)
      entry.fetchedAt = stored.fetchedAt
    } catch (error) {
      log.warn('Stored Twitch badge catalog ignored', { scope: entry.scope, error: String(error) })
    }
  }

  const createEntry = (scope: string, path: string, ttlMs: number): Entry => {
    const entry: Entry = {
      scope,
      path,
      ttlMs,
      badges: undefined,
      fetchedAt: 0,
      rejectedUntil: 0,
      holders: 0,
      attempts: 0,
      cancelRefresh: undefined,
    }
    hydrate(entry)
    entries.set(scope, entry)
    return entry
  }

  const global = createEntry(GLOBAL_TWITCH_BADGE_SCOPE, '/api/twitch/badges', GLOBAL_TTL_MS)

  const channelEntry = (channel: string): Entry => {
    const scope = channelScope(channel)
    const existing = entries.get(scope)
    if (existing) {
      entries.delete(scope)
      entries.set(scope, existing)
      return existing
    }
    const login = encodeURIComponent(twitchIrcChannelName(channel))
    return createEntry(
      scope,
      `/api/twitch/badges?broadcasterLogin=${login}&scope=channel`,
      CHANNEL_TTL_MS,
    )
  }

  const evictIdleChannels = () => {
    let idle = 0
    for (const entry of entries.values()) if (entry !== global && !entry.holders) idle++
    for (const entry of entries.values()) {
      if (idle <= MAX_IDLE_CHANNELS) return
      if (entry === global || entry.holders || queue.has(entry.scope) || inFlight.has(entry.scope))
        continue
      entries.delete(entry.scope)
      idle--
    }
  }

  const armGate = (delayMs: number) => {
    cancelGate?.()
    cancelGate = schedule(() => {
      cancelGate = undefined
      pump()
    }, delayMs)
  }

  const nextQueued = (): string | undefined =>
    queue.has(global.scope) ? global.scope : queue.values().next().value

  function pump(): void {
    while (!lifetime.signal.aborted && active < MAX_CONCURRENT_REQUESTS && queue.size) {
      const waitMs = retryAt - now()
      if (waitMs > 0) {
        armGate(waitMs)
        return
      }
      // After a failure only one probe runs; its result reopens or extends the backoff.
      if (failures > 0 && active > 0) return
      const scope = nextQueued()
      if (scope === undefined) return
      queue.delete(scope)
      const entry = entries.get(scope)
      if (entry) start(entry)
    }
  }

  const enqueue = (entry: Entry) => {
    if (lifetime.signal.aborted) return
    const waitMs = entry.rejectedUntil - now()
    if (waitMs > 0) {
      scheduleRefresh(entry, waitMs)
      return
    }
    queue.add(entry.scope)
    pump()
  }

  function scheduleRefresh(entry: Entry, delayMs: number): void {
    entry.cancelRefresh?.()
    entry.cancelRefresh = schedule(() => {
      entry.cancelRefresh = undefined
      if (entry.holders) enqueue(entry)
    }, delayMs)
  }

  const scheduleRevalidation = (entry: Entry) => {
    // A running request reschedules the entry when it settles.
    if (!entry.holders || queue.has(entry.scope) || inFlight.has(entry.scope)) return
    const dueAt = entry.fetchedAt + entry.ttlMs * (0.8 + random() * 0.4)
    if (!entry.badges || dueAt <= now()) enqueue(entry)
    else scheduleRefresh(entry, dueAt - now())
  }

  const fetchCatalog = async (entry: Entry): Promise<Outcome> => {
    try {
      const response = await request(entry.path, {
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      })
      if (response.status === 429 || response.status >= 500) {
        return { kind: 'outage', retryAfterMs: retryAfterMs(response, now()) }
      }
      if (!response.ok) return { kind: 'rejected' }
      return { kind: 'ok', payload: await response.json() }
    } catch (error) {
      log.warn('Twitch badge request failed', { scope: entry.scope, error: String(error) })
      return { kind: 'outage', retryAfterMs: 0 }
    }
  }

  const apply = (entry: Entry, outcome: Outcome, startedAt: number) => {
    if (outcome.kind === 'ok') {
      try {
        entry.badges = parseTwitchBadgeCatalog(outcome.payload)
      } catch (error) {
        log.warn('Invalid Twitch badge catalog', { scope: entry.scope, error: String(error) })
        entry.rejectedUntil = now() + REJECTED_RETRY_MS
        return
      }
      entry.fetchedAt = now()
      entry.rejectedUntil = 0
      failures = 0
      retryAt = 0
      try {
        options.storage?.write(entry.scope, outcome.payload, entry.fetchedAt)
      } catch (error) {
        log.warn('Twitch badge catalog not stored', { scope: entry.scope, error: String(error) })
      }
      return
    }
    if (outcome.kind === 'rejected') {
      log.warn('Twitch badge catalog rejected by backend', { scope: entry.scope })
      entry.rejectedUntil = now() + REJECTED_RETRY_MS
      return
    }
    // Requests already in flight when another one failed belong to the same outage and do not
    // grow the backoff, but their Retry-After still applies.
    let delayMs = outcome.retryAfterMs
    if (startedAt > lastFailureAt) {
      failures++
      lastFailureAt = now()
      const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1))
      delayMs = Math.max(delayMs, ceiling / 2 + random() * (ceiling / 2))
      log.warn('Twitch badge backend unavailable, backing off', {
        failures,
        retryInMs: Math.round(Math.max(retryAt - now(), delayMs)),
      })
    }
    retryAt = Math.max(retryAt, now() + delayMs)
    if (entry.holders) queue.add(entry.scope)
  }

  function start(entry: Entry): void {
    active++
    inFlight.add(entry.scope)
    entry.cancelRefresh?.()
    entry.cancelRefresh = undefined
    const startedAt = now()
    fetchCatalog(entry)
      .then((outcome) => {
        if (lifetime.signal.aborted) return
        apply(entry, outcome, startedAt)
      })
      .catch((error: unknown) => {
        log.error('Twitch badge catalog update failed', {
          scope: entry.scope,
          error: String(error),
        })
      })
      .finally(() => {
        active--
        inFlight.delete(entry.scope)
        entry.attempts++
        if (lifetime.signal.aborted) return
        scheduleRevalidation(entry)
        for (const listener of listeners) listener()
        pump()
      })
  }

  const hold = (entry: Entry) => {
    entry.holders++
    if (entry.holders === 1) scheduleRevalidation(entry)
  }

  const releaseHold = (entry: Entry) => {
    entry.holders--
    if (entry.holders) return
    entry.cancelRefresh?.()
    entry.cancelRefresh = undefined
    queue.delete(entry.scope)
  }

  /** Keeps the channel's and global catalogs loaded and revalidated until released. */
  const acquire = (channel: string): (() => void) => {
    const entry = channelEntry(channel)
    hold(global)
    hold(entry)
    let released = false
    return () => {
      if (released) return
      released = true
      releaseHold(entry)
      releaseHold(global)
      evictIdleChannels()
    }
  }

  /**
   * Resolves once both catalogs have data or finished a request, or after `timeoutMs`.
   * Never rejects: callers fall back to whatever the resolver has.
   */
  const ready = (channel: string, timeoutMs: number): Promise<void> => {
    if (lifetime.signal.aborted) return Promise.resolve()
    const release = acquire(channel)
    const pending = [global, channelEntry(channel)]
    const baseline = pending.map((entry) => entry.attempts)
    const settled = () =>
      pending.every((entry, index) => entry.badges || entry.attempts > (baseline[index] ?? 0))
    if (settled()) {
      release()
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      let cancelTimeout: (() => void) | undefined
      const finish = () => {
        listeners.delete(check)
        cancelTimeout?.()
        release()
        resolve()
      }
      const check = () => {
        if (settled() || lifetime.signal.aborted) finish()
      }
      cancelTimeout = schedule(finish, timeoutMs)
      listeners.add(check)
    })
  }

  return {
    /** Live lookup: channel badges first, then global ones, reflecting later updates. */
    resolver(channel: string): TwitchBadgeResolver {
      const scope = channelEntry(channel).scope
      evictIdleChannels()
      return {
        get(id) {
          const channelBadges = entries.get(scope)?.badges
          if (channelBadges) return channelBadges.get(id) ?? global.badges?.get(id)
          const set = id.slice(0, id.indexOf('/'))
          return CHANNEL_SCOPED_SETS.has(set) ? undefined : global.badges?.get(id)
        },
      }
    },
    acquire,
    ready,

    dispose(): void {
      lifetime.abort()
      cancelGate?.()
      for (const entry of entries.values()) entry.cancelRefresh?.()
      queue.clear()
      for (const listener of listeners) listener()
    },
  }
}

export type TwitchBadgeCatalog = ReturnType<typeof createTwitchBadgeCatalog>
