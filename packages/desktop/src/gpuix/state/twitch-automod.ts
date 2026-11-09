import { deleteOldestEntry } from '../../services/bounded-cache'
import type { TwitchAutoModEvent, TwitchAutoModHold } from '../../services/twitch-automod'
import type { DesktopApi } from '../backend/api'
import type { DesktopEvents } from '../backend/events'
import { t } from '../i18n'
import { createStore, type Store } from './create-store'
import { persistentResource } from './persistent-resources'

type HeldMessage = { hold: TwitchAutoModHold } & (
  | { state: 'pending'; error?: string }
  | { state: 'deciding' }
)
type Decision = 'approve' | 'deny'

interface ChannelQueue {
  held: ReadonlyMap<string, HeldMessage>
  resolved: ReadonlySet<string>
}

const MAX_HELD = 50
const MAX_RESOLVED = 200
const emptyQueue: ChannelQueue = { held: new Map(), resolved: new Set() }

export const twitchAutoModStore = persistentResource('twitchAutoMod', () =>
  createStore<ReadonlyMap<string, ChannelQueue>>(new Map()),
)

function updateChannel(channelSlug: string, update: (queue: ChannelQueue) => ChannelQueue) {
  twitchAutoModStore.modify((channels) => {
    const current = channels.get(channelSlug) ?? emptyQueue
    const next = update(current)
    return next === current ? channels : new Map(channels).set(channelSlug, next)
  })
}

function resolveMessage(queue: ChannelQueue, messageId: string): ChannelQueue {
  if (queue.resolved.has(messageId)) return queue
  const held = new Map(queue.held)
  held.delete(messageId)
  const resolved = new Set(queue.resolved).add(messageId)
  if (resolved.size > MAX_RESOLVED) deleteOldestEntry(resolved)
  return { held, resolved }
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
    if (event.type === 'resolve') return resolveMessage(queue, event.messageId)
    if (queue.resolved.has(event.messageId) || queue.held.has(event.messageId)) return queue
    const held = new Map(queue.held)
    held.set(event.messageId, { hold: event, state: 'pending' })
    if (held.size > MAX_HELD) deleteOldestEntry(held)
    return { ...queue, held }
  })
}

export function wireTwitchAutoMod(events: DesktopEvents): () => void {
  return events.on('twitch_automod', applyTwitchAutoModEvent)
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
  const message = twitchAutoModStore.get().get(channelSlug)?.held.get(messageId)
  if (message?.state !== 'pending') return
  const deciding: HeldMessage = { hold: message.hold, state: 'deciding' }
  updateChannel(channelSlug, (queue) => ({
    ...queue,
    held: new Map(queue.held).set(messageId, deciding),
  }))

  const command = decision === 'approve' ? 'automodallow' : 'automoddeny'
  try {
    await api.executePlatformCommand({
      platform: 'twitch',
      channelSlug,
      text: `/${command} ${messageId}`,
    })
    updateChannel(channelSlug, (queue) =>
      queue.held.get(messageId) === deciding ? resolveMessage(queue, messageId) : queue,
    )
  } catch (error) {
    updateChannel(channelSlug, (queue) =>
      queue.held.get(messageId) === deciding
        ? {
            ...queue,
            held: new Map(queue.held).set(messageId, {
              ...message,
              error: error instanceof Error ? error.message : t('notices.autoMod.decisionFailed'),
            }),
          }
        : queue,
    )
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    twitchAutoMod: Store<ReadonlyMap<string, ChannelQueue>>
  }
}
