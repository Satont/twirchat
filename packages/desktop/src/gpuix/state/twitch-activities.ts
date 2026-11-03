import type {
  TwitchActivitiesSnapshot,
  TwitchActivityAction,
  TwitchWhisper,
  TwitchActivityCapability,
  TwitchActivitySnapshotPart,
  TwitchActivitySnapshotUpdate,
} from '@twirchat/shared/twitch-activities'

import { runInBackground } from '../../services/background-task'
import type { DesktopApi } from '../backend/api'
import type { DesktopBackend } from '../backend/server'
import { accountsStore } from './app'
import type { Store } from './create-store'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

export interface ActivitiesState {
  snapshot: TwitchActivitiesSnapshot | null
  loading: boolean
  error: string | null
}
export const EMPTY_ACTIVITIES: ActivitiesState = { snapshot: null, loading: false, error: null }
export const twitchActivitiesStore = persistentResource('twitchActivities', () =>
  createStore<Map<string, ActivitiesState>>(new Map()),
)
export const whispersStore = persistentResource('twitchWhispers', () =>
  createStore<TwitchWhisper[]>([]),
)
export const lastWhisperRecipientStore = persistentResource('lastWhisperRecipient', () =>
  createStore<string | null>(null),
)
export function rememberWhisperRecipient(username: string): void {
  if (username.trim()) lastWhisperRecipientStore.set(username.trim().replace(/^@/u, ''))
}
export const twitchActivityCapabilitiesStore = persistentResource(
  'twitchActivityCapabilities',
  () => createStore<Map<string, TwitchActivityCapability>>(new Map()),
)
const pending = new Map<string, Promise<void>>()
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const snapshotFields: TwitchActivitySnapshotPart[] = [
  'polls',
  'predictions',
  'rewards',
  'pinnedMessage',
  'pointsBalance',
]
let snapshotRevision = 0
let identityRevision = 0
const fieldRevisions = new Map<string, Map<TwitchActivitySnapshotPart, number>>()
function patch(channel: string, fields: Partial<ActivitiesState>): void {
  twitchActivitiesStore.modify((states) =>
    new Map(states).set(channel, { ...EMPTY_ACTIVITIES, ...states.get(channel), ...fields }),
  )
}
function copySnapshotField<K extends TwitchActivitySnapshotPart>(
  target: TwitchActivitiesSnapshot,
  source: TwitchActivitiesSnapshot,
  key: K,
): void {
  target[key] = source[key]
}

export function loadTwitchActivities(
  backend: { api: Pick<DesktopApi, 'getTwitchActivities'> },
  channelSlug: string,
): Promise<void> {
  const key = channelSlug.toLowerCase()
  const current = pending.get(key)
  if (current) return current
  patch(key, { loading: true, error: null })
  const requestedAt = snapshotRevision
  const requestedIdentity = identityRevision
  const request = backend.api
    .getTwitchActivities({ channelSlug: key })
    .then((snapshot) => {
      if (requestedIdentity !== identityRevision) return
      const previous = twitchActivitiesStore.get().get(key)?.snapshot
      const newer = fieldRevisions.get(key)
      if (previous && newer) {
        for (const field of snapshotFields)
          if ((newer.get(field) ?? 0) > requestedAt) {
            copySnapshotField(snapshot, previous, field)
            if (previous.errors[field]) snapshot.errors[field] = previous.errors[field]
            else delete snapshot.errors[field]
          }
      }
      patch(key, { snapshot, loading: false, error: null })
    })
    .catch((error) => {
      if (requestedIdentity === identityRevision)
        patch(key, {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        })
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key)
    })
  pending.set(key, request)
  return request
}
export function applyTwitchActivitySnapshot(update: TwitchActivitySnapshotUpdate): void {
  const key = update.channelSlug.toLowerCase()
  const previous = twitchActivitiesStore.get().get(key)?.snapshot
  const sections = update.sections ?? snapshotFields
  const next = {
    ...(previous ?? update.snapshot),
    channelId: update.snapshot.channelId,
    channelSlug: update.snapshot.channelSlug,
    errors: { ...previous?.errors },
  }
  const revision = ++snapshotRevision
  const versions = fieldRevisions.get(key) ?? new Map<TwitchActivitySnapshotPart, number>()
  for (const field of sections) {
    copySnapshotField(next, update.snapshot, field)
    if (update.snapshot.errors[field]) next.errors[field] = update.snapshot.errors[field]
    else delete next.errors[field]
    versions.set(field, revision)
  }
  fieldRevisions.set(key, versions)
  patch(key, { snapshot: next, error: null })
}
export async function runTwitchActivity(
  backend: { api: Pick<DesktopApi, 'getTwitchActivities' | 'executeTwitchActivityAction'> },
  action: TwitchActivityAction,
): Promise<void> {
  await backend.api.executeTwitchActivityAction(action)
  await pending.get(action.channelSlug.toLowerCase())
  await loadTwitchActivities(backend, action.channelSlug)
}
export function wireTwitchActivities(backend: {
  events: DesktopBackend['events']
  api: Pick<DesktopApi, 'getTwitchActivities'>
}): () => void {
  const offAccounts = backend.events.on('accounts_changed', ({ platform, identityChanged }) => {
    if (platform !== 'twitch' || !identityChanged) return
    identityRevision++
    pending.clear()
    fieldRevisions.clear()
    for (const timer of refreshTimers.values()) clearTimeout(timer)
    refreshTimers.clear()
    twitchActivitiesStore.set(new Map())
    twitchActivityCapabilitiesStore.set(new Map())
    whispersStore.set([])
    lastWhisperRecipientStore.set(null)
  })
  const offSnapshot = backend.events.on('twitch_activity_snapshot', applyTwitchActivitySnapshot)
  const offCapability = backend.events.on('twitch_activity_capability', (capability) =>
    twitchActivityCapabilitiesStore.modify((states) =>
      new Map(states).set(capability.channelSlug.toLowerCase(), capability),
    ),
  )
  const offActivity = backend.events.on('twitch_activity', (event) => {
    for (const [slug, state] of twitchActivitiesStore.get()) {
      if (state.snapshot?.channelId !== event.channelId && slug !== event.channelId.toLowerCase())
        continue
      if (refreshTimers.has(slug)) continue
      refreshTimers.set(
        slug,
        setTimeout(() => {
          refreshTimers.delete(slug)
          runInBackground(
            loadTwitchActivities(backend, slug),
            'twitch-activities background operation failed',
          )
        }, 250),
      )
    }
  })
  const offWhisper = backend.events.on('twitch_whisper', (message) => {
    if (
      message.fromUserId !==
      accountsStore.get().find((account) => account.platform === 'twitch')?.platformUserId
    )
      rememberWhisperRecipient(message.fromLogin || message.fromDisplayName)
    whispersStore.modify((messages) =>
      messages.some((existing) => existing.id === message.id)
        ? messages
        : [...messages, message].slice(-1000),
    )
  })
  return () => {
    offAccounts()
    offActivity()
    offWhisper()
    offSnapshot()
    offCapability()
    for (const timer of refreshTimers.values()) clearTimeout(timer)
    refreshTimers.clear()
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    twitchActivities: Store<Map<string, ActivitiesState>>
    twitchWhispers: Store<TwitchWhisper[]>
    lastWhisperRecipient: Store<string | null>
    twitchActivityCapabilities: Store<Map<string, TwitchActivityCapability>>
  }
}
