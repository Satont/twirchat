import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import { deleteOldestEntry } from '../../services/bounded-cache'
import {
  createMessageSimilarityClassifier,
  DEFAULT_MESSAGE_SIMILARITY_SETTINGS,
  validateMessageSimilaritySettings,
  similarityChannelKey,
  type MessageSimilarityFlags,
  type MessageSimilaritySettings,
} from '../../services/message-similarity'
import type { DesktopBackend } from '../backend/server'
import { chatMessageKey } from '../chat-tools'
import { accountsStore } from './app'
import { createStore, type Store } from './create-store'
import { persistentResource } from './persistent-resources'
import { createPreferenceStore, type PreferenceStore } from './preferences'

export const messageSimilarityPreferences = persistentResource(
  'preference:message_similarity_v1',
  () =>
    createPreferenceStore(
      'message_similarity_v1',
      DEFAULT_MESSAGE_SIMILARITY_SETTINGS,
      validateMessageSimilaritySettings,
    ),
)
export const messageSimilarityStore = messageSimilarityPreferences.store
export const similarityRevisionStore = persistentResource('messageSimilarityRevision', () =>
  createStore(0),
)
interface SimilarityRuntime {
  classifier: ReturnType<typeof createMessageSimilarityClassifier>
  flags: Map<string, { flags: MessageSimilarityFlags; channelKey: string }>
  previousSettings?: MessageSimilaritySettings
  previousAccounts?: Account[]
}
const runtime = persistentResource('messageSimilarityRuntime', (): SimilarityRuntime => ({
  classifier: createMessageSimilarityClassifier(),
  flags: new Map(),
}))
const { classifier, flags } = runtime

/** A policy-bound reader over the bounded live cache; fresh appends do not notify every pane. */
export interface MessageSimilarityReader {
  readonly policy: Readonly<MessageSimilaritySettings>
  get(message: NormalizedChatMessage): MessageSimilarityFlags | undefined
}
function derive(
  similar: boolean,
  settings: Readonly<MessageSimilaritySettings>,
): MessageSimilarityFlags {
  return {
    similar,
    gray: similar && settings.graySimilar,
    triggerHighlights:
      !similar || (!settings.hideSimilar && settings.shownSimilarTriggerHighlights),
  }
}
function createReader(policy: MessageSimilaritySettings): MessageSimilarityReader {
  return {
    policy,
    get(message) {
      const entry = flags.get(chatMessageKey(message))
      return entry ? derive(entry.flags.similar, policy) : undefined
    },
  }
}
export const messageSimilarityReaderStore = persistentResource('messageSimilarityReader', () =>
  createStore(createReader(messageSimilarityStore.get().value)),
)
function publishReader(): void {
  messageSimilarityReaderStore.set(createReader(messageSimilarityStore.get().value))
  similarityRevisionStore.modify((revision) => revision + 1)
}
persistentResource('messageSimilarityPolicySubscription', () =>
  messageSimilarityStore.subscribe(() => {
    const policy = messageSimilarityStore.get().value
    if (messageSimilarityReaderStore.get().policy !== policy) publishReader()
  }),
)
function configure(): void {
  const settings = messageSimilarityStore.get().value
  const accounts = accountsStore.get()
  if (settings === runtime.previousSettings && accounts === runtime.previousAccounts) return
  runtime.previousSettings = settings
  runtime.previousAccounts = accounts
  classifier.configure(settings, accounts)
}
export function loadMessageSimilaritySettings(backend: Pick<DesktopBackend, 'api'>): Promise<void> {
  return messageSimilarityPreferences.load(backend.api)
}
export function classifyIncomingSimilarity(
  message: NormalizedChatMessage,
  channelKey?: string,
): MessageSimilarityFlags {
  const key = chatMessageKey(message)
  const existing = flags.get(key)
  if (existing) return derive(existing.flags.similar, messageSimilarityStore.get().value)
  configure()
  const result = classifier.classifyIncoming(message, channelKey)
  flags.set(key, { flags: result, channelKey: channelKey ?? similarityChannelKey(message) })
  if (flags.size > 25000) deleteOldestEntry(flags)
  return result
}
export function getMessageSimilarity(
  message: NormalizedChatMessage,
): MessageSimilarityFlags | undefined {
  const entry = flags.get(chatMessageKey(message))
  return entry ? derive(entry.flags.similar, messageSimilarityStore.get().value) : undefined
}
export function hydrateSimilarityHistory(
  channelKey: string,
  newestFirstMessages: readonly NormalizedChatMessage[],
): void {
  configure()
  const temporary = createMessageSimilarityClassifier(
    messageSimilarityStore.get().value,
    accountsStore.get(),
  )
  let changed = false
  for (const message of newestFirstMessages.toReversed()) {
    const classified = temporary.classifyIncoming(message, channelKey)
    const key = chatMessageKey(message)
    if (!flags.has(key)) {
      flags.set(key, { flags: classified, channelKey })
      changed = true
      if (flags.size > 25000) deleteOldestEntry(flags)
    }
  }
  classifier.hydrate(channelKey, newestFirstMessages)
  if (changed) publishReader()
}
export function resetSimilarityHistory(channelKey?: string): void {
  classifier.reset(channelKey)
  if (channelKey === undefined) flags.clear()
  else for (const [key, value] of flags) if (value.channelKey === channelKey) flags.delete(key)
  publishReader()
}

declare module './persistent-resources' {
  interface PersistentResources {
    'preference:message_similarity_v1': PreferenceStore<typeof DEFAULT_MESSAGE_SIMILARITY_SETTINGS>
    messageSimilarityRevision: Store<number>
    messageSimilarityRuntime: SimilarityRuntime
    messageSimilarityReader: Store<MessageSimilarityReader>
    messageSimilarityPolicySubscription: () => void
  }
}
