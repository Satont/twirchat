import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { runInBackground } from './background-task'
import { deleteOldestEntry } from './bounded-cache'

const translationProviderSchema = z.enum([
  'google-free',
  'microsoft-free',
  'deepl',
  'libretranslate',
  'google-cloud',
  'azure',
])
export const TRANSLATION_PROVIDERS = translationProviderSchema.options
export type TranslationProvider = z.infer<typeof translationProviderSchema>
export type OutgoingTranslationMode = 'off' | 'preview' | 'send'
export interface TranslationChannelSettings {
  platform: Platform
  channelId: string
  incoming?: boolean
  sourceLanguage?: string
  targetLanguage?: string
  outgoingMode?: OutgoingTranslationMode
}
export interface TranslationSettings {
  provider: TranslationProvider
  sourceLanguage: string
  targetLanguage: string
  autoIncoming: boolean
  outgoingMode: OutgoingTranslationMode
  decodeMorse: boolean
  libreEndpoint: string
  azureEndpoint: string
  azureRegion: string
  channels: TranslationChannelSettings[]
}
export interface TranslationSettingsView {
  settings: TranslationSettings
  credentials: TranslationProvider[]
}
export interface TranslationRequest {
  text: string
  sourceLanguage?: string
  targetLanguage?: string
  provider?: TranslationProvider
  protectedTerms?: string[]
  decodeMorse?: boolean
}
export interface TranslationResult {
  text: string
  originalText: string
  sourceLanguage?: string
  targetLanguage: string
  provider: TranslationProvider
  decodedMorse: boolean
}
export interface TranslationLanguage {
  code: string
  name: string
}
export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  provider: 'google-free',
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  autoIncoming: false,
  outgoingMode: 'off',
  decodeMorse: true,
  libreEndpoint: 'https://libretranslate.com',
  azureEndpoint: 'https://api.cognitive.microsofttranslator.com',
  azureRegion: '',
  channels: [],
}
const LANGUAGE_CODES =
  'af sq am ar hy az eu be bn bs bg ca ceb co hr cs da nl en eo et fi fr fy gl ka de el gu ht ha haw he hi hu is id ga it ja jv kn kk km ku ky lo la lv lt lb mk mg ms ml mt mi mr mn my ne no ps fa pl pt ro ru sr si sk sl so es su sw sv tg ta te th tr uk ur uz vi cy xh yi yo zh-CN zh-TW zu morse'.split(
    ' ',
  )
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' })
export const COMMON_TRANSLATION_LANGUAGES: TranslationLanguage[] = LANGUAGE_CODES.map((code) => ({
  code,
  name: code === 'morse' ? 'Morse' : (languageNames.of(code) ?? code),
}))
const codePattern = /^[a-z]{2,3}(?:[-_][a-z0-9]{2,10}){0,2}$/iu
export function normalizeTranslationLanguage(value: string, source = false): string {
  const trimmed = value.trim()
  if (trimmed.toLowerCase() === 'morse' || (source && trimmed.toLowerCase() === 'auto'))
    return trimmed.toLowerCase()
  const byName = COMMON_TRANSLATION_LANGUAGES.find(
    (language) => language.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (byName) return byName.code
  if (!codePattern.test(trimmed))
    throw new Error('Enter a language code such as en, ru, de or zh-CN.')
  return trimmed.replace('_', '-')
}
export function translationEndpoint(value: string, libre = false): string {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(libre && loopback && url.protocol === 'http:'))
  )
    throw new Error(
      'Use an HTTPS provider address without credentials, a query or a fragment. Local LibreTranslate may use HTTP.',
    )
  return url
    .toString()
    .replace(/\/+$/u, '')
    .replace(/\/translate$/iu, '')
}
export function validateTranslationSettings(value: unknown): TranslationSettings {
  if (!value || typeof value !== 'object')
    throw new Error('Translation settings must contain an object.')
  const settings = z
    .object({
      provider: translationProviderSchema,
      sourceLanguage: z.string(),
      targetLanguage: z.string(),
      autoIncoming: z.boolean(),
      outgoingMode: z.enum(['off', 'preview', 'send']),
      decodeMorse: z.boolean(),
      libreEndpoint: z.string(),
      azureEndpoint: z.string(),
      azureRegion: z.string(),
      channels: z.array(
        z.object({
          platform: z.enum(['twitch', 'kick', 'youtube']),
          channelId: z.string(),
          incoming: z.boolean().optional(),
          sourceLanguage: z.string().optional(),
          targetLanguage: z.string().optional(),
          outgoingMode: z.enum(['off', 'preview', 'send']).optional(),
        }),
      ),
    })
    .parse(value)
  if (!TRANSLATION_PROVIDERS.includes(settings.provider))
    throw new Error('Choose a translation provider.')
  if (typeof settings.sourceLanguage !== 'string' || typeof settings.targetLanguage !== 'string')
    throw new Error('Choose source and target languages.')
  settings.sourceLanguage = normalizeTranslationLanguage(settings.sourceLanguage, true)
  settings.targetLanguage = normalizeTranslationLanguage(settings.targetLanguage)
  if (
    typeof settings.autoIncoming !== 'boolean' ||
    typeof settings.decodeMorse !== 'boolean' ||
    !['off', 'preview', 'send'].includes(settings.outgoingMode)
  )
    throw new Error('Invalid translation mode.')
  if (
    typeof settings.libreEndpoint !== 'string' ||
    typeof settings.azureEndpoint !== 'string' ||
    typeof settings.azureRegion !== 'string'
  )
    throw new Error('Invalid provider connection settings.')
  settings.libreEndpoint = translationEndpoint(settings.libreEndpoint, true)
  settings.azureEndpoint = translationEndpoint(settings.azureEndpoint)
  if (settings.azureRegion && !/^[a-z][a-z0-9-]{0,63}$/iu.test(settings.azureRegion))
    throw new Error('Enter an Azure region such as eastus or westeurope.')
  if (!Array.isArray(settings.channels) || settings.channels.length > 1000)
    throw new Error('Invalid per-channel translation list.')
  const seen = new Set<string>()
  for (const channel of settings.channels) {
    if (
      !channel ||
      !['twitch', 'kick', 'youtube'].includes(channel.platform) ||
      typeof channel.channelId !== 'string' ||
      !channel.channelId.trim() ||
      channel.channelId.length > 256 ||
      (channel.incoming !== undefined && typeof channel.incoming !== 'boolean') ||
      (channel.outgoingMode !== undefined &&
        !['off', 'preview', 'send'].includes(channel.outgoingMode))
    )
      throw new Error('A translation channel needs a platform, channel name and valid modes.')
    channel.channelId = channel.channelId.trim()
    const key = `${channel.platform}:${channel.channelId.toLowerCase()}`
    if (seen.has(key)) throw new Error('A translation channel is listed more than once.')
    seen.add(key)
    if (channel.sourceLanguage)
      channel.sourceLanguage = normalizeTranslationLanguage(channel.sourceLanguage, true)
    if (channel.targetLanguage)
      channel.targetLanguage = normalizeTranslationLanguage(channel.targetLanguage)
  }
  return {
    provider: settings.provider,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    autoIncoming: settings.autoIncoming,
    outgoingMode: settings.outgoingMode,
    decodeMorse: settings.decodeMorse,
    libreEndpoint: settings.libreEndpoint,
    azureEndpoint: settings.azureEndpoint,
    azureRegion: settings.azureRegion,
    channels: settings.channels.map((channel) => ({
      platform: channel.platform,
      channelId: channel.channelId,
      incoming: channel.incoming,
      sourceLanguage: channel.sourceLanguage,
      targetLanguage: channel.targetLanguage,
      outgoingMode: channel.outgoingMode,
    })),
  }
}
export function resolveChannelTranslation(
  settings: TranslationSettings,
  platform: Platform,
  channelId: string,
) {
  const channel = settings.channels.find(
    (entry) =>
      entry.platform === platform && entry.channelId.toLowerCase() === channelId.toLowerCase(),
  )
  return {
    incoming: channel?.incoming ?? settings.autoIncoming,
    outgoingMode: channel?.outgoingMode ?? settings.outgoingMode,
    sourceLanguage: channel?.sourceLanguage || settings.sourceLanguage,
    targetLanguage: channel?.targetLanguage || settings.targetLanguage,
  }
}

const MORSE: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  _: '..--.-',
  '"': '.-..-.',
  $: '...-..-',
  '@': '.--.-.',
}
const MORSE_DECODE = new Map(Object.entries(MORSE).map(([letter, code]) => [code, letter]))
export function decodeMorseText(text: string, explicit = false): string | null {
  const normalized = text
    .trim()
    .replace(/^morse:\s*/iu, '')
    .replace(/[·•⋅]/gu, '.')
    .replace(/[−–—_]/gu, '-')
  if (!/^[.\-/|\s]*$/u.test(normalized.replace(/TWIRKEEPQ*\d+TOKEN/gu, ''))) return null
  const tokens = normalized
    .split(/[/|\s]+/u)
    .filter((token) => token && !/^TWIRKEEPQ*\d+TOKEN$/u.test(token))
  if (tokens.length < (explicit ? 1 : 2)) return normalized === '...---...' ? 'SOS' : null
  const words = normalized.split(/\s*[/|]\s*|\s{2,}/u)
  const decoded: string[] = []
  for (const word of words) {
    let result = ''
    for (const token of word.split(/\s+/u).filter(Boolean)) {
      if (/^TWIRKEEPQ*\d+TOKEN$/u.test(token)) {
        if (result) decoded.push(result)
        decoded.push(token)
        result = ''
        continue
      }
      const letter = token === '...---...' ? 'SOS' : MORSE_DECODE.get(token)
      if (!letter) return null
      result += letter
    }
    if (result) decoded.push(result)
  }
  const output = decoded.join(' ')
  if (
    !explicit &&
    !/[/|\s]{2,}|[/|]/u.test(normalized) &&
    (new Set(tokens).size < 2 || !/[AEIOU]/u.test(output))
  )
    return null
  return output || null
}
export function encodeMorseText(text: string): string {
  return text
    .split(/(TWIRKEEPQ*\d+TOKEN)/gu)
    .filter(Boolean)
    .map((part) =>
      /^TWIRKEEPQ*\d+TOKEN$/u.test(part)
        ? part
        : part
            .trim()
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .split(/\s+/u)
            .map((word) =>
              Array.from(word.toUpperCase())
                .map((letter) => MORSE[letter] ?? letter)
                .join(' '),
            )
            .join(' / '),
    )
    .join(' ')
}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function protectTranslationText(text: string, terms: readonly string[] = []) {
  const codes = [...new Set(terms.filter((term) => term && term.length <= 200))]
    .slice(0, 2000)
    .sort((a, b) => b.length - a.length)
  const emotes = codes.length
    ? `|(?<![\\p{L}\\p{N}_])(?:${codes.map(escapeRegex).join('|')})(?![\\p{L}\\p{N}_])`
    : ''
  const pattern = new RegExp(`(?:https?:\\/\\/|www\\.)[^\\s]+|@[\\p{L}\\p{N}_]+${emotes}`, 'gu')
  let prefix = 'TWIRKEEP'
  while (text.includes(prefix)) prefix += 'Q'
  const placeholders: { marker: string; text: string }[] = []
  const protectedText = text.replace(pattern, (value) => {
    const marker = `${prefix}${placeholders.length}TOKEN`
    placeholders.push({ marker, text: value })
    return marker
  })
  return {
    text: protectedText,
    restore(translated: string): string {
      let output = translated
      for (const entry of placeholders) {
        const marker = new RegExp(escapeRegex(entry.marker), 'giu')
        if (!marker.test(output))
          throw new Error(
            'The provider changed a protected emote, mention or link. Nothing was sent.',
          )
        marker.lastIndex = 0
        output = output.replace(marker, () => entry.text)
      }
      return output
    },
  }
}
export function translatedMessage(
  message: NormalizedChatMessage,
  text: string,
): NormalizedChatMessage {
  return {
    ...message,
    text,
    emotes: message.emotes.flatMap((emote) => {
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}_])${escapeRegex(emote.name)}(?![\\p{L}\\p{N}_])`,
        'gu',
      )
      const positions = [...text.matchAll(pattern)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length - 1,
      }))
      return positions.length ? [{ ...emote, positions }] : []
    }),
  }
}
function decodeHtml(value: string, stripTags = true): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  return (
    stripTags ? value.replace(/<br\s*\/?\s*>/giu, '\n').replace(/<[^>]*>/gu, '') : value
  ).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (whole, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? whole
    const number = Number.parseInt(
      entity.startsWith('#x') ? entity.slice(2) : entity.slice(1),
      entity.startsWith('#x') ? 16 : 10,
    )
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole
  })
}
function providerLanguage(provider: TranslationProvider, language: string, source = false): string {
  const lower = language.toLowerCase()
  if (provider === 'deepl')
    return (
      new Map<string, string>(
        Object.entries({
          en: source ? 'EN' : 'EN-US',
          pt: source ? 'PT' : 'PT-PT',
          'zh-cn': source ? 'ZH' : 'ZH-HANS',
          'zh-tw': source ? 'ZH' : 'ZH-HANT',
          iw: 'HE',
          tl: 'FIL',
        }),
      ).get(lower) ?? language.toUpperCase()
    )
  if (provider === 'azure' || provider === 'microsoft-free')
    return (
      new Map<string, string>(
        Object.entries({
          'zh-cn': 'zh-Hans',
          'zh-tw': 'zh-Hant',
          iw: 'he',
          tl: 'fil',
          ku: 'kmr',
          mn: 'mn-Cyrl',
          no: 'nb',
          sr: 'sr-Cyrl',
        }),
      ).get(lower) ?? language
    )
  return lower === 'iw' ? 'he' : lower === 'tl' && provider === 'google-cloud' ? 'fil' : language
}
const objectSchema = z.record(z.string(), z.unknown())
const object = (value: unknown): Record<string, unknown> => objectSchema.safeParse(value).data ?? {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const string = (value: unknown): string => (typeof value === 'string' ? value : '')
export function createTranslationService(options: {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  credential: (provider: TranslationProvider) => Promise<string | null>
  now?: () => number
  maxConcurrent?: number
  maxQueued?: number
  cacheTtlMs?: number
}) {
  const request = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const cache = new Map<string, { result: TranslationResult; expires: number }>()
  const inflight = new Map<string, Promise<TranslationResult>>()
  const queue: (() => void)[] = []
  let active = 0
  let revision = 0
  const run = <T>(action: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      if (queue.length >= (options.maxQueued ?? 128)) {
        reject(new Error('Translation is busy. Try again shortly.'))
        return
      }
      const start = () => {
        active++
        runInBackground(
          action()
            .then(resolve, reject)
            .finally(() => {
              active--
              queue.shift()?.()
            }),
          'translation background operation failed',
        )
      }
      if (active < (options.maxConcurrent ?? 3)) start()
      else queue.push(start)
    })
  async function fetchJson(
    url: string | URL,
    init: RequestInit,
    provider: TranslationProvider,
    secret = '',
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response
      try {
        response = await request(url, { ...init, signal: AbortSignal.timeout(12000) })
      } catch {
        throw new Error(
          `${provider} could not be reached. Check the connection or choose another provider.`,
        )
      }
      if ((response.status === 429 || response.status >= 500) && attempt === 0) {
        await response.body?.cancel()
        await Bun.sleep(300)
        continue
      }
      let value: unknown
      try {
        const reader = response.body?.getReader()
        if (!reader) throw new Error()
        const parts: Uint8Array[] = []
        let bytes = 0
        while (true) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.byteLength
          if (bytes > 1024 * 1024) {
            await reader.cancel()
            throw new Error()
          }
          parts.push(part.value)
        }
        const body = Buffer.concat(parts).toString('utf8')
        value = JSON.parse(body)
      } catch {
        throw new Error(`${provider} returned an invalid response (${response.status}).`)
      }
      if (!response.ok) {
        const error = object(value).error
        const detail =
          typeof error === 'string'
            ? error
            : string(object(error).message) || string(object(value).message)
        let safe = detail
        if (secret)
          safe = safe
            .replaceAll(secret, '[redacted]')
            .replaceAll(encodeURIComponent(secret), '[redacted]')
        safe = safe.slice(0, 250)
        throw new Error(
          `${provider} rejected the translation (${response.status})${safe ? `: ${safe}` : '.'}`,
        )
      }
      return value
    }
    throw new Error(`${provider} is temporarily unavailable.`)
  }
  async function providerTranslate(
    text: string,
    source: string,
    target: string,
    provider: TranslationProvider,
    settings: TranslationSettings,
  ): Promise<{ text: string; source?: string }> {
    const key = (await options.credential(provider)) ?? ''
    if (['deepl', 'google-cloud', 'azure'].includes(provider) && !key)
      throw new Error(`Set a ${provider} API key in Translation settings.`)
    const language = providerLanguage(provider, target)
    const from = source === 'auto' ? undefined : providerLanguage(provider, source, true)
    let url: URL
    const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    if (provider === 'google-free') {
      url = new URL('https://translate.googleapis.com/translate_a/single')
      url.search = new URLSearchParams({
        client: 'gtx',
        sl: source,
        tl: language,
        dt: 't',
        q: text,
      }).toString()
      init.method = 'GET'
    } else if (provider === 'microsoft-free') {
      url = new URL('https://edge.microsoft.com/translate/translatetext')
      url.search = new URLSearchParams({
        isEnterpriseClient: 'false',
        to: language,
        ...(from ? { from } : {}),
      }).toString()
      init.body = JSON.stringify([
        text
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll('\n', '<br>'),
      ])
    } else if (provider === 'deepl') {
      url = new URL(
        `https://${key.toLowerCase().endsWith(':fx') ? 'api-free' : 'api'}.deepl.com/v2/translate`,
      )
      init.headers = {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        Authorization: `DeepL-Auth-Key ${key}`,
      }
      init.body = JSON.stringify({
        text: [text],
        target_lang: language,
        ...(from ? { source_lang: from } : {}),
      })
    } else if (provider === 'google-cloud') {
      url = new URL('https://translation.googleapis.com/language/translate/v2')
      init.headers = {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        'X-Goog-Api-Key': key,
      }
      init.body = JSON.stringify({
        q: text,
        target: language,
        format: 'text',
        ...(from ? { source: from } : {}),
      })
    } else if (provider === 'libretranslate') {
      url = new URL(`${translationEndpoint(settings.libreEndpoint, true)}/translate`)
      init.body = JSON.stringify({
        q: text,
        source,
        target: language,
        format: 'text',
        ...(key ? { api_key: key } : {}),
      })
    } else {
      let base = translationEndpoint(settings.azureEndpoint)
      if (
        new URL(base).hostname.endsWith('.cognitiveservices.azure.com') &&
        new URL(base).pathname === '/'
      )
        base += '/translator/text/v3.0'
      url = new URL(`${base}/translate`)
      url.search = new URLSearchParams({
        'api-version': '3.0',
        to: language,
        ...(from ? { from } : {}),
      }).toString()
      init.headers = {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        'Ocp-Apim-Subscription-Key': key,
        ...(settings.azureRegion ? { 'Ocp-Apim-Subscription-Region': settings.azureRegion } : {}),
      }
      init.body = JSON.stringify([{ Text: text }])
    }
    const value = await fetchJson(url, init, provider, key)
    let output = ''
    let detected: string | undefined
    if (provider === 'google-free') {
      const root = list(value)
      const segments = list(root[0])
      if (segments.some((segment) => typeof list(segment)[0] !== 'string'))
        throw new Error('Google returned an incomplete translation.')
      output = segments.map((segment) => string(list(segment)[0])).join('')
      detected = string(root[2]) || undefined
    } else if (provider === 'microsoft-free' || provider === 'azure') {
      const first = object(list(value)[0])
      output = string(object(list(first.translations)[0]).text)
      if (provider === 'microsoft-free') output = decodeHtml(output)
      detected = string(object(first.detectedLanguage).language) || undefined
    } else if (provider === 'deepl') {
      const first = object(list(object(value).translations)[0])
      output = string(first.text)
      detected = string(first.detected_source_language) || undefined
    } else if (provider === 'google-cloud') {
      const first = object(list(object(object(value).data).translations)[0])
      output = decodeHtml(string(first.translatedText), false)
      detected = string(first.detectedSourceLanguage) || undefined
    } else {
      output = string(object(value).translatedText)
      detected = string(object(object(value).detectedLanguage).language) || undefined
    }
    if (!output.trim())
      throw new Error(`${provider} returned no translated text. Nothing was sent.`)
    if (output.length > 20000)
      throw new Error(`${provider} returned an unexpectedly long translation. Nothing was sent.`)
    return { text: output, source: detected }
  }
  return {
    clearCache(): void {
      revision++
      cache.clear()
      inflight.clear()
    },
    translate(
      input: TranslationRequest,
      settings: TranslationSettings,
    ): Promise<TranslationResult> {
      const provider = input.provider ?? settings.provider
      if (!TRANSLATION_PROVIDERS.includes(provider))
        return Promise.reject(new Error('Choose a translation provider.'))
      const originalText = input.text.trim()
      if (!originalText || Array.from(originalText).length > 5000)
        return Promise.reject(new Error('Translate between 1 and 5,000 characters at a time.'))
      const source = normalizeTranslationLanguage(
        input.sourceLanguage ?? settings.sourceLanguage,
        true,
      )
      const target = normalizeTranslationLanguage(input.targetLanguage ?? settings.targetLanguage)
      const cacheKey = JSON.stringify([
        provider,
        source,
        target,
        originalText,
        input.protectedTerms ?? [],
        input.decodeMorse ?? settings.decodeMorse,
        settings.libreEndpoint,
        settings.azureEndpoint,
        settings.azureRegion,
      ])
      const previous = cache.get(cacheKey)
      if (previous && previous.expires > now()) {
        cache.delete(cacheKey)
        cache.set(cacheKey, previous)
        return Promise.resolve(previous.result)
      }
      const pending = inflight.get(cacheKey)
      if (pending) return pending
      const startedAt = revision
      const promise = run(async () => {
        const protectedText = protectTranslationText(originalText, input.protectedTerms)
        const decode =
          (input.decodeMorse ?? settings.decodeMorse) || source === 'morse'
            ? decodeMorseText(protectedText.text, source === 'morse')
            : null
        if (source === 'morse' && !decode)
          throw new Error('The source text is not valid Morse code.')
        let translated: { text: string; source?: string }
        if (target === 'morse')
          translated = {
            text: encodeMorseText(decode ?? protectedText.text),
            source: decode ? 'morse' : source === 'auto' ? undefined : source,
          }
        else if (decode && target.toLowerCase() === 'en')
          translated = { text: decode, source: 'morse' }
        else
          translated = await providerTranslate(
            decode ?? protectedText.text,
            decode ? 'en' : source,
            target,
            provider,
            settings,
          )
        const result: TranslationResult = {
          text: protectedText.restore(translated.text),
          originalText,
          sourceLanguage: decode
            ? 'morse'
            : (translated.source ?? (source === 'auto' ? undefined : source)),
          targetLanguage: target,
          provider,
          decodedMorse: !!decode,
        }
        if (startedAt === revision) {
          cache.set(cacheKey, { result, expires: now() + (options.cacheTtlMs ?? 30 * 60 * 1000) })
          if (cache.size > 500) deleteOldestEntry(cache)
        }
        return result
      }).finally(() => {
        if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey)
      })
      inflight.set(cacheKey, promise)
      return promise
    },
    async languages(
      provider: TranslationProvider,
      settings: TranslationSettings,
    ): Promise<TranslationLanguage[]> {
      if (provider === 'google-free') return COMMON_TRANSLATION_LANGUAGES
      const key = (await options.credential(provider)) ?? ''
      let url: string
      const headers: Record<string, string> = {}
      if (provider === 'libretranslate')
        url = `${translationEndpoint(settings.libreEndpoint, true)}/languages`
      else if (provider === 'deepl') {
        if (!key) throw new Error('Set a DeepL API key first.')
        url = `https://${key.toLowerCase().endsWith(':fx') ? 'api-free' : 'api'}.deepl.com/v3/languages?resource=translate_text`
        headers.Authorization = `DeepL-Auth-Key ${key}`
      } else if (provider === 'google-cloud') {
        if (!key) throw new Error('Set a Google Cloud API key first.')
        url = 'https://translation.googleapis.com/language/translate/v2/languages?target=en'
        headers['X-Goog-Api-Key'] = key
      } else
        url =
          'https://api.cognitive.microsofttranslator.com/languages?api-version=3.0&scope=translation'
      const response = await run(() => fetchJson(url, { headers }, provider, key))
      let values: TranslationLanguage[]
      if (provider === 'azure' || provider === 'microsoft-free')
        values = Object.entries(object(object(response).translation)).map(([code, value]) => ({
          code,
          name: string(object(value).name) || code,
        }))
      else
        values = list(
          provider === 'google-cloud' ? object(object(response).data).languages : response,
        )
          .filter((value) => provider !== 'deepl' || object(value).usable_as_target === true)
          .map((value) => {
            const entry = object(value)
            const code = string(entry.code) || string(entry.language) || string(entry.lang)
            return { code, name: string(entry.name) || code }
          })
      if (!values.length || values.some((value) => !value.code))
        throw new Error(`${provider} returned no supported language list.`)
      return [...values, { code: 'morse', name: 'Morse' }]
    },
  }
}

export const AUTO_TRANSLATION_COMMAND = '/translateauto'
const autoTranslationCommandPattern = new RegExp(`^${AUTO_TRANSLATION_COMMAND}(?=\\s|$)`, 'iu')

export function isAutoTranslationCommand(text: string): boolean {
  return autoTranslationCommandPattern.test(text)
}

export function parseAutoTranslationCommand(
  text: string,
): { targetLanguage: string | null } | null {
  const input = text.trim()
  if (!isAutoTranslationCommand(input)) return null
  const argument = input.slice(AUTO_TRANSLATION_COMMAND.length).trim()
  if (!argument) throw new Error(`Usage: ${AUTO_TRANSLATION_COMMAND} <language|off>`)
  return {
    targetLanguage:
      argument.toLowerCase() === 'off' ? null : normalizeTranslationLanguage(argument),
  }
}

export type TranslationCommand =
  | { mode: 'preview'; targetLanguage?: string; text: string }
  | { mode: 'send'; targetLanguage: string; text: string }
export function parseTranslationCommand(text: string): TranslationCommand | null {
  const match = text.trim().match(/^\/(translate|translateto|saytranslate|tl)(?:\s+([\s\S]*))?$/iu)
  if (!match) return null
  const name = match[1] ?? ''.toLowerCase()
  const argument = match[2]?.trim() ?? ''
  if (name === 'translate') {
    if (!argument) throw new Error('Usage: /translate <message>')
    return { mode: 'preview', text: argument }
  }
  const parts = argument.match(/^(\S+)\s+([\s\S]+)$/u)
  if (!parts) throw new Error(`Usage: /${name} <language> <message>`)
  return {
    mode: name === 'translateto' ? 'preview' : 'send',
    targetLanguage: normalizeTranslationLanguage(parts[1] ?? ''),
    text: parts[2] ?? ''.trim(),
  }
}
