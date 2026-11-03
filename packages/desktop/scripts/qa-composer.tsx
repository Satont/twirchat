if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
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
const { composerStore, EMPTY_COMPOSER, editComposer, updateComposer } =
  await import('../src/gpuix/state/composer')
const { actionBindingsStore, dispatchCustomHotkey } =
  await import('../src/gpuix/state/action-bindings')
const { applyTranslationSettings } = await import('../src/gpuix/state/translation')
const sent = []
const copied = []
let runner = null
let cancelledReply = 0
let failTranslation = false
let releaseTranslation = null
let holdTranslation = false
const backend = {
  events: createDesktopEvents(),
  api: {
    getUiState: async () => null,
    getTranslationSettings: async () => ({
      settings: structuredClone(DEFAULT_TRANSLATION_SETTINGS),
      credentials: [],
    }),
    getChannelEmotes: async () => [],
    copyText: async ({ text }) => {
      copied.push(text)
    },
    translateText: async ({ text, targetLanguage }) => {
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
const key = 'qa:composer'
composerStore.set(
  new Map([
    [
      key,
      { ...EMPTY_COMPOSER, history: ['hello one', 'other', 'HELLO two'], text: 'unsent draft' },
    ],
  ]),
)
const renderer = createRenderer()
renderer.init({
  title: 'TwirChat composer QA',
  appId: process.env.TWIRCHAT_QA_APP_ID,
  focus: false,
  width: 900,
  height: 780,
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
          accounts: [],
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
  const node = flatten().find((node) => node.testId === id)
  assert(node, `Missing ${id}`)
  return node
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
    settings: { ...structuredClone(DEFAULT_TRANSLATION_SETTINGS), outgoingMode },
    credentials: [],
  })
}
try {
  await (await import('./qa-x11')).focusNativeQaWindow('TwirChat composer QA')
  await until(
    () => !!runner && flatten().some((node) => node.testId === 'chat-input'),
    'composer mount',
  )
  await focus()
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
  assert(!flatten().some((node) => node.testId === 'send-button'), 'no separate Send button')

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
  configureTranslation('off')
  updateComposer(key, (current) => ({ ...current, translateOnSend: false }))
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
  await draft('twitch context')
  let beforeContext = sent.length
  await fire('sendMessage', ['keepInput'])
  assert.equal(sent.length, beforeContext + 1)
  assert.equal(sent.at(-1).platform, 'twitch')
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
  await draft('both contexts')
  beforeContext = sent.length
  await fire('sendMessage', ['keepInput'])
  assert.deepEqual(
    sent
      .slice(beforeContext)
      .map((target) => target.platform)
      .sort((left, right) => left.localeCompare(right)),
    ['kick', 'twitch'],
  )
  contextPlatform = 'kick'
  mountHome()
  await Bun.sleep(100)
  await runner('kick context command')
  assert.equal(sent.at(-1).platform, 'kick')
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
      asyncDraftSafety: true,
      commandRunner: true,
      focusedRouting: true,
    }),
  )
} finally {
  root.unmount()
  loop.stop()
  renderer.closeWindow()
}
process.exit(0)
