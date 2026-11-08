import { z } from 'zod'

import {
  authorizeTwirUpload,
  refreshTwirUpload,
  revokeTwirUpload,
  TwirReconnectRequired,
  twirUploadTokens,
} from '../../auth/twir-upload'
import { runInBackground } from '../../services/background-task'
import {
  DEFAULT_IMAGE_UPLOADER_SETTINGS,
  ImageUploadHttpError,
  twirImageUploaderSettings,
  uploadClipboardImage as uploadImage,
  uploadTwirClipboardImage,
  validateImageUploaderSettings,
  type ClipboardImageUpload,
  type ImageUploaderSettings,
  type ImageUploadResult,
} from '../../services/image-uploader'
import { decryptAsync, encryptAsync } from '../../store/crypto'
import { getDb } from '../../store/db'
import { browserCommand } from './open-url'

const SETTINGS_KEY = 'secret:image-uploader'
const TWIR_TOKENS_KEY = 'secret:image-uploader:twir'
const TWIR_PREFERENCES_KEY = 'image-uploader:twir-preferences'
const REFRESH_MARGIN_MS = 60_000

const preferencesSchema = z.object({ enabled: z.boolean(), confirm: z.boolean() })

interface StoredTwirAccess {
  encrypted: string
  accessToken: string
}

let signIn: AbortController | null = null
let pendingAccess: { encrypted: string; result: Promise<StoredTwirAccess> } | null = null

function read(key: string): string | undefined {
  return getDb()
    .query<{ value: string }, [string]>('SELECT value FROM client_identity WHERE key = ?')
    .get(key)?.value
}

function write(key: string, value: string): void {
  getDb().run(
    'INSERT INTO client_identity (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, value],
  )
}

async function getCustomSettings(): Promise<ImageUploaderSettings> {
  const value = read(SETTINGS_KEY)
  if (!value) return { ...DEFAULT_IMAGE_UPLOADER_SETTINGS }
  const settings = await decryptAsync(value)
    .then((json) => validateImageUploaderSettings(JSON.parse(json)))
    .catch(() => null)
  if (value !== read(SETTINGS_KEY)) return getCustomSettings()
  if (!settings)
    throw new Error('Image uploader settings could not be opened. Save the configuration again.')
  return settings
}

function getTwirSettings(): ImageUploaderSettings | undefined {
  if (!read(TWIR_TOKENS_KEY)) return undefined
  const raw = read(TWIR_PREFERENCES_KEY)
  const preferences = raw
    ? preferencesSchema.parse(JSON.parse(raw))
    : { enabled: true, confirm: true }
  return twirImageUploaderSettings(preferences)
}

export async function getImageUploaderSettings(): Promise<ImageUploaderSettings> {
  const twir = getTwirSettings()
  if (twir) return twir
  const custom = await getCustomSettings()
  return getTwirSettings() ?? custom
}

export async function saveImageUploaderSettings(
  value: ImageUploaderSettings,
): Promise<ImageUploaderSettings> {
  if (value.provider === 'twir') {
    if (!read(TWIR_TOKENS_KEY)) throw new TwirReconnectRequired()
    const preferences = preferencesSchema.parse(value)
    write(TWIR_PREFERENCES_KEY, JSON.stringify(preferences))
    return twirImageUploaderSettings(preferences)
  }
  const settings = validateImageUploaderSettings(value)
  const encrypted = await encryptAsync(JSON.stringify(settings))
  if (read(TWIR_TOKENS_KEY)) throw new Error('The image uploader changed. Reload its settings.')
  write(SETTINGS_KEY, encrypted)
  return settings
}

async function readTwirTokens(encrypted: string) {
  return decryptAsync(encrypted)
    .then((json) => twirUploadTokens.parse(JSON.parse(json)))
    .catch(() => {
      throw new TwirReconnectRequired()
    })
}

async function openTwirBrowser(url: string): Promise<void> {
  const process = Bun.spawn(browserCommand(url), { stdout: 'ignore', stderr: 'ignore' })
  if ((await process.exited) !== 0) throw new Error('Could not open the browser.')
}

function revokeStoredTwirSession(encrypted: string): void {
  runInBackground(
    readTwirTokens(encrypted).then(({ refreshToken }) => revokeTwirUpload(refreshToken)),
    'Could not revoke the previous Twir upload session',
  )
}

export async function connectTwirImageUploader(
  { signal }: { signal: AbortSignal },
  openBrowser = openTwirBrowser,
): Promise<ImageUploaderSettings> {
  if (signIn) throw new Error('Twir sign-in is already in progress.')
  signIn = new AbortController()
  const cancellation = AbortSignal.any([signal, signIn.signal])
  try {
    const tokens = await authorizeTwirUpload({ signal: cancellation, openBrowser })
    try {
      const encrypted = await encryptAsync(JSON.stringify(tokens))
      const existing = await getImageUploaderSettings()
      const preferences = {
        enabled: existing.provider === 'twir' ? existing.enabled : true,
        confirm: existing.confirm,
      }
      cancellation.throwIfAborted()
      const previous = read(TWIR_TOKENS_KEY)
      getDb().transaction(() => {
        write(TWIR_PREFERENCES_KEY, JSON.stringify(preferences))
        write(TWIR_TOKENS_KEY, encrypted)
      })()
      if (previous) revokeStoredTwirSession(previous)
      return twirImageUploaderSettings(preferences)
    } catch (error) {
      runInBackground(revokeTwirUpload(tokens.refreshToken), 'Could not revoke Twir upload session')
      throw error
    }
  } finally {
    signIn = null
  }
}

export async function disconnectTwirImageUploader(): Promise<ImageUploaderSettings> {
  signIn?.abort()
  const encrypted = read(TWIR_TOKENS_KEY)
  getDb().run('DELETE FROM client_identity WHERE key IN (?, ?)', [
    TWIR_TOKENS_KEY,
    TWIR_PREFERENCES_KEY,
  ])
  if (encrypted) revokeStoredTwirSession(encrypted)
  return getCustomSettings()
}

async function readTwirAccessToken(encrypted: string): Promise<StoredTwirAccess> {
  const saved = await readTwirTokens(encrypted)
  if (encrypted !== read(TWIR_TOKENS_KEY)) throw new TwirReconnectRequired()
  if (saved.expiresAt > Date.now() + REFRESH_MARGIN_MS)
    return { encrypted, accessToken: saved.accessToken }

  const tokens = await refreshTwirUpload(saved.refreshToken)
  const rotated = await encryptAsync(JSON.stringify(tokens))
  const update = getDb().run('UPDATE client_identity SET value = ? WHERE key = ? AND value = ?', [
    rotated,
    TWIR_TOKENS_KEY,
    encrypted,
  ])
  if (!update.changes) throw new TwirReconnectRequired()
  return { encrypted: rotated, accessToken: tokens.accessToken }
}

async function getTwirAccessToken(): Promise<StoredTwirAccess> {
  const encrypted = read(TWIR_TOKENS_KEY)
  if (!encrypted) throw new TwirReconnectRequired()
  if (pendingAccess?.encrypted === encrypted) return pendingAccess.result
  const result = readTwirAccessToken(encrypted).finally(() => {
    if (pendingAccess?.result === result) pendingAccess = null
  })
  pendingAccess = { encrypted, result }
  return result
}

export async function uploadClipboardImage({
  image,
  settings,
  signal,
}: ClipboardImageUpload): Promise<ImageUploadResult> {
  const saved = await getImageUploaderSettings()
  if (
    !saved.enabled ||
    settings.provider !== saved.provider ||
    settings.requestUrl !== saved.requestUrl ||
    settings.formField !== saved.formField ||
    settings.headers !== saved.headers ||
    settings.imageLink !== saved.imageLink ||
    settings.deletionLink !== saved.deletionLink
  )
    throw new Error('The image uploader settings changed. Paste the image again.')
  if (saved.provider !== 'twir') return uploadImage({ image, settings: saved, signal })

  const { encrypted, accessToken } = await getTwirAccessToken()
  if (encrypted !== read(TWIR_TOKENS_KEY) || !getTwirSettings()?.enabled)
    throw new Error('The image uploader settings changed. Paste the image again.')
  try {
    return await uploadTwirClipboardImage({ image, signal }, accessToken)
  } catch (error) {
    if (error instanceof ImageUploadHttpError && error.status === 401)
      throw new TwirReconnectRequired()
    throw error
  }
}
