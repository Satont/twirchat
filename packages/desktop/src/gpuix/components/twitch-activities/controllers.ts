import type {
  TwitchActivityCapability,
  TwitchActivitySnapshotPart,
  TwitchFollowingPage,
  TwitchRedemption,
  TwitchRewardQueueSummary,
} from '@twirchat/shared/twitch-activities'

import type { DesktopApi } from '../../backend/api'
import { runUiTask } from '../../hooks/run-ui-task'
import { t, tPlural } from '../../i18n'
import { createStore } from '../../state/create-store'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
export const MAX_QUEUE_ITEMS = 10000

function snapshotSectionText(section: TwitchActivitySnapshotPart): string {
  switch (section) {
    case 'pinnedMessage':
      return t('misc.twitchActivities.capability.pins')
    case 'pointsBalance':
      return t('misc.twitchActivities.capability.points')
    case 'polls':
      return t('misc.twitchActivities.capability.polls')
    case 'predictions':
      return t('misc.twitchActivities.capability.predictions')
    case 'rewards':
      return t('misc.twitchActivities.capability.rewards')
    default:
      return section
  }
}

export function activityCapabilityText(capability?: TwitchActivityCapability): string {
  if (!capability) return t('misc.twitchActivities.capability.checking')
  if (capability.mode === 'unavailable') return t('misc.twitchActivities.capability.unavailable')
  const sections = capability.snapshotSections.map(snapshotSectionText).join(', ')
  const interval = capability.intervalMs
    ? t('misc.twitchActivities.capability.interval', {
        seconds: Math.ceil(capability.intervalMs / 1000),
      })
    : ''
  if (capability.mode === 'eventsub')
    return sections
      ? t('misc.twitchActivities.capability.eventsub', { interval, sections })
      : t('misc.twitchActivities.capability.eventsubPlain')
  return t('misc.twitchActivities.capability.snapshot', {
    interval,
    sections: sections ? `: ${sections}` : '',
  })
}

export function mergeRedemptions(
  previous: TwitchRedemption[],
  incoming: TwitchRedemption[],
): TwitchRedemption[] {
  const entries = new Map(previous.map((item) => [item.id, item]))
  for (const item of incoming) entries.set(item.id, item)
  return [...entries.values()]
}

export interface RewardQueueState {
  rewardId: string
  order: 'NEWEST' | 'OLDEST'
  items: TwitchRedemption[]
  cursor?: string
  selected: Set<string>
  loading: boolean
  mutating: boolean
  error: string
  feedback: string
  summary: TwitchRewardQueueSummary | null
  summaryError: string
}

type QueueApi = Pick<
  DesktopApi,
  'getTwitchRewardRedemptions' | 'getTwitchRewardQueueSummary' | 'executeTwitchActivityAction'
>
export function createRewardQueueController(api: QueueApi, channelSlug: string) {
  const store = createStore<RewardQueueState>({
    rewardId: '',
    order: 'NEWEST',
    items: [],
    selected: new Set(),
    loading: false,
    mutating: false,
    error: '',
    feedback: '',
    summary: null,
    summaryError: '',
  })
  let revision = 0
  let summaryRevision = 0
  let disposed = false
  async function summary() {
    const requestedAt = ++summaryRevision
    try {
      const value = await api.getTwitchRewardQueueSummary({ channelSlug })
      if (!disposed && requestedAt === summaryRevision)
        store.update({ summary: value, summaryError: '' })
    } catch (cause) {
      if (!disposed && requestedAt === summaryRevision)
        store.update({ summaryError: errorText(cause) })
    }
  }
  async function load(mode: 'replace' | 'more' | 'all' = 'replace') {
    const current = store.get()
    if (disposed || current.loading || current.mutating) return
    const requestedAt = ++revision
    const valid = () => !disposed && requestedAt === revision
    const query = {
      channelSlug,
      ...(current.rewardId ? { rewardId: current.rewardId } : {}),
      order: current.order,
    }
    let cursor = mode === 'replace' ? undefined : current.cursor
    let items = mode === 'replace' ? [] : current.items
    const seen = new Set<string>()
    let pages = 0
    if (mode === 'more' && !cursor) return
    store.update({
      loading: true,
      error: '',
      feedback: '',
      ...(mode === 'replace' ? { items: [], selected: new Set(), cursor: undefined } : {}),
    })
    try {
      do {
        if (++pages > 200) throw new Error(t('misc.twitchActivities.queue.pageLimit'))
        const page = await api.getTwitchRewardRedemptions({
          ...query,
          ...(cursor ? { cursor } : {}),
        })
        if (!valid()) return
        items = mergeRedemptions(items, page.redemptions)
        if (items.length > MAX_QUEUE_ITEMS)
          throw new Error(t('misc.twitchActivities.queue.limitReached', { max: MAX_QUEUE_ITEMS }))
        const next = page.cursor
        store.update({ items, cursor: next })
        if (next && (next === cursor || seen.has(next))) {
          store.update({ cursor: undefined })
          throw new Error(t('misc.twitchActivities.queue.repeatedCursor'))
        }
        if (next) seen.add(next)
        cursor = next
        if (mode !== 'all') break
        if (cursor && items.length >= MAX_QUEUE_ITEMS)
          throw new Error(t('misc.twitchActivities.queue.loadedLimit', { max: MAX_QUEUE_ITEMS }))
      } while (cursor)
    } catch (cause) {
      if (valid()) store.update({ error: errorText(cause) })
    } finally {
      if (valid()) store.update({ loading: false })
    }
  }
  function changeQuery(rewardId: string, order: 'NEWEST' | 'OLDEST') {
    if (disposed || store.get().mutating) return
    revision++
    store.update({
      rewardId,
      order,
      items: [],
      cursor: undefined,
      selected: new Set(),
      loading: false,
      error: '',
      feedback: '',
    })
    runUiTask(load())
  }
  async function update(status: 'FULFILLED' | 'CANCELED') {
    const current = store.get()
    if (disposed || current.loading || current.mutating) return
    const groups = new Map<string, string[]>()
    for (const item of current.items) {
      if (!current.selected.has(item.id) || item.status !== 'UNFULFILLED') continue
      const group = groups.get(item.rewardId) ?? []
      group.push(item.id)
      groups.set(item.rewardId, group)
    }
    if (!groups.size) return
    store.update({ mutating: true, error: '', feedback: '' })
    let completed = 0
    const failures: string[] = []
    try {
      for (const [rewardId, ids] of groups) {
        for (let offset = 0; offset < ids.length; offset += 50) {
          if (disposed) return
          const batch = ids.slice(offset, offset + 50)
          try {
            await api.executeTwitchActivityAction({
              action: 'update_redemptions',
              channelSlug,
              rewardId,
              ids: batch,
              status,
            })
            if (disposed) return
            completed += batch.length
            const confirmed = new Set(batch)
            store.modify((value) => ({
              ...value,
              items: value.items.filter((item) => !confirmed.has(item.id)),
              selected: new Set([...value.selected].filter((id) => !confirmed.has(id))),
            }))
          } catch (cause) {
            failures.push(
              tPlural('misc.twitchActivities.queue.failure', batch.length, {
                error: errorText(cause),
              }),
            )
          }
        }
      }
      if (!disposed) {
        const outcome = tPlural(
          status === 'CANCELED'
            ? 'misc.twitchActivities.queue.feedback.rejected'
            : 'misc.twitchActivities.queue.feedback.completed',
          completed,
        )
        const retry = failures.length ? t('misc.twitchActivities.queue.feedback.retrySuffix') : ''
        store.update({
          feedback: `${outcome}${retry}.`,
          error: failures.join('\n'),
        })
        await summary()
      }
    } finally {
      if (!disposed) store.update({ mutating: false })
    }
  }
  return {
    store,
    load,
    summary,
    update,
    selectReward(rewardId: string) {
      changeQuery(rewardId, store.get().order)
    },
    setOrder(order: 'NEWEST' | 'OLDEST') {
      changeQuery(store.get().rewardId, order)
    },
    selectLoaded() {
      if (!store.get().mutating)
        store.update({
          selected: new Set(
            store
              .get()
              .items.filter((item) => item.status === 'UNFULFILLED')
              .map((item) => item.id),
          ),
        })
    },
    clearSelection() {
      if (!store.get().mutating) store.update({ selected: new Set() })
    },
    toggle(id: string) {
      if (store.get().mutating) return
      store.modify((value) => {
        const selected = new Set(value.selected)
        if (selected.has(id)) selected.delete(id)
        else selected.add(id)
        return { ...value, selected }
      })
    },
    dispose() {
      disposed = true
      revision++
      summaryRevision++
    },
  }
}

export function createFollowingController(api: Pick<DesktopApi, 'getTwitchFollowing'>) {
  const store = createStore<{
    page: TwitchFollowingPage | null
    liveOnly: boolean
    loading: boolean
    error: string
  }>({ page: null, liveOnly: true, loading: false, error: '' })
  let revision = 0
  let disposed = false
  async function load(liveOnly: boolean, more = false) {
    const previous = store.get()
    if (disposed || (more && (previous.loading || !previous.page?.cursor))) return
    const requestedAt = ++revision
    store.update({ liveOnly, loading: true, error: '', ...(more ? {} : { page: null }) })
    try {
      const page = await api.getTwitchFollowing({
        liveOnly,
        ...(more && previous.page?.cursor ? { cursor: previous.page.cursor } : {}),
      })
      if (disposed || revision !== requestedAt) return
      const channels = new Map(
        (more ? (previous.page?.channels ?? []) : []).map((item) => [item.id, item]),
      )
      for (const item of page.channels) channels.set(item.id, item)
      store.update({
        page: {
          ...page,
          channels: [...channels.values()],
          ...(page.cursor === previous.page?.cursor && more ? { cursor: undefined } : {}),
        },
      })
    } catch (cause) {
      if (!disposed && revision === requestedAt) store.update({ error: errorText(cause) })
    } finally {
      if (!disposed && revision === requestedAt) store.update({ loading: false })
    }
  }
  return {
    store,
    load,
    dispose() {
      disposed = true
      revision++
    },
  }
}
