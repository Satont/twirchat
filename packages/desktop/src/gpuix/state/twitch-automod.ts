import { deleteOldestEntry } from '../../services/bounded-cache'
import type {
  TwitchAutoModEvent,
  TwitchAutoModHold,
  TwitchAutoModResolution,
} from '../../services/twitch-automod'
import type { DesktopApi } from '../backend/api'
import type { DesktopEvents } from '../backend/events'
import { t } from '../i18n'
import { createStore, type Store } from './create-store'
import { persistentResource } from './persistent-resources'

type Decision = 'approve' | 'deny'

export type TwitchAutoModRow = { key: string; hold: TwitchAutoModHold } & (
  | { state: 'pending'; error?: string }
  | { state: 'deciding' }
  | { state: 'resolved'; resolution: TwitchAutoModResolution; moderatorName?: string }
)

export interface TwitchAutoModQueue {
  /** Ordered by hold time so the rows can be merged into the chat timeline. */
  rows: readonly TwitchAutoModRow[]
  resolved: ReadonlySet<string>
  total: number
}

const MAX_ROWS = 100
const MAX_RESOLVED = 200
export const EMPTY_AUTOMOD_QUEUE: TwitchAutoModQueue = { rows: [], resolved: new Set(), total: 0 }

export const twitchAutoModStore = persistentResource('twitchAutoMod', () =>
  createStore<ReadonlyMap<string, TwitchAutoModQueue>>(new Map()),
)

function updateChannel(
  channelSlug: string,
  update: (queue: TwitchAutoModQueue) => TwitchAutoModQueue,
) {
  twitchAutoModStore.modify((channels) => {
    const current = channels.get(channelSlug) ?? EMPTY_AUTOMOD_QUEUE
    const next = update(current)
    return next === current ? channels : new Map(channels).set(channelSlug, next)
  })
}

function replaceRow(
  queue: TwitchAutoModQueue,
  messageId: string,
  update: (row: TwitchAutoModRow) => TwitchAutoModRow | undefined,
): TwitchAutoModQueue {
  const index = queue.rows.findIndex((row) => row.hold.messageId === messageId)
  const current = queue.rows[index]
  const next = current && update(current)
  return next ? { ...queue, rows: queue.rows.with(index, next) } : queue
}

function markResolved(queue: TwitchAutoModQueue, messageId: string): ReadonlySet<string> {
  if (queue.resolved.has(messageId)) return queue.resolved
  const resolved = new Set(queue.resolved).add(messageId)
  if (resolved.size > MAX_RESOLVED) deleteOldestEntry(resolved)
  return resolved
}

function resolveRow(
  queue: TwitchAutoModQueue,
  messageId: string,
  resolution: TwitchAutoModResolution,
  moderatorName?: string,
): TwitchAutoModQueue {
  const next = replaceRow(queue, messageId, ({ key, hold }) => ({
    key,
    hold,
    state: 'resolved',
    resolution,
    ...(moderatorName ? { moderatorName } : {}),
  }))
  const resolved = markResolved(next, messageId)
  return resolved === next.resolved ? next : { ...next, resolved }
}

export function applyTwitchAutoModEvent(event: TwitchAutoModEvent): void {
  if (event.type === 'clear') {
    const { channelSlug } = event
    twitchAutoModStore.modify((channels) => {
      if (!channelSlug) return channels.size ? new Map() : channels
      if (!channels.has(channelSlug)) return channels
      const next = new Map(channels)
      next.delete(channelSlug)
      return next
    })
    return
  }

  updateChannel(event.channelSlug, (queue) => {
    if (event.type === 'resolve')
      return resolveRow(queue, event.messageId, event.status, event.moderatorName)
    if (
      queue.resolved.has(event.messageId) ||
      queue.rows.some((row) => row.hold.messageId === event.messageId)
    )
      return queue
    const row: TwitchAutoModRow = {
      key: `automod:${event.channelSlug}:${event.messageId}`,
      hold: event,
      state: 'pending',
    }
    const index = queue.rows.findLastIndex((entry) => entry.hold.timestamp <= event.timestamp) + 1
    return {
      ...queue,
      rows: queue.rows.toSpliced(index, 0, row).slice(-MAX_ROWS),
      total: queue.total + 1,
    }
  })
}

export function wireTwitchAutoMod(events: DesktopEvents): () => void {
  return events.on('twitch_automod', applyTwitchAutoModEvent)
}

function findRow(channelSlug: string, messageId: string) {
  return twitchAutoModStore
    .get()
    .get(channelSlug)
    ?.rows.find((row) => row.hold.messageId === messageId)
}

export async function decideTwitchAutoModMessage(
  api: Pick<DesktopApi, 'executePlatformCommand'>,
  {
    channelSlug,
    messageId,
    decision,
  }: {
    channelSlug: string
    messageId: string
    decision: Decision
  },
): Promise<void> {
  const row = findRow(channelSlug, messageId)
  if (row?.state !== 'pending') return
  const deciding: TwitchAutoModRow = { key: row.key, hold: row.hold, state: 'deciding' }
  updateChannel(channelSlug, (queue) => replaceRow(queue, messageId, () => deciding))
  const isCurrent = (current: TwitchAutoModRow) => current === deciding

  const command = decision === 'approve' ? 'automodallow' : 'automoddeny'
  try {
    await api.executePlatformCommand({
      platform: 'twitch',
      channelSlug,
      text: `/${command} ${messageId}`,
    })
    updateChannel(channelSlug, (queue) =>
      queue.rows.some(isCurrent)
        ? resolveRow(queue, messageId, decision === 'approve' ? 'approved' : 'denied')
        : queue,
    )
  } catch (error) {
    updateChannel(channelSlug, (queue) =>
      replaceRow(queue, messageId, (current) =>
        isCurrent(current)
          ? {
              key: row.key,
              hold: row.hold,
              state: 'pending',
              error: error instanceof Error ? error.message : t('notices.autoMod.decisionFailed'),
            }
          : undefined,
      ),
    )
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    twitchAutoMod: Store<ReadonlyMap<string, TwitchAutoModQueue>>
  }
}
