import type { Database } from 'bun:sqlite'

import {
  createTranslationService,
  DEFAULT_TRANSLATION_SETTINGS,
  TRANSLATION_PROVIDERS,
  validateTranslationSettings,
  type TranslationSettings,
  type TranslationSettingsView,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
  type TranslationLanguage,
} from '../../services/translation'
import { decryptAsync, encryptAsync } from '../../store/crypto'
import { getDb } from '../../store/db'
export type {
  TranslationSettings,
  TranslationSettingsView,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  TranslationLanguage,
}
const SETTINGS_KEY = 'translation_settings_v1'
const keyFor = (provider: TranslationProvider) => `secret:translation:${provider}`
const contexts = new WeakMap<
  Database,
  {
    service: ReturnType<typeof createTranslationService>
    secrets: Map<TranslationProvider, { encrypted: string; value: Promise<string> }>
    revisions: Map<TranslationProvider, number>
  }
>()
function validateProvider(provider: TranslationProvider): void {
  if (!TRANSLATION_PROVIDERS.includes(provider)) throw new Error('Choose a translation provider.')
}
function context(database = getDb()) {
  let previous = contexts.get(database)
  if (previous) return previous
  const secrets = new Map<TranslationProvider, { encrypted: string; value: Promise<string> }>()
  const service = createTranslationService({
    credential: async (provider) => {
      const encrypted = database
        .query<{ value: string }, [string]>('SELECT value FROM client_identity WHERE key = ?')
        .get(keyFor(provider))?.value
      if (!encrypted) return null
      const cached = secrets.get(provider)
      if (cached?.encrypted === encrypted) return cached.value
      const value = decryptAsync(encrypted).catch(() => {
        throw new Error(
          `The ${provider} API key could not be unlocked. Paste it again in Translation settings.`,
        )
      })
      secrets.set(provider, { encrypted, value })
      return value
    },
  })
  previous = { service, secrets, revisions: new Map() }
  contexts.set(database, previous)
  return previous
}
function readSettings(database = getDb()): TranslationSettings {
  const raw = database
    .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
    .get(SETTINGS_KEY)?.value
  return raw
    ? validateTranslationSettings(JSON.parse(raw))
    : structuredClone(DEFAULT_TRANSLATION_SETTINGS)
}
function settingsView(database: Database): TranslationSettingsView {
  const credentials = TRANSLATION_PROVIDERS.filter((provider) =>
    database
      .query<{ key: string }, [string]>('SELECT key FROM client_identity WHERE key = ?')
      .get(keyFor(provider)),
  )
  return { settings: readSettings(database), credentials }
}
export async function getTranslationSettings(): Promise<TranslationSettingsView> {
  return settingsView(getDb())
}
export async function saveTranslationSettings(
  value: TranslationSettings,
): Promise<TranslationSettingsView> {
  const settings = validateTranslationSettings(value)
  getDb().run(
    'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [SETTINGS_KEY, JSON.stringify(settings)],
  )
  context().service.clearCache()
  return getTranslationSettings()
}
export async function setTranslationCredential({
  provider,
  key,
}: {
  provider: TranslationProvider
  key: string
}): Promise<TranslationSettingsView> {
  validateProvider(provider)
  if (typeof key !== 'string' || !key.trim() || key.length > 8192 || /[\r\n]/u.test(key))
    throw new Error('Copy one valid translation API key without line breaks.')
  const database = getDb()
  const state = context(database)
  const revision = (state.revisions.get(provider) ?? 0) + 1
  state.revisions.set(provider, revision)
  const encrypted = await encryptAsync(key.trim())
  if (state.revisions.get(provider) !== revision) return settingsView(database)
  database.run(
    'INSERT INTO client_identity(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [keyFor(provider), encrypted],
  )
  state.secrets.delete(provider)
  state.service.clearCache()
  return settingsView(database)
}
export async function removeTranslationCredential({
  provider,
}: {
  provider: TranslationProvider
}): Promise<TranslationSettingsView> {
  validateProvider(provider)
  const database = getDb()
  const state = context(database)
  state.revisions.set(provider, (state.revisions.get(provider) ?? 0) + 1)
  database.run('DELETE FROM client_identity WHERE key = ?', [keyFor(provider)])
  state.secrets.delete(provider)
  state.service.clearCache()
  return settingsView(database)
}
export async function translateText(request: TranslationRequest): Promise<TranslationResult> {
  return context().service.translate(request, readSettings())
}
export async function getTranslationLanguages({
  provider,
}: { provider?: TranslationProvider } = {}): Promise<TranslationLanguage[]> {
  const settings = readSettings()
  const selected = provider ?? settings.provider
  validateProvider(selected)
  return context().service.languages(selected, settings)
}
