import assert from 'node:assert/strict'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import('@gpuix/react')
const { BackendContext } = await import('../src/gpuix/backend/context')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { setLanguage } = await import('../src/gpuix/i18n')
const { settingsStore, wireBackendToStores } = await import('../src/gpuix/state/app')
const { wireTwitchAutoMod } = await import('../src/gpuix/state/twitch-automod')
const { darkTheme } = await import('../src/gpuix/theme')
const { ThemeContext } = await import('../src/gpuix/theme-context')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { DEFAULT_TRANSLATION_SETTINGS } = await import('../src/services/translation')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')

const width = process.argv.includes('--narrow') ? 340 : 650
const fixtureSettings = {
  ...DEFAULT_SETTINGS,
  showAvatars: false,
  showTimestamp: true,
  language: 'en',
} satisfies typeof DEFAULT_SETTINGS
const events = createDesktopEvents()
const commands: string[] = []
let failNext = false
const backend = {
  events,
  api: {
    getSettings: async () => fixtureSettings,
    getAppVersion: async () => 'AutoMod QA',
    getUiState: async () => null,
    setUiState: async () => {},
    getTranslationSettings: async () => ({
      settings: DEFAULT_TRANSLATION_SETTINGS,
      credentials: [],
    }),
    getChannelEmotes: async () => [],
    getModerationCapabilities: async () => ({ canModerate: true }),
    getChannelRoomState: async () => ({ platform: 'twitch', channelId: 'creator' }),
    getTwitchActivities: () => new Promise(() => {}),
    watchTwitchActivities: async () => {},
    executePlatformCommand: async ({ text }: { text: string }) => {
      commands.push(text)
      if (failNext) {
        failNext = false
        throw new Error('Twitch rejected the AutoMod decision.')
      }
      return {}
    },
  },
}
settingsStore.set(fixtureSettings)
setLanguage('en')
const stopStores = wireBackendToStores(backend)
const stopAutoMod = wireTwitchAutoMod(events)
const renderer = createRenderer()
renderer.init({ title: 'TwirChat AutoMod QA', width, height: 720, focus: false })
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)

function nodes(node = JSON.parse(renderer.getAutomationTree())) {
  return node ? [node, ...(node.children ?? []).flatMap((child) => nodes(child))] : []
}
const find = (testId: string) => nodes().find((node) => node.testId === testId)
const paintedText = () => renderer.getPaintedText().join('')
const painted = (text: string) => paintedText().includes(text)
async function until(check: () => unknown, label: string) {
  const deadline = performance.now() + 4000
  while (!check()) {
    assert.ok(performance.now() < deadline, `Timed out: ${label}`)
    // The next attempt needs a fresh native frame.
    // oxlint-disable-next-line no-await-in-loop
    await Bun.sleep(30)
  }
}
async function click(testId: string) {
  await until(() => find(testId), testId)
  const bounds = renderer.getElementBounds(find(testId).id)
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0, testId)
  renderer.simulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)
  await Bun.sleep(100)
}

const start = Date.now() - 60_000
function chat(id: string, text: string, offset: number) {
  const message: NormalizedChatMessage = {
    id,
    platform: 'twitch',
    channelId: 'creator',
    author: { id: `user-${id}`, username: `user${id}`, displayName: `User${id}`, badges: [] },
    text,
    emotes: [],
    type: 'message',
    timestamp: new Date(start + offset),
  }
  events.emit('watched_channel_message', { channelId: 'qa', message })
}
function hold(messageId: string, text: string, offset: number, extra = {}) {
  events.emit('twitch_automod', {
    type: 'hold',
    channelSlug: 'creator',
    messageId,
    displayName: 'u_kool',
    text,
    timestamp: start + offset,
    ...extra,
  })
}

try {
  root.render(
    <BackendContext.Provider value={backend}>
      <TooltipProvider>
        <ThemeContext.Provider value={darkTheme}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              height: '100%',
              backgroundColor: darkTheme.bg,
            }}
          >
            <ChatView
              layoutTabId="qa-tab"
              watchedChannel={{
                id: 'qa',
                platform: 'twitch',
                channelSlug: 'creator',
                displayName: 'Creator',
                createdAt: 0,
              }}
            />
          </div>
        </ThemeContext.Provider>
      </TooltipProvider>
    </BackendContext.Provider>,
  )
  chat('1', 'BEFORE_HOLD', 1000)
  chat('2', 'AFTER_HOLD', 3000)
  await until(() => painted('AFTER_HOLD'), 'chat messages')

  hold('held-1', 'HELD_SWEARING', 2000, { category: 'swearing' })
  await until(() => find('twitch-automod-held-1'), 'inline held message')
  assert.ok(!find('twitch-automod'), 'The panel above the composer is gone')
  const text = paintedText()
  const before = text.indexOf('BEFORE_HOLD')
  const held = text.indexOf('HELD_SWEARING')
  const after = text.indexOf('AFTER_HOLD')
  assert.ok(before >= 0 && before < held && held < after, 'Held message sits in time order')
  assert.ok(painted('Held a message for reason: swearing. Allow will post it in chat.'))
  await captureGuiQaDisplay(`automod-pending-${width}`)

  await click('twitch-automod-approve-held-1')
  await until(() => painted('Allowed'), 'local approval')
  assert.deepEqual(commands, ['/automodallow held-1'])
  assert.ok(!find('twitch-automod-approve-held-1'))
  events.emit('twitch_automod', {
    type: 'resolve',
    channelSlug: 'creator',
    messageId: 'held-1',
    status: 'approved',
    moderatorName: 'ModName',
  })
  await until(() => painted('Allowed by ModName'), 'moderator attribution')

  hold('held-2', 'BLOCKED_TERM_TEXT', 4000, { blockedTerm: true })
  chat('3', 'LIVE_AFTER_HOLD', 5000)
  await until(() => painted('LIVE_AFTER_HOLD') && find('twitch-automod-held-2'), 'live chat')
  assert.ok(painted('Held a message for using channel blocked terms.'))
  failNext = true
  await click('twitch-automod-deny-held-2')
  await until(() => painted('Twitch rejected the AutoMod decision.'), 'retryable error')
  await click('twitch-automod-deny-held-2')
  await until(() => painted('Denied'), 'denied after retry')
  assert.deepEqual(commands, ['/automodallow held-1', '/automoddeny held-2', '/automoddeny held-2'])

  hold('held-3', 'EXPIRES_SOON', 6000)
  await until(() => find('twitch-automod-held-3'), 'third hold')
  events.emit('twitch_automod', {
    type: 'resolve',
    channelSlug: 'creator',
    messageId: 'held-3',
    status: 'expired',
  })
  await until(() => painted('Expired'), 'expiration')
  await captureGuiQaDisplay(`automod-resolved-${width}`)
  console.log(`Native inline AutoMod QA passed at ${width}px.`)
} catch (error) {
  await captureGuiQaDisplay(`automod-failure-${width}`).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  stopAutoMod()
  stopStores()
  loop.stop()
  root.unmount()
  process.exit(process.exitCode ?? 0)
}
