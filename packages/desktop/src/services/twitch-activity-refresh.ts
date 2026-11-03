import type {
  TwitchActivityCapability,
  TwitchActivitySnapshotUpdate,
  TwitchActivitiesSnapshot,
  TwitchActivitySnapshotPart,
} from '@twirchat/shared/twitch-activities'

import { runInBackground } from './background-task'

export interface TwitchActivityRefreshDependencies {
  plan(channelSlug: string): Promise<Omit<TwitchActivityCapability, 'channelSlug'>>
  snapshot(
    channelSlug: string,
    sections: TwitchActivitySnapshotPart[],
  ): Promise<TwitchActivitiesSnapshot>
  publish(update: TwitchActivitySnapshotUpdate): void
  capability(capability: TwitchActivityCapability): void
  intervalMs?: number
  maxConcurrency?: number
}
interface WatchedActivity {
  channelSlug: string
  refs: number
  failures: number
  offline: boolean
  channelId?: string
  timer?: ReturnType<typeof setTimeout>
  running: boolean
  intervalMs: number
}

/** Bounded Twitch-only fallback for viewer data that has no authorized EventSub transport. */
export class TwitchActivityRefreshClient {
  private channels = new Map<string, WatchedActivity>()
  private pending = new Set<WatchedActivity>()
  private active = 0
  private stopped = false
  private generation = 0

  constructor(private readonly dependencies: TwitchActivityRefreshDependencies) {}

  async capability(channelSlug: string): Promise<TwitchActivityCapability> {
    return { channelSlug, ...(await this.dependencies.plan(channelSlug)) }
  }

  async watch(channelSlug: string, watch: boolean): Promise<void> {
    const key = channelSlug.trim().replace(/^#/, '').toLowerCase()
    if (!key) return
    const existing = this.channels.get(key)
    if (!watch) {
      if (!existing) return
      if (--existing.refs > 0) return
      clearTimeout(existing.timer)
      this.pending.delete(existing)
      this.channels.delete(key)
      return
    }
    this.stopped = false
    if (existing) {
      existing.refs++
      return
    }
    const entry: WatchedActivity = {
      channelSlug: key,
      refs: 1,
      failures: 0,
      offline: false,
      running: false,
      intervalMs: this.dependencies.intervalMs ?? 15000,
    }
    this.channels.set(key, entry)
    const capability = await this.capability(key)
    if (this.channels.get(key) !== entry) return
    this.dependencies.capability(capability)
    entry.intervalMs = capability.intervalMs ?? this.dependencies.intervalMs ?? 15000
    this.schedule(entry, capability.intervalMs ?? this.dependencies.intervalMs ?? 15000)
  }

  restart(): void {
    this.generation++
    this.stopped = false
    for (const entry of this.channels.values()) {
      clearTimeout(entry.timer)
      entry.failures = 0
      this.schedule(entry, 0)
    }
  }

  observeSnapshot(snapshot: TwitchActivitiesSnapshot): void {
    const entry = this.channels.get(snapshot.channelSlug.toLowerCase())
    if (entry) entry.channelId = snapshot.channelId
  }

  setChannelOnline(channelId: string, online: boolean, channelSlug?: string): void {
    for (const entry of this.channels.values()) {
      if (entry.channelId !== channelId && entry.channelSlug !== channelSlug?.toLowerCase())
        continue
      entry.channelId = channelId
      entry.offline = !online
      if (online && !entry.running) {
        clearTimeout(entry.timer)
        this.schedule(entry, 0)
      } else if (!entry.running) {
        clearTimeout(entry.timer)
        this.schedule(entry, Math.min(300000, entry.intervalMs * 4))
      }
    }
  }

  stop(): void {
    this.generation++
    this.stopped = true
    for (const entry of this.channels.values()) clearTimeout(entry.timer)
    this.pending.clear()
  }

  private schedule(entry: WatchedActivity, delay: number): void {
    if (this.stopped || this.channels.get(entry.channelSlug) !== entry) return
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      this.pending.add(entry)
      this.drain()
    }, delay)
    entry.timer.unref?.()
  }

  private drain(): void {
    while (
      !this.stopped &&
      this.active < (this.dependencies.maxConcurrency ?? 2) &&
      this.pending.size
    ) {
      const entry = this.pending.values().next().value
      if (!entry) break
      this.pending.delete(entry)
      if (this.channels.get(entry.channelSlug) !== entry || entry.running) continue
      this.active++
      entry.running = true
      const generation = this.generation
      runInBackground(
        this.refresh(entry).finally(() => {
          entry.running = false
          this.active--
          if (generation !== this.generation) this.schedule(entry, 0)
          this.drain()
        }),
        'twitch-activity-refresh background operation failed',
      )
    }
  }

  private async refresh(entry: WatchedActivity): Promise<void> {
    const generation = this.generation
    let interval = this.dependencies.intervalMs ?? 15000
    try {
      const capability = await this.capability(entry.channelSlug)
      if (
        this.stopped ||
        generation !== this.generation ||
        this.channels.get(entry.channelSlug) !== entry
      )
        return
      interval = capability.intervalMs ?? interval
      entry.intervalMs = interval
      if (!capability.snapshotSections.length || capability.mode === 'unavailable') {
        this.dependencies.capability(capability)
        this.schedule(entry, Math.max(interval, 30000))
        return
      }
      const snapshot = await this.dependencies.snapshot(
        entry.channelSlug,
        capability.snapshotSections,
      )
      if (
        this.channels.get(entry.channelSlug) !== entry ||
        this.stopped ||
        generation !== this.generation
      )
        return
      entry.channelId = snapshot.channelId
      const errors = Object.values(snapshot.errors).filter(
        (value): value is string => typeof value === 'string',
      )
      if (
        errors.some((error) =>
          /429|rate.?limit|too many|network|fetch failed|HTTP 5\d\d|offline/i.test(error),
        )
      )
        entry.failures++
      else entry.failures = 0
      this.dependencies.publish({
        channelSlug: entry.channelSlug,
        snapshot,
        sections: capability.snapshotSections,
      })
      this.dependencies.capability({
        ...capability,
        ...(errors.length ? { error: errors.join(' ').slice(0, 500) } : {}),
      })
    } catch (error) {
      entry.failures++
      if (
        this.channels.get(entry.channelSlug) === entry &&
        !this.stopped &&
        generation === this.generation
      )
        this.dependencies.capability({
          channelSlug: entry.channelSlug,
          mode: 'snapshot',
          snapshotSections: [],
          intervalMs: interval,
          error: error instanceof Error ? error.message : 'Twitch snapshot refresh failed.',
        })
    }
    const factor = Math.max(entry.offline ? 4 : 1, 2 ** Math.min(entry.failures, 4))
    if (generation === this.generation) this.schedule(entry, Math.min(300000, interval * factor))
  }
}
