import { describe, expect, test } from 'bun:test'

import { normalizePrivateCommand } from '../src/services/private-commands'
import {
  createTranslationService,
  DEFAULT_TRANSLATION_SETTINGS,
  decodeMorseText,
  encodeMorseText,
  normalizeTranslationLanguage,
  parseAutoTranslationCommand,
  parseTranslationCommand,
  protectTranslationText,
  resolveChannelTranslation,
  translationEndpoint,
  validateTranslationSettings,
  type TranslationProvider,
} from '../src/services/translation'

const settings = () => structuredClone(DEFAULT_TRANSLATION_SETTINGS)
const json = (value: unknown, status = 200) => Response.json(value, { status })
function service(
  responder: (url: URL, init: RequestInit) => Response | Promise<Response>,
  extras: Partial<Parameters<typeof createTranslationService>[0]> = {},
) {
  return createTranslationService({
    credential: async () => 'secret:fx',
    fetch: async (url: string | URL | Request, init?: RequestInit) =>
      responder(new URL(url instanceof Request ? url.url : url.toString()), init ?? {}),
    ...extras,
  })
}

describe('translation provider contracts', () => {
  const cases: [TranslationProvider, string, unknown][] = [
    ['google-free', 'translate.googleapis.com', [[['Bonjour', 'Hello']], null, 'en']],
    ['microsoft-free', 'edge.microsoft.com', [{ translations: [{ text: 'Bonjour' }] }]],
    ['deepl', 'api-free.deepl.com', { translations: [{ text: 'Bonjour' }] }],
    ['libretranslate', 'libretranslate.com', { translatedText: 'Bonjour' }],
    [
      'google-cloud',
      'translation.googleapis.com',
      { data: { translations: [{ translatedText: 'Bonjour' }] } },
    ],
    ['azure', 'api.cognitive.microsofttranslator.com', [{ translations: [{ text: 'Bonjour' }] }]],
  ]
  for (const [provider, host, response] of cases) {
    test(provider, async () => {
      let calls = 0
      const engine = service((url, init) => {
        calls++
        expect(url.hostname).toBe(host)
        expect(url.toString()).not.toContain('secret')
        const body = init.body ? JSON.parse(String(init.body)) : undefined
        if (provider === 'google-free') {
          expect(init.method).toBe('GET')
          expect(url.searchParams.get('q')).toBe('Hello')
          expect(url.searchParams.get('tl')).toBe('fr')
        } else if (provider === 'microsoft-free') {
          expect(url.pathname).toBe('/translate/translatetext')
          expect(body).toEqual(['Hello'])
        } else if (provider === 'deepl') {
          expect(new Headers(init.headers).get('Authorization')).toBe('DeepL-Auth-Key secret:fx')
          expect(body).toEqual({ text: ['Hello'], target_lang: 'FR' })
        } else if (provider === 'google-cloud') {
          expect(new Headers(init.headers).get('X-Goog-Api-Key')).toBe('secret:fx')
          expect(body).toEqual({ q: 'Hello', target: 'fr', format: 'text' })
        } else if (provider === 'libretranslate') {
          expect(body).toEqual({
            q: 'Hello',
            source: 'auto',
            target: 'fr',
            format: 'text',
            api_key: 'secret:fx',
          })
        } else {
          expect(new Headers(init.headers).get('Ocp-Apim-Subscription-Key')).toBe('secret:fx')
          expect(url.searchParams.get('api-version')).toBe('3.0')
          expect(body).toEqual([{ Text: 'Hello' }])
        }
        return json(response)
      })
      const result = await engine.translate(
        { text: 'Hello', targetLanguage: 'fr', provider },
        settings(),
      )
      expect(result.text).toBe('Bonjour')
      expect(calls).toBe(1)
    })
  }
  test('Azure resource endpoint, region and language aliases', async () => {
    const config = {
      ...settings(),
      azureEndpoint: 'https://example.cognitiveservices.azure.com',
      azureRegion: 'westeurope',
    }
    await service((url, init) => {
      expect(url.pathname).toBe('/translator/text/v3.0/translate')
      expect(new Headers(init.headers).get('Ocp-Apim-Subscription-Region')).toBe('westeurope')
      return json([{ translations: [{ text: '你好' }] }])
    }).translate({ text: 'Hello', provider: 'azure', targetLanguage: 'zh-cn' }, config)
  })
  test('DeepL v3 language catalog filters source-only entries', async () => {
    const languages = await service((url) => {
      expect(url.pathname).toBe('/v3/languages')
      expect(url.searchParams.get('resource')).toBe('translate_text')
      return json([
        { lang: 'EN-US', name: 'English', usable_as_target: true },
        { lang: 'XX', usable_as_target: false },
      ])
    }).languages('deepl', settings())
    expect(languages).toEqual([
      { code: 'EN-US', name: 'English' },
      { code: 'morse', name: 'Morse' },
    ])
  })
  test('Microsoft HTML transport and Google Cloud entities preserve plain text', async () => {
    const ms = service((_url, init) => {
      expect(JSON.parse(String(init.body))).toEqual(['&lt;a&gt; &amp;<br>Hello'])
      return json([{ translations: [{ text: '&lt;a&gt; &amp;<br>Bonjour' }] }])
    })
    expect(
      (await ms.translate({ text: '<a> &\nHello', provider: 'microsoft-free' }, settings())).text,
    ).toBe('<a> &\nBonjour')
    const google = service(() =>
      json({ data: { translations: [{ translatedText: '<tag> &amp;' }] } }),
    )
    expect(
      (await google.translate({ text: 'test', provider: 'google-cloud' }, settings())).text,
    ).toBe('<tag> &')
  })
  test('provider rejection redacts key and never substitutes original text', async () => {
    const engine = service(() => json({ error: { message: 'bad secret:fx and secret%3Afx' } }, 403))
    try {
      await engine.translate({ text: 'Hello', provider: 'deepl' }, settings())
      throw new Error('Expected rejection')
    } catch (error) {
      expect(String(error)).toContain('[redacted]')
      expect(String(error)).not.toContain('secret')
    }
    await expect(service(() => json({})).translate({ text: 'Hello' }, settings())).rejects.toThrow(
      'no translated text',
    )
  })
  test('transient errors retry once; permanent failures do not', async () => {
    let attempts = 0
    const engine = service(() =>
      ++attempts === 1 ? json({ error: 'busy' }, 429) : json([[['done']]]),
    )
    expect((await engine.translate({ text: 'hello' }, settings())).text).toBe('done')
    expect(attempts).toBe(2)
  })
})

describe('translation safety and local commands', () => {
  test('protects exact emotes, mentions and URLs; rejects missing markers', () => {
    const protectedText = protectTranslationText('hello Kappa @alice https://a.test/x TWIRKEEP', [
      'Kappa',
    ])
    expect(protectedText.text).not.toContain('@alice')
    expect(protectedText.restore(protectedText.text.replace('hello', 'bonjour'))).toBe(
      'bonjour Kappa @alice https://a.test/x TWIRKEEP',
    )
    expect(() => protectedText.restore('bonjour')).toThrow('protected emote')
  })
  test('Morse confidence, explicit decode, encoding and protected mentions', async () => {
    expect(decodeMorseText('...---...')).toBe('SOS')
    expect(decodeMorseText('... ...')).toBeNull()
    expect(decodeMorseText('... ...', true)).toBe('SS')
    expect(decodeMorseText('···· · ·−·· ·−·· −−− / ·−− −−− ·−· ·−·· −··')).toBe('HELLO WORLD')
    expect(encodeMorseText('Hello world')).toBe('.... . .-.. .-.. --- / .-- --- .-. .-.. -..')
    const engine = service(() => {
      throw new Error('Morse must not request network')
    })
    const decoded = await engine.translate(
      { text: '.... . .-.. .-.. --- / @alice', targetLanguage: 'en' },
      settings(),
    )
    expect(decoded.text).toBe('HELLO @alice')
    expect(decoded.decodedMorse).toBe(true)
    expect(
      (await engine.translate({ text: 'SOS @alice', targetLanguage: 'morse' }, settings())).text,
    ).toBe('... --- ... @alice')
    await expect(
      engine.translate({ text: 'no code', sourceLanguage: 'morse' }, settings()),
    ).rejects.toThrow('valid Morse')
  })
  test('strict settings validation and per-channel override', () => {
    expect(normalizeTranslationLanguage('French')).toBe('fr')
    expect(() => normalizeTranslationLanguage('auto')).toThrow()
    expect(translationEndpoint('http://localhost:5000/translate', true)).toBe(
      'http://localhost:5000',
    )
    expect(() => translationEndpoint('http://example.com', true)).toThrow()
    const config = validateTranslationSettings({
      ...settings(),
      secret: 'never save',
      channels: [
        {
          platform: 'twitch',
          channelId: 'Alice',
          outgoingMode: 'preview',
          targetLanguage: 'de',
          incoming: true,
        },
      ],
    })
    expect(config).not.toHaveProperty('secret')
    expect(resolveChannelTranslation(config, 'twitch', 'alice')).toMatchObject({
      targetLanguage: 'de',
      outgoingMode: 'preview',
      incoming: true,
    })
  })
  test('translation commands match upstream preview/send semantics', () => {
    expect(parseTranslationCommand('/translate hello')).toEqual({ mode: 'preview', text: 'hello' })
    expect(parseTranslationCommand('/translateto French hello')).toEqual({
      mode: 'preview',
      text: 'hello',
      targetLanguage: 'fr',
    })
    expect(parseTranslationCommand('/tl de hello')).toEqual({
      mode: 'send',
      text: 'hello',
      targetLanguage: 'de',
    })
    expect(() => parseTranslationCommand('/tl')).toThrow('Usage')
    expect(parseTranslationCommand('/timeout user')).toBeNull()
  })
  test('parses auto-translation language and off without consuming neighboring commands', () => {
    expect(parseAutoTranslationCommand(' /TranslateAuto English ')).toEqual({
      targetLanguage: 'en',
    })
    expect(parseAutoTranslationCommand('/translateauto zh_CN')).toEqual({ targetLanguage: 'zh-CN' })
    expect(parseAutoTranslationCommand('/translateauto OFF')).toEqual({ targetLanguage: null })
    expect(parseAutoTranslationCommand('/translateautoextra en')).toBeNull()
    expect(() => parseAutoTranslationCommand('/translateauto')).toThrow('Usage')
    expect(() => parseAutoTranslationCommand('/translateauto en extra')).toThrow('language code')
  })
  test('private shorthand never falls through to public dispatch', () => {
    expect(normalizePrivateCommand('.w @alice hi', null)).toEqual({
      recipient: 'alice',
      text: '/w alice hi',
    })
    expect(normalizePrivateCommand('/r hey', 'alice')).toEqual({
      recipient: 'alice',
      text: '/w alice hey',
    })
    expect(normalizePrivateCommand('/$ ping', null)?.text).toBe('/w supibot $ping')
    expect(normalizePrivateCommand('/_ping', null)?.text).toBe('/w mm_sutilitybot _ping')
    for (const command of ['/w', '.w user', '/r hi', '/$', '/_', '/w bad-user hi'])
      expect(() => normalizePrivateCommand(command, null)).toThrow()
    expect(normalizePrivateCommand('normal message', null)).toBeNull()
  })
})

describe('translation cache and concurrency', () => {
  test('coalesces inflight requests, expires cache and bounds concurrency', async () => {
    let time = 0
    let calls = 0
    let active = 0
    let peak = 0
    const engine = service(
      async () => {
        calls++
        active++
        peak = Math.max(active, peak)
        await Bun.sleep(5)
        active--
        return json([[['done']]])
      },
      { now: () => time, cacheTtlMs: 10, maxConcurrent: 2 },
    )
    await Promise.all(
      Array.from({ length: 5 }, () => engine.translate({ text: 'same' }, settings())),
    )
    expect(calls).toBe(1)
    await engine.translate({ text: 'same' }, settings())
    expect(calls).toBe(1)
    time = 11
    await engine.translate({ text: 'same' }, settings())
    expect(calls).toBe(2)
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        engine.translate({ text: `different ${index}` }, settings()),
      ),
    )
    expect(peak).toBe(2)
    engine.clearCache()
    await engine.translate({ text: 'same' }, settings())
    expect(calls).toBe(11)
  })
  test('queue refuses excess work and failed requests can be retried', async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    const engine = service(
      async () => {
        await gate
        return json([[['done']]])
      },
      { maxConcurrent: 1, maxQueued: 1 },
    )
    const first = engine.translate({ text: 'first' }, settings())
    const second = engine.translate({ text: 'second' }, settings())
    await expect(engine.translate({ text: 'third' }, settings())).rejects.toThrow('busy')
    release()
    await Promise.all([first, second])
    expect((await engine.translate({ text: 'third' }, settings())).text).toBe('done')
  })
})
