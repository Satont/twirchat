import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import {
  createMessageSimilarityClassifier,
  DEFAULT_MESSAGE_SIMILARITY_SETTINGS,
  validateMessageSimilaritySettings,
  type MessageSimilarityFlags,
  type MessageSimilaritySettings,
} from '../../services/message-similarity'
import type { DesktopBackend } from '../backend/server'
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
  previousSettings?: MessageSimilaritySettings
  previousAccounts?: Account[]
}
const resources = globalThis.__twirchatGpuixResources
const upgradingRuntime = resources !== undefined && 'messageSimilarityRuntime' in resources
if (upgradingRuntime) {
  resources.messageSimilarityPolicySubscription?.()
  delete resources.messageSimilarityPolicySubscription
  delete resources.messageSimilarityRuntime
}
const runtime = persistentResource('messageSimilarityRuntimeV2', (): SimilarityRuntime => ({
  classifier: createMessageSimilarityClassifier(),
}))
const { classifier } = runtime

/** A policy-bound reader over the bounded live cache; fresh appends do not notify every pane. */
export interface MessageSimilarityReader {
  readonly policy: Readonly<MessageSimilaritySettings>
  get(message: NormalizedChatMessage): Readonly<MessageSimilarityFlags> | undefined
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
  const normal = Object.freeze(derive(false, policy))
  const similar = Object.freeze(derive(true, policy))
  return {
    policy,
    get(message) {
      const classified = classifier.getSimilarity(message)
      return classified === undefined ? undefined : classified ? similar : normal
    },
  }
}
let currentReader = createReader(messageSimilarityStore.get().value)
export const messageSimilarityReaderStore = persistentResource('messageSimilarityReader', () =>
  createStore(createReader(messageSimilarityStore.get().value)),
)
function publishReader(): void {
  messageSimilarityReaderStore.set(createReader(messageSimilarityStore.get().value))
  similarityRevisionStore.modify((revision) => revision + 1)
}
if (upgradingRuntime) publishReader()
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
): Readonly<MessageSimilarityFlags> {
  configure()
  return classifier.classifyIncoming(message, channelKey)
}
export function getMessageSimilarity(
  message: NormalizedChatMessage,
): Readonly<MessageSimilarityFlags> | undefined {
  const policy = messageSimilarityStore.get().value
  if (currentReader.policy !== policy) currentReader = createReader(policy)
  return currentReader.get(message)
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
    changed = classifier.seedClassification(message, channelKey, classified.similar) || changed
  }
  classifier.hydrate(channelKey, newestFirstMessages)
  if (changed) publishReader()
}
export function resetSimilarityHistory(channelKey?: string): void {
  classifier.reset(channelKey)
  publishReader()
}

declare module './persistent-resources' {
  interface PersistentResources {
    'preference:message_similarity_v1': PreferenceStore<typeof DEFAULT_MESSAGE_SIMILARITY_SETTINGS>
    messageSimilarityRevision: Store<number>
    messageSimilarityRuntimeV2: SimilarityRuntime
    messageSimilarityReader: Store<MessageSimilarityReader>
    messageSimilarityPolicySubscription: () => void
  }
}
