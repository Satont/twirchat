import assert from 'node:assert/strict'

import type { Account, AppSettings, WatchedChannel } from '@twirchat/shared/types'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import('@gpuix/react')
const { BackendContext } = await import('../src/gpuix/backend/context')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { setLanguage } = await import('../src/i18n')
const {
  settingsStore,
  streamStatusStore,
  watchedChannelsStore,
  watchedStatusesStore,
  wireBackendToStores,
} = await import('../src/gpuix/state/app')
const { accountsStore } = await import('../src/gpuix/state/accounts')
const { layoutStore } = await import('../src/gpuix/state/layout-state')
const { wireTwitchActivities } = await import('../src/gpuix/state/twitch-activities')
const { darkTheme } = await import('../src/gpuix/theme')
const { ThemeContext } = await import('../src/gpuix/theme-context')
const { DEFAULT_TRANSLATION_SETTINGS } = await import('../src/services/translation')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')

const width = 1180
const height = 640
const theme = darkTheme
const channel: WatchedChannel = {
  id: 'satont',
  platform: 'twitch',
  channelSlug: 'satont',
  displayName: 'Satont',
  createdAt: 0,
}
const layout = {
  version: 2,
  root: {
    type: 'panel',
    id: 'pane',
    flex: 100,
    content: { type: 'watched', channelId: 'satont' },
  },
}
const values = new Map<string, unknown>()
const layouts = new Map([['qa-tab', layout]])
const events = createDesktopEvents()
const backend = {
  events,
  api: {
    getUiState: async ({ key }: { key: string }) => values.get(key) ?? null,
    setUiState: async ({ key, value }: { key: string; value: unknown }) => {
      values.set(key, value)
    },
    getWatchedChannelsLayout: async ({ tabId }: { tabId: string }) => layouts.get(tabId) ?? null,
    setWatchedChannelsLayout: async ({
      tabId,
      layout: next,
    }: {
      tabId: string
      layout: unknown
    }) => {
      layouts.set(tabId, next)
    },
    removeWatchedChannelsLayout: async ({ tabId }: { tabId: string }) => {
      layouts.delete(tabId)
    },
    getChannelEmotes: async () => [],
    getModerationCapabilities: async () => ({ canModerate: false }),
    getSettings: async () => settingsStore.get(),
    getSavedAccounts: async () => [],
    getUserAliases: async () => [],
    getTranslationSettings: async () => ({
      settings: DEFAULT_TRANSLATION_SETTINGS,
      credentials: [],
    }),
    getChannelRoomState: async ({ channelSlug }: { channelSlug: string }) => ({
      platform: 'twitch',
      channelId: channelSlug,
    }),
    getTwitchActivities: async () => null,
    watchTwitchActivities: async () => {},
    getStreamStatus: async () => [],
    getChannelStatuses: async () => ({}),
    notify: async () => {},
    copyText: async () => {},
    openExternalUrl: async () => {},
  },
}
const settings: AppSettings = { ...DEFAULT_SETTINGS, language: 'ru', showAvatars: false }
settingsStore.set(settings)
setLanguage(settings.language)
const accounts: Account[] = [
  {
    id: 'twitch-own',
    platform: 'twitch',
    platformUserId: '1',
    username: 'satont',
    displayName: 'Satont',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'kick-own',
    platform: 'kick',
    platformUserId: '2',
    username: 'oceanofapathy',
    displayName: 'oceanofapathy',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'vkplay-own',
    platform: 'vkplay',
    platformUserId: '3',
    username: 'streamx',
    displayName: 'StreamX',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
]
accountsStore.set(accounts)
watchedChannelsStore.set([channel])
watchedStatusesStore.set(
  new Map([['satont', { platform: 'kick', status: 'connected', mode: 'authenticated' }]]),
)
streamStatusStore.set(
  new Map([
    [
      'twitch:satont',
      {
        platform: 'twitch',
        channelLogin: 'satont',
        isLive: true,
        viewerCount: 1234,
        categoryName: 'Software and Game Development',
        title: 'хаотичное программирование | !лей !трекер',
      },
    ],
  ]),
)
layoutStore.set(new Map([['qa-tab', { layout, isLoading: false, error: null }]]))
const stop = wireBackendToStores(backend)
const stopActivities = wireTwitchActivities(backend)
const renderer = createRenderer()
renderer.init({ title: 'TwirChat chat header QA', width, height, focus: false })
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)

function mount(children: unknown) {
  root.render(
    <BackendContext.Provider value={backend}>
      <TooltipProvider>
        <ThemeContext.Provider value={theme}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              height: '100%',
              backgroundColor: theme.bg,
            }}
          >
            {children}
          </div>
        </ThemeContext.Provider>
      </TooltipProvider>
    </BackendContext.Provider>,
  )
}

interface AutomationNode {
  testId?: string
  children?: AutomationNode[]
}

function nodes(
  node: AutomationNode | null = JSON.parse(renderer.getAutomationTree()),
): AutomationNode[] {
  return node ? [node, ...(node.children ?? []).flatMap((child) => nodes(child))] : []
}

const find = (testId: string) => nodes().find((node) => node.testId === testId)
const painted = (text: string) => renderer.getPaintedText().some((run) => run.includes(text))

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 5000
  while (!check()) {
    assert.ok(performance.now() < deadline, `Timed out: ${label}`)
    // oxlint-disable-next-line no-await-in-loop
    await Bun.sleep(30)
  }
}

async function click(testId: string): Promise<void> {
  await until(() => find(testId) !== undefined, testId)
  const node = find(testId)
  assert.ok(node)
  const bounds = renderer.getElementBounds(node.id)
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0, testId)
  renderer.simulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)
  await Bun.sleep(120)
}

function incoming(id: string, text: string, author: string) {
  backend.events.emit('watched_channel_message', {
    channelId: 'satont',
    message: {
      id,
      platform: 'twitch',
      channelId: 'satont',
      type: 'message',
      timestamp: new Date(),
      text,
      author: { id: author, username: author, displayName: author, badges: [] },
      emotes: [],
    },
  })
}

const screenshots: string[] = []

async function shot(name: string): Promise<string> {
  // The framebuffer trails the automation tree by a frame.
  await Bun.sleep(200)
  return await captureGuiQaDisplay(name)
}
const result: Record<string, unknown> = {}

try {
  mount(
    <ChatView
      paneId="qa-tab:pane"
      layoutTabId="qa-tab"
      layoutPanelId="pane"
      watchedChannel={channel}
      onSplitRight={() => {}}
      onChangeChannel={() => {}}
      onClosePanel={() => {}}
    />,
  )
  await until(() => find('chat-header-viewers') !== undefined, 'channel pane header')
  incoming('m1', 'привет, как дела?', 'viewer')
  incoming('m2', 'выглядит круто', '91kamui')
  incoming('m3', 'го дальше', 'another')
  await until(() => painted('выглядит круто'), 'channel messages render')

  assert.equal(find('chat-header-title'), undefined, 'the header leaves naming to the tab bar')
  assert(painted('1.2K'))
  assert(painted('Software and Game Development'))
  assert(painted('хаотичное программирование'))
  assert(!painted('Живой чат') && !painted('ЖИВОЙ ЧАТ'), 'live chat label is gone')
  assert(!painted('сообщ./с'), 'message rate is gone')
  assert.equal(find('chat-message-rate'), undefined)
  assert.equal(find('chat-header-channels'), undefined)
  assert(find('chat-pause-button') !== undefined)
  assert(find('chat-mentions-button') !== undefined)
  assert.equal(find('chat-history-button'), undefined)
  assert.equal(find('settings-button'), undefined)
  screenshots.push(await shot('chat-header-channel'))
  result.channelHeader = renderer.getPaintedText()

  backend.events.emit('twitch_activity_snapshot', {
    channelSlug: 'satont',
    snapshot: {
      channelId: 'streamx',
      channelSlug: 'satont',
      polls: [],
      predictions: [],
      rewards: [],
      pinnedMessage: {
        id: 'pin-1',
        messageId: 'm2',
        authorName: '91kamui',
        text: 'сегодня играем до победного',
      },
      errors: {},
    },
  })
  await until(() => find('chat-pinned-banner') !== undefined, 'pinned banner')
  assert(painted('91kamui: сегодня играем до победного'))
  assert(!painted('Закреплено ·'), 'the pinned banner drops the label')
  screenshots.push(await shot('chat-header-pinned-banner'))

  await click('panel-menu')
  await until(() => find('chat-search-button') !== undefined, 'menu lists hidden actions')
  assert(find('chat-history-button') !== undefined)
  assert(find('settings-button') !== undefined)
  assert(find('split-right') !== undefined)
  screenshots.push(await shot('chat-header-menu'))
  await renderer.setWindowBounds({ width, height: 980 })
  await Bun.sleep(200)
  await click('settings-button')
  await until(() => find('appearance-header-action-search') !== undefined, 'appearance dialog')
  assert(painted('КНОПКИ ПАНЕЛИ'))
  assert(find('appearance-header-action-pause') === undefined)
  const scroll = find('appearance-scroll')
  assert.ok(scroll)
  const scrollBox = renderer.getElementBounds(scroll.id)
  assert.ok(scrollBox)
  renderer.simulateScrollWheel(
    scrollBox.x + scrollBox.width - 20,
    scrollBox.y + scrollBox.height / 2,
    0,
    -420,
  )
  screenshots.push(await shot('chat-appearance-buttons'))
  await click('appearance-close')
  await until(() => find('appearance-header-action-search') === undefined, 'appearance closes')
  await renderer.setWindowBounds({ width, height })
  await Bun.sleep(200)
  await until(() => find('chat-header-actions') !== undefined, 'chat returns')

  settingsStore.set({ ...settings, chatHeaderActions: ['history', 'search', 'filters'] })
  await until(
    () => find('chat-search-button') !== undefined,
    'pinned search appears in the toolbar',
  )
  assert(find('chat-history-button') !== undefined)
  assert(find('chat-filters-button') !== undefined)
  assert.equal(find('settings-button'), undefined, 'unpinned settings stays in the menu')
  screenshots.push(await shot('chat-header-pinned'))
  settingsStore.set(settings)
  await until(() => find('chat-search-button') === undefined, 'pinning resets')

  mount(<ChatView isMain paneId="qa-tab:pane" layoutTabId="qa-tab" layoutPanelId="pane" />)
  await until(() => find('chat-header-channels') !== undefined, 'home header channel names')
  assert(painted('satont, oceanofapathy, streamx'), 'channel names are plain comma-separated text')
  assert.equal(find('chat-feed-header'), undefined, 'no channel chips in the header')
  screenshots.push(await shot('chat-header-home'))
  result.homeHeader = renderer.getPaintedText()

  await Bun.write(
    `${process.env.TWIRCHAT_QA_SESSION_DIR}/chat-header-result.json`,
    JSON.stringify({ ok: true, screenshots, result }, null, 2),
  )
  console.log(JSON.stringify({ ok: true, screenshots }))
} catch (error) {
  process.exitCode = 1
  await captureGuiQaDisplay('chat-header-failure').catch(() => {})
  await Bun.write(
    `${process.env.TWIRCHAT_QA_SESSION_DIR}/chat-header-result.json`,
    JSON.stringify(
      { ok: false, error: String(error), painted: renderer.getPaintedText() },
      null,
      2,
    ),
  )
  throw error
} finally {
  stopActivities()
  stop()
  loop.stop()
  root.unmount()
  process.exit(process.exitCode ?? 0)
}
