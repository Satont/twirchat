import type {
  TwitchActivitiesSnapshot,
  TwitchActivityAction,
  TwitchWhisper,
  TwitchActivityCapability,
  TwitchActivitySnapshotPart,
  TwitchActivitySnapshotUpdate,
} from '@twirchat/shared/twitch-activities'
import { z } from 'zod'

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
export const whisperContactsStore = persistentResource('whisperContacts', () =>
  createStore<WhisperContact[]>([]),
)
export const lastWhisperRecipientStore = persistentResource('lastWhisperRecipient', () =>
  createStore<string | null>(null),
)

export interface WhisperContact {
  userId: string
  login: string
  displayName: string
  avatarUrl?: string
}
export function rememberWhisperRecipient(username: string): void {
  if (username.trim()) lastWhisperRecipientStore.set(username.trim().replace(/^@/u, ''))
}

const WHISPER_HISTORY_KEY = 'whisper_history_v1'
const WHISPER_CONTACTS_KEY = 'whisper_contacts_v1'
const MAX_WHISPERS = 1000
const whisperContactsSchema = z.array(
  z.object({
    userId: z.string(),
    login: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().optional(),
  }),
)
const whisperHistorySchema = z.array(
  z.object({
    id: z.string(),
    fromUserId: z.string(),
    fromLogin: z.string(),
    fromDisplayName: z.string(),
    toUserId: z.string(),
    text: z.string(),
    at: z.string(),
  }),
)
let whisperWrites: Promise<void> = Promise.resolve()

function currentTwitchAccountId(): string | undefined {
  return accountsStore.get().find((account) => account.platform === 'twitch')?.id
}

export async function loadWhisperHistory(api: Pick<DesktopApi, 'getUiState'>): Promise<void> {
  const accountId = currentTwitchAccountId()
  if (!accountId) return
  const raw = await api.getUiState({ key: `${WHISPER_HISTORY_KEY}:${accountId}` })
  if (!raw) return
  let saved: z.infer<typeof whisperHistorySchema>
  try {
    saved = whisperHistorySchema.parse(JSON.parse(raw))
  } catch {
    return
  }
  whispersStore.modify((current) => {
    const byId = new Map(current.map((message) => [message.id, message]))
    for (const message of saved) byId.set(message.id, message)
    return [...byId.values()].toSorted((a, b) => a.at.localeCompare(b.at)).slice(-MAX_WHISPERS)
  })
}

export async function loadWhisperContacts(api: Pick<DesktopApi, 'getUiState'>): Promise<void> {
  const accountId = currentTwitchAccountId()
  if (!accountId) return
  const raw = await api.getUiState({ key: `${WHISPER_CONTACTS_KEY}:${accountId}` })
  if (!raw) return
  let saved: z.infer<typeof whisperContactsSchema>
  try {
    saved = whisperContactsSchema.parse(JSON.parse(raw))
  } catch {
    return
  }
  whisperContactsStore.modify((current) => {
    const byId = new Map(current.map((contact) => [contact.userId, contact]))
    for (const contact of saved) byId.set(contact.userId, contact)
    return [...byId.values()]
  })
}

export function rememberWhisperContact(
  api: Pick<DesktopApi, 'setUiState'>,
  contact: WhisperContact,
): void {
  whisperContactsStore.modify((current) =>
    current.some((existing) => existing.userId === contact.userId)
      ? current.map((existing) => (existing.userId === contact.userId ? contact : existing))
      : [...current, contact],
  )
  const accountId = currentTwitchAccountId()
  if (!accountId) return
  whisperWrites = whisperWrites
    .then(async () => {
      await api.setUiState({
        key: `${WHISPER_CONTACTS_KEY}:${accountId}`,
        value: JSON.stringify(whisperContactsStore.get()),
      })
    })
    .catch(() => {})
}

export function rememberWhisper(api: Pick<DesktopApi, 'setUiState'>, message: TwitchWhisper): void {
  whispersStore.modify((current) =>
    current.some((existing) => existing.id === message.id)
      ? current
      : [...current, message].slice(-MAX_WHISPERS),
  )
  const accountId = currentTwitchAccountId()
  if (!accountId) return
  whisperWrites = whisperWrites
    .then(async () => {
      await api.setUiState({
        key: `${WHISPER_HISTORY_KEY}:${accountId}`,
        value: JSON.stringify(whispersStore.get()),
      })
    })
    .catch(() => {})
}

export function rememberSentWhisper(
  api: Pick<DesktopApi, 'setUiState'>,
  params: { toUserId: string; toLogin: string; displayName: string; text: string },
): void {
  const account = accountsStore.get().find((item) => item.platform === 'twitch')
  if (!account || params.toUserId === account.platformUserId) return
  rememberWhisperContact(api, {
    userId: params.toUserId,
    login: params.toLogin,
    displayName: params.displayName,
  })
  rememberWhisper(api, {
    id: `local:${crypto.randomUUID()}`,
    fromUserId: account.platformUserId,
    fromLogin: account.username,
    fromDisplayName: account.displayName,
    toUserId: params.toUserId,
    text: params.text,
    at: new Date().toISOString(),
  })
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
let requestRevision = 0
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
  const requestedRevision = requestRevision
  const request = backend.api
    .getTwitchActivities({ channelSlug: key })
    .then((snapshot) => {
      if (requestedRevision !== requestRevision) return
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
      if (requestedRevision === requestRevision)
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
  expectedAccountId?: string,
): Promise<void> {
  await backend.api.executeTwitchActivityAction(action, expectedAccountId)
  await pending.get(action.channelSlug.toLowerCase())
  await loadTwitchActivities(backend, action.channelSlug)
}
export function wireTwitchActivities(backend: {
  events: DesktopBackend['events']
  api: Pick<DesktopApi, 'getTwitchActivities' | 'getUiState' | 'setUiState'>
}): () => void {
  void loadWhisperHistory(backend.api).catch(() => {})
  void loadWhisperContacts(backend.api).catch(() => {})
  const offAccounts = backend.events.on('accounts_changed', ({ platform, identityChanged }) => {
    if (platform !== 'twitch' || !identityChanged) return
    requestRevision++
    pending.clear()
    fieldRevisions.clear()
    for (const timer of refreshTimers.values()) clearTimeout(timer)
    refreshTimers.clear()
    twitchActivitiesStore.set(new Map())
    twitchActivityCapabilitiesStore.set(new Map())
    whispersStore.set([])
    whisperContactsStore.set([])
    lastWhisperRecipientStore.set(null)
    void loadWhisperHistory(backend.api).catch(() => {})
    void loadWhisperContacts(backend.api).catch(() => {})
  })
  const offWebSession = backend.events.on('twitch_web_session_changed', () => {
    requestRevision++
    pending.clear()
    twitchActivitiesStore.modify((states) => {
      const next = new Map(states)
      for (const [slug, state] of states) {
        const snapshot = state.snapshot
        next.set(slug, {
          ...state,
          loading: false,
          snapshot: snapshot && { ...snapshot, pointsBalance: undefined },
        })
      }
      return next
    })
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
    const ownId = accountsStore
      .get()
      .find((account) => account.platform === 'twitch')?.platformUserId
    if (message.fromUserId !== ownId) {
      rememberWhisperRecipient(message.fromLogin || message.fromDisplayName)
      rememberWhisperContact(backend.api, {
        userId: message.fromUserId,
        login: message.fromLogin,
        displayName: message.fromDisplayName,
      })
    }
    rememberWhisper(backend.api, message)
  })
  return () => {
    offAccounts()
    offWebSession()
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
    whisperContacts: Store<WhisperContact[]>
    lastWhisperRecipient: Store<string | null>
    twitchActivityCapabilities: Store<Map<string, TwitchActivityCapability>>
  }
}
