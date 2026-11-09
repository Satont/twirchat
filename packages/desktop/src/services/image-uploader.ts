import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'

import { z } from 'zod'

import { t } from '../gpuix/i18n'

const settingsSchema = z.object({
  provider: z.literal('twir').optional(),
  enabled: z.boolean(),
  confirm: z.boolean(),
  requestUrl: z.string().max(4096).trim(),
  formField: z.string().max(256).trim(),
  headers: z.string().max(16384).trim(),
  imageLink: z.string().max(4096).trim(),
  deletionLink: z.string().max(4096).trim(),
})

export type ImageUploaderSettings = z.infer<typeof settingsSchema>
export type ImageUploaderPreferences = Pick<ImageUploaderSettings, 'enabled' | 'confirm'>

export const DEFAULT_IMAGE_UPLOADER_SETTINGS: ImageUploaderSettings = {
  enabled: false,
  confirm: true,
  requestUrl: '',
  formField: '',
  headers: '',
  imageLink: '',
  deletionLink: '',
}

export function twirImageUploaderSettings(
  preferences: ImageUploaderPreferences,
): ImageUploaderSettings {
  return {
    provider: 'twir',
    ...preferences,
    requestUrl: 'https://twir.app/api/v1/uploader/files',
    formField: 'file',
    headers: '',
    imageLink: '{data.link}',
    deletionLink: '{data.delete_link}',
  }
}

export interface ClipboardUploadImage {
  mimeType: string
  bytes: Uint8Array<ArrayBuffer>
}

export interface ImageUploadResult {
  imageUrl: string
  deletionUrl: string | null
}

export interface ClipboardImageUpload {
  image: ClipboardUploadImage
  settings: ImageUploaderSettings
  signal: AbortSignal
}

export class ImageUploadHttpError extends Error {
  constructor(readonly status: number) {
    super(t('misc.imageUploader.rejectedUpload', { status }))
  }
}

export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_RESPONSE_BYTES = 256 * 1024
const UPLOAD_TIMEOUT_MS = 60_000
const MANAGED_HEADERS = new Set(['content-type', 'content-length', 'host', 'transfer-encoding'])
const HEADER_SEPARATOR = /\r?\n|;(?=\s*[!#$%&'*+.^_`|~\w-]+[\t ]*:)/u
const URL_TOKEN = /\{([^{}]+)\}/gu
const SHAREX_TOKEN = /\{json:([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/giu

function httpUrl(value: string): URL | null {
  if (!/^https?:\/\//iu.test(value) || /[\s\p{Cc}\\]/u.test(value)) return null
  const url = URL.parse(value)
  return url && !url.username && !url.password ? url : null
}

function parseHeaders(input: string): Headers {
  const headers = new Headers()
  for (const line of input.replace(/;+$/u, '').split(HEADER_SEPARATOR)) {
    if (!line.trim()) continue
    const colon = line.indexOf(':')
    if (colon < 1) throw new Error(t('misc.imageUploader.headerFormat'))
    const name = line.slice(0, colon).trim()
    if (MANAGED_HEADERS.has(name.toLowerCase()))
      throw new Error(t('misc.imageUploader.managedHeaders'))
    try {
      headers.set(name, line.slice(colon + 1).trim())
    } catch {
      throw new Error(t('misc.imageUploader.headerInvalid'))
    }
  }
  return headers
}

export function validateImageUploaderSettings(value: unknown): ImageUploaderSettings {
  const result = settingsSchema.safeParse(value)
  if (!result.success) throw new Error(t('misc.imageUploader.invalidSettings'))
  const settings = result.data
  if ((settings.enabled || settings.requestUrl) && !httpUrl(settings.requestUrl))
    throw new Error(t('misc.imageUploader.requestUrl'))
  if ((settings.enabled && !settings.formField) || /[\p{Cc}"]/u.test(settings.formField))
    throw new Error(t('misc.imageUploader.formField'))
  parseHeaders(settings.headers)
  return settings
}

const sharexSchema = z.object({
  Version: z.unknown().refine((version) => version !== undefined),
  RequestURL: z.string(),
  FileFormName: z.string(),
  URL: z.string(),
  DeletionURL: z.unknown().optional(),
  Headers: z.unknown().optional(),
})

function readJson(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    return undefined
  }
}

function importLink(value: string): string {
  if (value.trim().toLowerCase() === '{response}') return ''
  return value.replace(SHAREX_TOKEN, (_, path: string) => {
    const field = path
      .slice(path.lastIndexOf('|') + 1)
      .trim()
      .replace(/\[(\d+)\]/gu, '.$1')
    return `{${field}}`
  })
}

export function importImageUploaderSettings(
  json: string,
  current: ImageUploaderSettings,
): ImageUploaderSettings {
  if (json.length > 64 * 1024) throw new Error(t('misc.imageUploader.configTooLarge'))
  const parsed = sharexSchema.safeParse(readJson(json))
  if (!parsed.success) throw new Error(t('misc.imageUploader.invalidJson'))
  const value = parsed.data
  const headers = z.record(z.string(), z.unknown()).safeParse(value.Headers)
  return validateImageUploaderSettings({
    enabled: true,
    confirm: current.confirm,
    requestUrl: value.RequestURL,
    formField: value.FileFormName,
    headers: headers.success
      ? Object.entries(headers.data)
          .flatMap(([name, header]) => (typeof header === 'string' ? [`${name}: ${header}`] : []))
          .join('; ')
      : '',
    imageLink: importLink(value.URL),
    deletionLink: typeof value.DeletionURL === 'string' ? importLink(value.DeletionURL) : '',
  })
}

export function exportImageUploaderSettings(settings: ImageUploaderSettings): string {
  if (settings.provider === 'twir') throw new Error(t('misc.imageUploader.twirExport'))
  const headers = Object.fromEntries(parseHeaders(settings.headers))
  return JSON.stringify(
    {
      Version: '1.0.0',
      Name: 'Chatterino Image Uploader Settings',
      RequestMethod: 'POST',
      Body: 'MultipartFormData',
      RequestURL: settings.requestUrl,
      FileFormName: settings.formField,
      URL: settings.imageLink,
      DeletionURL: settings.deletionLink,
      ...(settings.headers && { Headers: headers }),
    },
    null,
    2,
  )
}

function matches(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value)
}

interface RasterFormat {
  mimeType: string
  extensions: string[]
  matches: (bytes: Uint8Array) => boolean
}

const RASTER_FORMATS: RasterFormat[] = [
  {
    mimeType: 'image/png',
    extensions: ['png'],
    matches: (bytes) => bytes.length >= 33 && matches(bytes, [137, 80, 78, 71, 13, 10, 26, 10]),
  },
  {
    mimeType: 'image/jpeg',
    extensions: ['jpg', 'jpeg'],
    matches: (bytes) => bytes.length >= 16 && matches(bytes, [255, 216, 255]),
  },
  {
    mimeType: 'image/gif',
    extensions: ['gif'],
    matches: (bytes) =>
      bytes.length >= 13 &&
      matches(bytes, [71, 73, 70, 56]) &&
      (bytes[4] === 55 || bytes[4] === 57) &&
      bytes[5] === 97,
  },
  {
    mimeType: 'image/webp',
    extensions: ['webp'],
    matches: (bytes) =>
      bytes.length >= 20 && matches(bytes, [82, 73, 70, 70]) && matches(bytes, [87, 69, 66, 80], 8),
  },
  {
    mimeType: 'image/bmp',
    extensions: ['bmp'],
    matches: (bytes) => bytes.length >= 26 && matches(bytes, [66, 77]),
  },
  {
    mimeType: 'image/tiff',
    extensions: ['tiff', 'tif'],
    matches: (bytes) =>
      bytes.length >= 8 && (matches(bytes, [73, 73, 42, 0]) || matches(bytes, [77, 77, 0, 42])),
  },
  {
    mimeType: 'image/ico',
    extensions: ['ico'],
    matches: (bytes) => bytes.length >= 22 && matches(bytes, [0, 0, 1, 0]),
  },
  {
    mimeType: 'image/x-portable-anymap',
    extensions: ['pnm', 'pbm', 'pgm', 'ppm'],
    matches: (bytes) =>
      bytes.length >= 8 &&
      bytes[0] === 80 &&
      /[1-6][ \t\r\n]/u.test(String.fromCharCode(bytes[1] ?? 0, bytes[2] ?? 0)),
  },
]

function requireImageSize(size: number): void {
  if (size === 0) throw new Error(t('misc.imageUploader.emptyImage'))
  if (size > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error(t('misc.imageUploader.imageTooLarge'))
}

function clipboardImageFormat(path: string): RasterFormat | undefined {
  if (!isAbsolute(path)) return undefined
  const extension = extname(path).slice(1).toLowerCase()
  return RASTER_FORMATS.find((candidate) => candidate.extensions.includes(extension))
}

export function isClipboardImagePath(path: string): boolean {
  return clipboardImageFormat(path) !== undefined
}

export async function readClipboardUploadFile(path: string): Promise<ClipboardUploadImage | null> {
  const format = clipboardImageFormat(path)
  if (!format) return null
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => {
    throw new Error(t('misc.imageUploader.openFailed'))
  })
  try {
    const stat = await file.stat()
    if (!stat.isFile()) return null
    requireImageSize(stat.size)
    const buffer = await Bun.file(file.fd)
      .slice(0, MAX_CLIPBOARD_IMAGE_BYTES + 1)
      .arrayBuffer()
      .catch(() => {
        throw new Error(t('misc.imageUploader.readFailed'))
      })
    const bytes = new Uint8Array(buffer)
    requireImageSize(bytes.length)
    if (!format.matches(bytes)) return null
    return { mimeType: format.mimeType, bytes }
  } finally {
    await file.close()
  }
}

function renderLink(template: string, data: unknown): string | null {
  let missing = false
  const link = template.replace(URL_TOKEN, (_, path: string) => {
    let current = data
    for (const key of path.split('.')) {
      if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) {
        current = undefined
        break
      }
      current = Reflect.get(current, key)
    }
    if (typeof current === 'string') return current
    missing = true
    return ''
  })
  return missing ? null : link.trim()
}

function responseLinks(body: string, settings: ImageUploaderSettings): ImageUploadResult {
  const data =
    settings.imageLink.includes('{') || settings.deletionLink.includes('{')
      ? readJson(body)
      : undefined
  const imageUrl = settings.imageLink ? renderLink(settings.imageLink, data) : body.trim()
  if (!imageUrl || imageUrl.length > 4096 || !httpUrl(imageUrl))
    throw new Error(t('misc.imageUploader.invalidLink'))
  const deletion = settings.deletionLink && renderLink(settings.deletionLink, data)
  const deletionUrl = deletion && deletion.length <= 4096 && httpUrl(deletion) ? deletion : null
  return { imageUrl, deletionUrl }
}

async function readResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let size = 0
  let content = ''
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- check the size before pulling the next chunk.
      const { value, done } = await reader.read().catch(() => {
        throw new Error(t('misc.imageUploader.closedEarly'))
      })
      if (done) return content + decoder.decode()
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new Error(t('misc.imageUploader.oversizedResponse'))
      content += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

let uploading = false

export function uploadClipboardImage(request: ClipboardImageUpload): Promise<ImageUploadResult> {
  return uploadImage(request)
}

export function uploadTwirClipboardImage(
  { image, signal }: Pick<ClipboardImageUpload, 'image' | 'signal'>,
  accessToken: string,
): Promise<ImageUploadResult> {
  const settings = twirImageUploaderSettings({ enabled: true, confirm: true })
  return uploadImage({ image, settings, signal }, `Bearer ${accessToken}`)
}

async function uploadImage(
  { image, settings, signal }: ClipboardImageUpload,
  authorization?: string,
): Promise<ImageUploadResult> {
  if (uploading) throw new Error(t('misc.imageUploader.inProgress'))
  if (!settings.enabled) throw new Error(t('misc.imageUploader.disabled'))
  requireImageSize(image.bytes.length)
  const format = RASTER_FORMATS.find((candidate) => candidate.mimeType === image.mimeType)
  if (!format?.matches(image.bytes)) throw new Error(t('misc.imageUploader.unsupportedImage'))
  const headers = parseHeaders(settings.headers)
  if (authorization) headers.set('Authorization', authorization)
  const data = new FormData()
  data.set(
    settings.formField,
    new Blob([image.bytes], { type: format.mimeType }),
    `control_v.${format.extensions[0]}`,
  )
  const timeout = AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
  const cancellation = AbortSignal.any([signal, timeout])
  uploading = true
  try {
    cancellation.throwIfAborted()
    let response: Response
    try {
      response = await fetch(settings.requestUrl, {
        method: 'POST',
        body: data,
        headers,
        redirect: 'manual',
        signal: cancellation,
      })
    } catch {
      cancellation.throwIfAborted()
      throw new Error(t('misc.imageUploader.unreachable'))
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      if (response.status >= 300 && response.status < 400)
        throw new Error(t('misc.imageUploader.redirected'))
      throw new ImageUploadHttpError(response.status)
    }
    const body = await readResponse(response)
    cancellation.throwIfAborted()
    return responseLinks(body, settings)
  } catch (error) {
    if (cancellation.aborted)
      // oxlint-disable-next-line preserve-caught-error -- network errors may include the request URL.
      throw new Error(
        signal.aborted ? t('misc.imageUploader.canceled') : t('misc.imageUploader.timedOut'),
      )
    throw error
  } finally {
    uploading = false
  }
}
