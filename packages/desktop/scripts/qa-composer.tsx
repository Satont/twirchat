if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const require = createRequire(new URL('../package.json', import.meta.url))
const React = await import(require.resolve('react'))
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import(
  require.resolve('@gpuix/react')
)
const { BackendContext } = await import('../src/gpuix/backend/context')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { ChatInput } = await import('../src/gpuix/components/ChatInput')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { DEFAULT_TRANSLATION_SETTINGS } = await import('../src/services/translation')
const { DEFAULT_IMAGE_UPLOADER_SETTINGS, readClipboardUploadFile, uploadClipboardImage } =
  await import('../src/services/image-uploader')
const { applyImageUploaderSettings, imageUploaderSettingsStore } =
  await import('../src/gpuix/state/image-uploader')
const { composerStore, EMPTY_COMPOSER, editComposer, updateComposer } =
  await import('../src/gpuix/state/composer')
const { actionBindingsStore, dispatchCustomHotkey } =
  await import('../src/gpuix/state/action-bindings')
const { applyTranslationSettings } = await import('../src/gpuix/state/translation')
const emoteCompletionOnly = process.argv.includes('--emote-completion')
const sent = []
const copied = []
const translations = []
let runner = null
let cancelledReply = 0
let failTranslation = false
let releaseTranslation = null
let holdTranslation = false
let imageSettings = { ...DEFAULT_IMAGE_UPLOADER_SETTINGS }
const backend = {
  events: createDesktopEvents(),
  api: {
    getUiState: async () => null,
    getTranslationSettings: async () => ({
      settings: structuredClone(DEFAULT_TRANSLATION_SETTINGS),
      credentials: [],
    }),
    getChannelEmotes: async () => [],
    getPotatCommands: async () => [],
    getImageUploaderSettings: async () => ({ ...imageSettings }),
    saveImageUploaderSettings: async (settings) => {
      imageSettings = { ...settings }
      return imageSettings
    },
    readClipboardUploadFile,
    uploadClipboardImage: (request) => {
      assert(request.image.bytes instanceof Uint8Array, JSON.stringify(Object.keys(request.image)))
      return uploadClipboardImage(request)
    },
    copyText: async ({ text }) => {
      copied.push(text)
    },
    translateText: async ({ text, sourceLanguage, targetLanguage }) => {
      translations.push({ text, sourceLanguage, targetLanguage })
      if (holdTranslation)
        await new Promise((resolve) => {
          releaseTranslation = resolve
        })
      if (failTranslation) throw new Error('QA translation unavailable')
      return {
        text: `translated:${text}`,
        targetLanguage: targetLanguage ?? 'en',
        sourceLanguage: 'en',
        provider: 'google-free',
      }
    },
  },
}
let key = 'qa:composer'
composerStore.set(
  new Map([
    [
      key,
      { ...EMPTY_COMPOSER, history: ['hello one', 'other', 'HELLO two'], text: 'unsent draft' },
    ],
  ]),
)
const renderer = createRenderer()
const compact = process.argv.includes('--compact')
renderer.init({
  title: 'TwirChat composer QA',
  appId: process.env.TWIRCHAT_QA_APP_ID,
  focus: false,
  width: compact ? 480 : 900,
  height: compact ? 480 : 780,
})
renderer.activateWindow()
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)
root.render(
  React.createElement(
    BackendContext.Provider,
    { value: backend },
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(
        'div',
        {
          style: {
            width: '100%',
            height: '100%',
            flexDirection: 'column',
            backgroundColor: '#111114',
          },
        },
        React.createElement(ChatInput, {
          accounts: emoteCompletionOnly
            ? [
                {
                  id: 'qa-account',
                  platform: 'twitch',
                  platformUserId: 'qa-user',
                  username: 'qa',
                  displayName: 'QA',
                  scopes: [],
                  createdAt: 0,
                  updatedAt: 0,
                },
              ]
            : [],
          settings: DEFAULT_SETTINGS,
          statuses: {},
          composerKey: key,
          watchedChannel: {
            id: 'qa',
            platform: 'twitch',
            channelSlug: 'alpha',
            displayName: 'Alpha',
          },
          watchedChannelStatus: { platform: 'twitch', status: 'connected', mode: 'authenticated' },
          onSend: (targets) => sent.push(...targets),
          onSendWatched: (target) => sent.push(target),
          onCopyMessages: () => copied.push('chat transcript'),
          onOpenUserCard: () => {},
          onCancelReply: () => {
            cancelledReply++
          },
          replyTarget: {
            id: 'reply',
            platform: 'twitch',
            author: { displayName: 'Reply Author' },
            text: 'replying',
          },
          onCommandRunnerReady: (next) => {
            runner = next
          },
        }),
      ),
    ),
  ),
)
function flatten(node = JSON.parse(renderer.getAutomationTree())) {
  return [node, ...(node.children ?? []).flatMap((child) => flatten(child))]
}
function find(id) {
  const node = lookup(id)
  assert(node, `Missing ${id}`)
  return node
}
function lookup(id) {
  return flatten().find((node) => node.testId === id)
}
async function until(check, label) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
async function focus() {
  renderer.focusElement(find('chat-input').id)
  await until(() => renderer.getFocusedElementId() === find('chat-input').id, 'composer focus')
  await Bun.sleep(40)
}
async function draft(value) {
  updateComposer(key, (state) => editComposer(state, value))
  await Bun.sleep(50)
}
const state = () => composerStore.get().get(key)
async function fire(action, args = []) {
  actionBindingsStore.update({
    value: {
      legacyNavigation: true,
      bindings: [
        {
          id: 'qa',
          name: 'QA',
          enabled: true,
          category: 'splitInput',
          action,
          arguments: args,
          keys: ['ctrl+f12'],
        },
      ],
    },
  })
  let prevented = false
  const handled = dispatchCustomHotkey({
    key: 'f12',
    modifiers: { ctrl: true },
    get defaultPrevented() {
      return prevented
    },
    preventDefault: () => {
      prevented = true
    },
    stopPropagation: () => {},
  })
  assert(handled, `Shortcut not routed: ${action}`)
  await Bun.sleep(80)
}
async function click(id) {
  const bounds = renderer.getElementBounds(find(id).id)
  assert(bounds, `No painted bounds for ${id}`)
  renderer.simulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)
  await Bun.sleep(100)
}
function configureTranslation(outgoingMode) {
  applyTranslationSettings({
    settings: {
      ...structuredClone(DEFAULT_TRANSLATION_SETTINGS),
      outgoingMode,
      sourceLanguage: 'de',
      targetLanguage: 'fr',
    },
    credentials: [],
  })
}

function pressNativeKeys(...keys) {
  const result = Bun.spawnSync(['/usr/bin/xdotool', 'key', '--clearmodifiers', ...keys], {
    timeout: 3000,
  })
  assert.equal(result.exitCode, 0, result.stderr.toString())
}

const has = (id) => flatten().some((node) => node.testId === id)

async function checkImageUpload(clipboardTool) {
  const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
  const sharp = (await import('sharp')).default
  const png = await sharp({
    create: { width: 160, height: 96, channels: 3, background: '#7c4dff' },
  })
    .png()
    .toBuffer()
  const imageUrl = 'https://images.example/qa.png'
  const deletionUrl = 'https://images.example/delete/qa'
  let requests = 0
  let requestError = null
  let release = null
  let hold = false
  let clipboard = null
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      try {
        requests++
        assert.equal(request.method, 'POST')
        assert.equal(request.headers.get('Authorization'), 'Bearer qa:token')
        const file = (await request.formData()).get('upload')
        assert(file instanceof File)
        assert.equal(file.name, 'control_v.png')
        assert.equal(file.type, 'image/png')
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), png)
        if (requests === 1) return new Response(null, { status: 503 })
        if (hold)
          await new Promise((resolve) => {
            release = resolve
          })
        return Response.json({ data: [{ url: imageUrl, deletionUrl }] })
      } catch (error) {
        requestError = error
        return new Response(null, { status: 500 })
      }
    },
  })
  async function ownClipboard(mime, bytes) {
    clipboard?.kill()
    clipboard = Bun.spawn([clipboardTool, '-quiet', '-selection', 'clipboard', '-target', mime], {
      stdin: bytes,
      stdout: 'ignore',
      stderr: 'ignore',
    })
    await Bun.sleep(90)
    assert(clipboard.exitCode === null, 'private X11 clipboard owner exited')
  }
  const sendCount = sent.length
  const replyCount = cancelledReply
  try {
    await until(() => imageUploaderSettingsStore.get() !== null, 'initial image settings')
    await draft('alpha beta')
    await focus()
    await ownClipboard('image/png', png)
    pressNativeKeys('ctrl+v')
    await Bun.sleep(150)
    assert.equal(state().text, 'alpha beta')
    assert.equal(requests, 0)
    assert(!has('composer-image-confirm'), 'disabled uploader ignores an image paste')

    imageSettings = {
      enabled: true,
      confirm: true,
      requestUrl: server.url.href,
      formField: 'upload',
      headers: 'Authorization: Bearer qa:token',
      imageLink: '{data.0.url}',
      deletionLink: '{data.0.deletionUrl}',
    }
    applyImageUploaderSettings(imageSettings)
    await Bun.sleep(120)
    await ownClipboard('UTF8_STRING', Buffer.from('text paste'))
    pressNativeKeys('ctrl+a', 'ctrl+v')
    await until(() => state().text === 'text paste', 'native text paste with uploader enabled')
    await draft('alpha beta')
    await ownClipboard('image/png', png)
    pressNativeKeys('ctrl+v')
    await until(
      () => has('composer-image-confirm') || has('composer-image-failed'),
      'clipboard image confirmation',
    )
    await captureGuiQaDisplay('composer-image-confirm')
    assert(has('composer-image-confirm'), renderer.getAllText().join(' '))
    assert(renderer.getElementBounds(find('composer-image-preview').id)?.width > 0)
    await click('composer-image-cancel')
    await until(() => !has('composer-image-confirm'), 'dismiss confirmation')
    assert.equal(requests, 0, 'cancel before confirmation makes no request')

    await fire('paste')
    await until(() => has('composer-image-confirm'), 'second image confirmation')
    await click('composer-image-upload')
    await until(() => has('composer-image-retry'), 'HTTP error is retryable')
    assert.equal(state().text, 'alpha beta')
    assert.equal(requests, 1, renderer.getAllText().join(' '))
    hold = true
    await click('composer-image-retry')
    await until(() => release !== null, 'retry waiting for the upload host')
    await focus()
    pressNativeKeys('End', 'Left', 'Left', 'Left', 'Left', 'x')
    await until(() => state().text === 'alpha xbeta', 'native typing while request is in flight')
    release()
    await until(() => state().text === `alpha x${imageUrl} beta`, 'URL inserted at current caret')
    await until(() => has('composer-image-complete'), 'upload completion shown')
    await click('composer-image-copy-deletion')
    assert.equal(copied.at(-1), deletionUrl)
    await click('composer-image-cancel')
    await focus()
    pressNativeKeys('ctrl+z')
    await until(() => state().text === 'alpha xbeta', 'native undo restores the edited draft')

    await renderer.setWindowBounds({ width: 510, height: 500 })
    await focus()
    hold = false
    pressNativeKeys('ctrl+v')
    await until(() => has('composer-image-confirm'), 'narrow composer confirmation')
    const bounds = renderer.getElementBounds(find('composer-image-upload-remember').id)
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 510, 'buttons fit narrow composer')
    await click('composer-image-upload-remember')
    await until(() => has('composer-image-complete'), 'confirm and persist preference')
    assert.equal(imageSettings.confirm, false)
    await click('composer-image-cancel')
    hold = true
    release = null
    await focus()
    const beforeCancel = state().text
    pressNativeKeys('ctrl+v')
    await until(() => release !== null, 'next upload starts without confirmation')
    await click('composer-image-cancel')
    release()
    await Bun.sleep(150)
    assert.equal(state().text, beforeCancel, 'aborted upload does not alter the draft')

    hold = false
    const filePath = join(process.env.TWIRCHAT_QA_SESSION_DIR, 'clipboard screenshot.png')
    await Bun.write(filePath, png)
    await ownClipboard('text/uri-list', Buffer.from(`${pathToFileURL(filePath).href}\r\n`))
    await draft('copied file: ')
    await focus()
    pressNativeKeys('End', 'ctrl+v')
    await until(() => state().text === `copied file: ${imageUrl} `, 'copied file uploads')
    assert.equal(sent.length, sendCount, 'upload never sends a message')
    assert.equal(cancelledReply, replyCount, 'upload preserves reply state')
    assert.equal(requestError, null)
    assert.equal(requests, 5)
    console.log(JSON.stringify({ imageUpload: 'pass', requests, nativePaste: true }))
  } finally {
    release?.()
    await server.stop(true)
    clipboard?.kill()
    imageSettings = { ...DEFAULT_IMAGE_UPLOADER_SETTINGS }
    applyImageUploaderSettings(imageSettings)
    await renderer.setWindowBounds({ width: 900, height: 780 })
  }
}

async function checkEmoteCompletion() {
  const { setEmoteCatalog } = await import('../src/gpuix/state/app')
  setEmoteCatalog(
    'twitch',
    'alpha',
    [...Array.from({ length: 30 }, (_, index) => `Pa${index}alert`), 'Paa'].map((alias, index) => ({
      id: alias === 'Paa' ? '01K40MN29C0T969488KVHEY4FA' : `qa-seventv-${index}`,
      alias,
      name: alias,
      zeroWidth: false,
      aspectRatio: 1,
      source: 'seventv',
      provider: 'seventv',
      imageUrl: 'https://cdn.7tv.app/emote/01K40MN29C0T969488KVHEY4FA/1x.webp',
      animated: false,
    })),
  )
  await draft('')
  await focus()
  pressNativeKeys('h', 'i', 'space', 'colon', 'P', 'a', 'a')
  await until(
    () => state().text === 'hi :Paa' && has('autocomplete-selected'),
    'colon emote completion opens',
  )
  assert(JSON.stringify(find('autocomplete-selected')).includes('Paa'), 'exact alias ranks first')
  pressNativeKeys('Tab')
  await until(() => state().text === 'hi Paa ', 'colon Tab replaces token and keeps earlier text')
  await draft('')
  pressNativeKeys('h', 'i', 'space', 'p', 'a', 'a')
  await until(() => state().text === 'hi paa', 'native bare query typed')
  assert(!has('autocomplete-popup'), 'bare typing does not open a popup')
  pressNativeKeys('Tab')
  await until(() => state().text === 'hi Paa ', 'bare Tab restores alias casing')
  await draft('Paa')
  const before = sent.length
  pressNativeKeys('Return')
  await until(() => sent.length === before + 1, 'bare Enter sends without completing')
  assert.equal(sent.at(-1).text, 'Paa')
  await draft('zzzzNoEmoteMatch')
  await focus()
  pressNativeKeys('Tab')
  await Bun.sleep(100)
  assert.equal(state().text, 'zzzzNoEmoteMatch', 'unmatched Tab leaves text intact')
  assert(!has('autocomplete-popup'))
  console.log(JSON.stringify({ result: 'pass', emoteCompletion: true, compact }))
}

async function checkComposer() {
  await fire('previousMessage')
  assert.equal(state().text, 'HELLO two')
  await fire('nextMessage')
  assert.equal(state().text, 'unsent draft')
  await fire('incremental-search-history', ['backward', 'loop'])
  const search = find('composer-history-query')
  await until(() => renderer.getFocusedElementId() === search.id, 'history search focus')
  renderer.simulateKeystrokes('h e l l o')
  await until(() => state().text === 'HELLO two', 'live case-insensitive history search')
  await fire('incremental-search-history', ['backward', 'loop'])
  assert.equal(state().text, 'hello one')
  await fire('incremental-search-history', ['backward', 'loop'])
  assert.equal(state().text, 'HELLO two')
  await fire('incremental-search-history', ['backward', 'noloop'])
  assert.equal(state().text, 'hello one')
  await fire('incremental-search-history', ['backward', 'noloop'])
  assert(renderer.getAllText().join(' ').includes('No match'))
  renderer.simulateKeystrokes('escape')
  await focus()
  await fire('cancelReply')
  assert(cancelledReply > 0)
  await draft('alpha beta')
  await fire('copy', ['auto'])
  assert.equal(copied.at(-1), 'chat transcript')
  await fire('selectAll')
  const copiedCount = copied.length
  await fire('copy', ['splitInput'])
  assert.equal(copied.length, copiedCount)
  await fire('clear')
  assert.equal(state().text, '')
  await fire('paste')
  await until(() => state().text === 'alpha beta', 'native clipboard paste')
  await fire('cursorToStart', ['withoutSelection'])
  await fire('cursorToEnd', ['withSelection'])
  await fire('selectWord')
  await fire('undo')
  await fire('redo')
  await fire('copy', ['split'])
  assert.equal(copied.at(-1), 'chat transcript')
  await draft('keep this')
  await fire('sendMessage', ['keepInput'])
  await until(() => sent.at(-1)?.text === 'keep this', 'keepInput sends')
  assert.equal(state().text, 'keep this')
  await runner('runner message')
  assert.equal(sent.at(-1).text, 'runner message')
  assert.equal(state().text, 'keep this')
  await runner('/copy')
  assert.equal(state().text, 'keep this')

  await draft('native Enter sends once')
  await focus()
  const beforeEnter = sent.length
  renderer.simulateKeystrokes('enter')
  await until(() => sent.length === beforeEnter + 1, 'native Enter submits')
  await Bun.sleep(100)
  assert.equal(sent.length, beforeEnter + 1, 'native Enter sends exactly once')
  assert.equal(sent.at(-1).text, 'native Enter sends once')
  assert.equal(state().text, '', 'native Enter clears the sent draft')
  assert(has('send-button'), 'composer exposes a Send button')
  await draft('button sends once')
  const beforeButton = sent.length
  await Bun.sleep(80)
  await click('send-button')
  await until(() => sent.length === beforeButton + 1, 'Send button submits')
  assert.equal(sent.at(-1).text, 'button sends once')
  assert.equal(state().text, '', 'Send button clears the sent draft')

  configureTranslation('preview')
  await draft('preview draft')
  const beforePreview = sent.length
  await fire('sendMessage', ['keepInput'])
  assert.equal(sent.length, beforePreview)
  await until(
    () => flatten().some((node) => node.testId === 'send-translated-message'),
    'translation confirmation',
  )
  await click('send-translated-message')
  await until(() => sent.length === beforePreview + 1, 'confirmed translation sends')
  assert.equal(sent.at(-1).text, 'translated:preview draft')
  assert.equal(state().text, 'preview draft')

  await focus()
  failTranslation = true
  await draft('retry keeps this draft')
  await fire('sendMessage', ['keepInput'])
  await until(
    () => flatten().some((node) => node.testId === 'retry-translated-message'),
    'failed translation exposes retry',
  )
  assert.equal(state().text, 'retry keeps this draft')
  failTranslation = false
  await click('retry-translated-message')
  await until(
    () => flatten().some((node) => node.testId === 'send-translated-message'),
    'retry still requires confirmation',
  )
  await click('send-translated-message')
  await until(
    () => sent.at(-1)?.text === 'translated:retry keeps this draft',
    'retried translation sent',
  )
  assert.equal(
    state().text,
    'retry keeps this draft',
    'retry and confirmation preserve original keepInput intent',
  )
  await focus()
  configureTranslation('send')
  holdTranslation = true
  await draft('queued submission')
  await fire('sendMessage', ['keepInput'])
  await until(() => !!releaseTranslation, 'async translation in flight')
  await draft('newer unsent draft')
  holdTranslation = false
  releaseTranslation()
  await until(() => sent.at(-1)?.text === 'translated:queued submission', 'async submission sent')
  assert.equal(state().text, 'newer unsent draft')
  failTranslation = true
  await assert.rejects(runner('failing command'), /QA translation unavailable/)
  assert.equal(state().text, 'newer unsent draft')
  failTranslation = false
  await fire('toggleTranslateOnSend')
  assert.equal(state().translateOnSend, false)
  await fire('sendMessage', ['keepInput'])
  assert.equal(sent.at(-1).text, 'newer unsent draft')
  await fire('toggleTranslateOnSend')
  assert.equal(state().translateOnSend, true)
  await fire('openEmotesPopup')
  await until(() => renderer.getAllText().join(' ').includes('No emotes'), 'emote picker opens')
  renderer.simulateKeystrokes('escape')
  await Bun.sleep(100)
  const clipboardArg = process.argv.find((arg) => arg.startsWith('--xclip='))
  if (clipboardArg) await checkImageUpload(clipboardArg.slice('--xclip='.length))
  renderer.blur()
  await Bun.sleep(80)
  const textBeforeBlur = state().text
  const handledWhileBlurred = dispatchCustomHotkey({
    key: 'f12',
    modifiers: { ctrl: true },
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
  })
  assert.equal(handledWhileBlurred, false, 'composer route only exists while an editor is focused')
  assert.equal(state().text, textBeforeBlur)
  configureTranslation('preview')
  updateComposer(key, (current) => ({ ...current, translateOnSend: undefined }))
  await draft('/translateaut')
  await focus()
  await until(
    () => renderer.getAllText().includes('/translateauto'),
    'auto translation command autocomplete',
  )
  await draft('/translateauto en')
  const beforeAuto = sent.length
  const beforeAutoRequests = translations.length
  renderer.simulateKeystrokes('enter')
  await until(() => lookup('auto-translation-status') && !state().text, 'auto translation enabled')
  assert.equal(sent.length, beforeAuto, 'enabling auto translation is local')
  assert.equal(translations.length, beforeAutoRequests, 'enabling does not call the provider')
  assert(!state().history.includes('/translateauto en'))
  const statusBounds = renderer.getElementBounds(find('auto-translation-status').id)
  const editorBounds = renderer.getElementBounds(find('chat-input').id)
  assert(statusBounds && editorBounds && statusBounds.y + statusBounds.height <= editorBounds.y)

  await draft('Привет!')
  renderer.simulateKeystrokes('enter')
  await until(() => sent.length === beforeAuto + 1, 'auto translation sends without preview')
  assert.deepEqual(translations.at(-1), {
    text: 'Привет!',
    sourceLanguage: 'auto',
    targetLanguage: 'en',
  })
  assert.equal(sent.at(-1).text, 'translated:Привет!')
  assert.equal(sent.at(-1).replyToMessageId, 'reply')

  await draft('an unsent draft')
  failTranslation = true
  await assert.rejects(runner('an unsent draft'), /QA translation unavailable/)
  assert.equal(sent.length, beforeAuto + 1)
  assert.equal(state().text, 'an unsent draft')
  failTranslation = false

  await click('auto-translation-off')
  await until(() => !lookup('auto-translation-status'), 'Turn off disables auto translation')
  assert.equal(state().text, 'an unsent draft')
  await assert.rejects(runner('an unsent draft'), /Review the translation preview/)
  assert.deepEqual(translations.at(-1), {
    text: 'an unsent draft',
    sourceLanguage: 'de',
    targetLanguage: 'fr',
  })
  assert.equal(sent.length, beforeAuto + 1, 'turning off restores the configured preview')
  await runner('/translateauto en')
  configureTranslation('off')
  key = 'qa:home-composer'
  let contextPlatform = 'twitch'
  const homeAccounts = ['twitch', 'kick'].map((platform) => ({
    id: platform,
    platform,
    platformUserId: platform,
    username: platform === 'twitch' ? 'alpha' : 'kicker',
    displayName: platform,
    connectedAt: 1,
    accessToken: 'qa-unused',
  }))
  function mountHome() {
    root.render(
      React.createElement(
        BackendContext.Provider,
        { value: backend },
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(
            'div',
            { style: { width: '100%', height: '100%', flexDirection: 'column' } },
            React.createElement(ChatInput, {
              accounts: homeAccounts,
              settings: DEFAULT_SETTINGS,
              statuses: {
                twitch: {
                  platform: 'twitch',
                  channelLogin: 'alpha',
                  status: 'connected',
                  mode: 'authenticated',
                },
                kick: {
                  platform: 'kick',
                  channelLogin: 'kicker',
                  status: 'connected',
                  mode: 'authenticated',
                },
              },
              activePlatform: contextPlatform ?? undefined,
              onActivePlatformChange: (platform) => {
                contextPlatform = platform
                mountHome()
              },
              composerKey: key,
              onSend: (targets) => sent.push(...targets),
              onSendWatched: () => {
                throw new Error('Unexpected watched send')
              },
              onOpenUserCard: () => {},
              onCancelReply: () => {},
              onCommandRunnerReady: (next) => {
                runner = next
              },
            }),
          ),
        ),
      ),
    )
  }
  mountHome()
  await Bun.sleep(100)
  await focus()
  await until(() => lookup('auto-translation-status'), 'same channel in a different composer')
  await draft('twitch context')
  let beforeContext = sent.length
  await fire('sendMessage', ['keepInput'])
  assert.equal(sent.length, beforeContext + 1)
  assert.equal(sent.at(-1).platform, 'twitch')
  assert.equal(sent.at(-1).text, 'translated:twitch context')
  const chip = find('composer-target-twitch')
  assert(chip, 'home platform control visible')
  const chipBounds = renderer.getElementBounds(chip.id)
  renderer.simulateClick(
    chipBounds.x + chipBounds.width / 2,
    chipBounds.y + chipBounds.height / 2,
    0,
  )
  await Bun.sleep(100)
  assert.equal(contextPlatform, null, 'clicking a chip clears the context override')
  await focus()
  await assert.rejects(runner('/translateauto off'), /Select one/)
  await draft('both contexts')
  beforeContext = sent.length
  await fire('sendMessage', ['keepInput'])
  assert.deepEqual(
    sent
      .slice(beforeContext)
      .map(({ platform, text }) => [platform, text])
      .sort(([left], [right]) => left.localeCompare(right)),
    [
      ['kick', 'both contexts'],
      ['twitch', 'translated:both contexts'],
    ],
  )
  contextPlatform = 'kick'
  mountHome()
  await Bun.sleep(100)
  await runner('kick context command')
  assert.equal(sent.at(-1).platform, 'kick')
  assert.equal(sent.at(-1).text, 'kick context command')
  assert(!lookup('auto-translation-status'), 'another channel has no auto translation')
  contextPlatform = 'twitch'
  mountHome()
  await until(() => lookup('auto-translation-status'), 'returning to an enabled channel')
  await draft('/translateauto OFF')
  await focus()
  const beforeOff = sent.length
  renderer.simulateKeystrokes('enter')
  await until(
    () => !lookup('auto-translation-status') && !state().text,
    'auto translation disabled',
  )
  assert.equal(sent.length, beforeOff, 'disabling auto translation is local')
  await runner('normal after off')
  assert.equal(sent.at(-1).text, 'normal after off')
  contextPlatform = 'youtube'
  mountHome()
  await Bun.sleep(100)
  beforeContext = sent.length
  await assert.rejects(runner('unavailable selected platform'), /Connect|Select/)
  assert.equal(
    sent.length,
    beforeContext,
    'unavailable context cannot fall through to another account',
  )
  console.log(
    JSON.stringify({
      result: 'pass',
      actions: 16,
      historySearch: true,
      nativeEditing: true,
      keepInput: true,
      translationPreview: true,
      channelAutoTranslation: true,
      asyncDraftSafety: true,
      commandRunner: true,
      focusedRouting: true,
    }),
  )
}

try {
  await (await import('./qa-x11')).focusNativeQaWindow('TwirChat composer QA')
  await until(
    () => !!runner && flatten().some((node) => node.testId === 'chat-input'),
    'composer mount',
  )
  await focus()
  if (emoteCompletionOnly) await checkEmoteCompletion()
  else await checkComposer()
} finally {
  root.unmount()
  loop.stop()
  renderer.closeWindow()
}
process.exit(0)
