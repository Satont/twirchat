import {
  DEFAULT_IMAGE_UPLOADER_SETTINGS,
  uploadClipboardImage as uploadImage,
  validateImageUploaderSettings,
  type ClipboardImageUpload,
  type ImageUploaderSettings,
  type ImageUploadResult,
} from '../../services/image-uploader'
import { decryptAsync, encryptAsync } from '../../store/crypto'
import { getDb } from '../../store/db'

const SETTINGS_KEY = 'secret:image-uploader'

function readEncryptedSettings() {
  return getDb()
    .query<{ value: string }, [string]>('SELECT value FROM client_identity WHERE key = ?')
    .get(SETTINGS_KEY)?.value
}

export async function getImageUploaderSettings(): Promise<ImageUploaderSettings> {
  const value = readEncryptedSettings()
  if (!value) return { ...DEFAULT_IMAGE_UPLOADER_SETTINGS }
  const settings = await decryptAsync(value)
    .then((json) => validateImageUploaderSettings(JSON.parse(json)))
    .catch(() => null)
  if (value !== readEncryptedSettings()) return getImageUploaderSettings()
  if (!settings)
    throw new Error('Image uploader settings could not be opened. Save the configuration again.')
  return settings
}

export async function saveImageUploaderSettings(
  value: ImageUploaderSettings,
): Promise<ImageUploaderSettings> {
  const settings = validateImageUploaderSettings(value)
  const database = getDb()
  const encrypted = await encryptAsync(JSON.stringify(settings))
  database.run(
    'INSERT INTO client_identity (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [SETTINGS_KEY, encrypted],
  )
  return settings
}

export async function uploadClipboardImage({
  image,
  settings,
  signal,
}: ClipboardImageUpload): Promise<ImageUploadResult> {
  const saved = await getImageUploaderSettings()
  if (
    !saved.enabled ||
    settings.requestUrl !== saved.requestUrl ||
    settings.formField !== saved.formField ||
    settings.headers !== saved.headers ||
    settings.imageLink !== saved.imageLink ||
    settings.deletionLink !== saved.deletionLink
  )
    throw new Error('The image uploader settings changed. Paste the image again.')
  return uploadImage({ image, settings: saved, signal })
}
