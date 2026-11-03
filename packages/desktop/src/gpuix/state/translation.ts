import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { runInBackground } from '../../services/background-task'
import type { TranslationResult, TranslationSettingsView } from '../../services/translation'
import { DEFAULT_TRANSLATION_SETTINGS, resolveChannelTranslation } from '../../services/translation'
import type { DesktopBackend } from '../backend/server'
import { chatMessageKey } from '../chat-tools'
import { accountsStore, watchedChannelsStore } from './app'
import type { Store } from './create-store'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

export const translationSettingsStore = persistentResource('translationSettings', () =>
  createStore<{
    value: TranslationSettingsView
    loaded: boolean
    loading: boolean
    saving: boolean
    error: string | null
  }>({
    value: { settings: structuredClone(DEFAULT_TRANSLATION_SETTINGS), credentials: [] },
    loaded: false,
    loading: false,
    saving: false,
    error: null,
  }),
)
export interface MessageTranslationState {
  status: 'loading' | 'ready' | 'error'
  result?: TranslationResult
  error?: string
  targetLanguage?: string
}
export const messageTranslationsStore = persistentResource('messageTranslations', () =>
  createStore<Map<string, MessageTranslationState>>(new Map()),
)
let loading: Promise<TranslationSettingsView> | null = null
let configurationRevision = 0
const generations = new Map<string, number>()
const requests = new Map<string, Promise<void>>()
export function applyTranslationSettings(value: TranslationSettingsView): void {
  configurationRevision++
  requests.clear()
  generations.clear()
  translationSettingsStore.update({ value, loaded: true, loading: false, error: null })
  messageTranslationsStore.set(new Map())
}
export function loadTranslationSettings(
  backend: Pick<DesktopBackend, 'api'>,
  force = false,
): Promise<TranslationSettingsView> {
  if (!force && translationSettingsStore.get().loaded && !translationSettingsStore.get().error)
    return Promise.resolve(translationSettingsStore.get().value)
  if (loading) return loading
  const revision = configurationRevision
  translationSettingsStore.update({ loading: true, error: null })
  loading = backend.api
    .getTranslationSettings()
    .then((value) => {
      if (revision === configurationRevision)
        translationSettingsStore.update({ value, loaded: true, loading: false, error: null })
      else translationSettingsStore.update({ loaded: true, loading: false })
      return translationSettingsStore.get().value
    })
    .catch((error: unknown) => {
      if (revision === configurationRevision)
        translationSettingsStore.update({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        })
      throw error
    })
    .finally(() => {
      loading = null
    })
  return loading
}
function updateMessage(key: string, value: MessageTranslationState): void {
  messageTranslationsStore.modify((current) => {
    const next = new Map(current).set(key, value)
    if (next.size > 500) {
      const oldest = next.keys().next().value
      if (oldest !== undefined) {
        next.delete(oldest)
        generations.delete(oldest)
      }
    }
    return next
  })
}
export function requestMessageTranslation(
  backend: Pick<DesktopBackend, 'api'>,
  message: NormalizedChatMessage,
  options: { targetLanguage?: string; channelId?: string; force?: boolean } = {},
): Promise<void> {
  const key = chatMessageKey(message)
  const existing = messageTranslationsStore.get().get(key)
  if (
    !options.force &&
    existing?.status === 'ready' &&
    (!options.targetLanguage || options.targetLanguage === existing.result?.targetLanguage)
  )
    return Promise.resolve()
  const pending = requests.get(key)
  if (!options.force && pending && existing?.targetLanguage === options.targetLanguage)
    return pending
  const generation = (generations.get(key) ?? 0) + 1
  generations.set(key, generation)
  const revision = configurationRevision
  updateMessage(key, { status: 'loading', targetLanguage: options.targetLanguage })
  const request = (async () => {
    try {
      const view = await loadTranslationSettings(backend)
      const selected = resolveChannelTranslation(
        view.settings,
        message.platform,
        options.channelId ?? message.channelId,
      )
      const result = await backend.api.translateText({
        text: message.text,
        targetLanguage: options.targetLanguage ?? selected.targetLanguage,
        sourceLanguage: selected.sourceLanguage,
        protectedTerms: message.emotes.map((emote) => emote.name),
      })
      if (generation === generations.get(key) && revision === configurationRevision)
        updateMessage(key, { status: 'ready', result, targetLanguage: result.targetLanguage })
    } catch (error) {
      if (generation === generations.get(key) && revision === configurationRevision)
        updateMessage(key, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          targetLanguage: options.targetLanguage,
        })
    }
  })().finally(() => {
    if (requests.get(key) === request) requests.delete(key)
  })
  requests.set(key, request)
  return request
}
export function wireAutoTranslations(backend: DesktopBackend): () => void {
  let disposed = false
  runInBackground(
    loadTranslationSettings(backend).catch(() => {}),
    'translation background operation failed',
  )
  const receive = async (message: NormalizedChatMessage, channelId?: string) => {
    if (disposed || message.type === 'system' || message.delivery) return
    try {
      const view = await loadTranslationSettings(backend)
      if (
        disposed ||
        !resolveChannelTranslation(view.settings, message.platform, channelId ?? message.channelId)
          .incoming
      )
        return
      if (
        accountsStore
          .get()
          .some(
            (account) =>
              account.platform === message.platform && account.platformUserId === message.author.id,
          )
      )
        return
      const prose = message.text
        .replace(/(?:https?:\/\/|www\.)\S+|@[\p{L}\p{N}_]+/gu, '')
        .split(/\s+/u)
        .filter((word) => !message.emotes.some((emote) => emote.name === word))
        .join(' ')
      if (!/[\p{L}\p{N}]/u.test(prose) && !/^[.\-/|\s·•⋅−–—]+$/u.test(prose)) return
      await requestMessageTranslation(backend, message, { channelId })
    } catch {
      /* Loading errors remain visible in Translation settings. */
    }
  }
  const subscriptions = [
    backend.events.on('chat_message', (message) => {
      runInBackground(receive(message), 'translation background operation failed')
    }),
    backend.events.on('watched_channel_message', ({ channelId, message }) => {
      const channel = watchedChannelsStore.get().find((entry) => entry.id === channelId)
      runInBackground(
        receive(message, channel?.channelSlug ?? message.channelId),
        'translation background operation failed',
      )
    }),
  ]
  return () => {
    disposed = true
    for (const unsubscribe of subscriptions) unsubscribe()
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    translationSettings: Store<{
      value: TranslationSettingsView
      loaded: boolean
      loading: boolean
      saving: boolean
      error: string | null
    }>
    messageTranslations: Store<Map<string, MessageTranslationState>>
  }
}
