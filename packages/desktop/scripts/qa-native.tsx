if (process.env.TWIRCHAT_GUI_QA !== '1')
  throw new Error('Native QA requires the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import(
  new URL('../src/services/gui-qa.ts', import.meta.url).href
)
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url))
const React = await import(require.resolve('react'))
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import(
  require.resolve('@gpuix/react')
)
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const base = new URL('../src/gpuix/', import.meta.url).pathname
const { BackendContext } = await import(base + 'backend/context.ts')
const { ChannelTabBar } = await import(base + 'components/ChannelTabBar.tsx')
const { useStore } = await import(base + 'state/create-store.ts')
const app = await import(base + 'state/app.ts')
const tabs = await import(base + 'state/chat-tabs.ts')
const watched = ['a', 'b', 'c'].map((id) => ({
  id,
  platform: 'twitch',
  channelSlug: id,
  displayName: `Channel ${id.toUpperCase()}`,
}))
const values = new Map()
const layouts = new Map(
  watched.map((channel) => [
    channel.id,
    {
      version: 2,
      root: {
        type: 'panel',
        id: `panel-${channel.id}`,
        flex: 100,
        content: { type: 'watched', channelId: channel.id },
      },
    },
  ]),
)
const backend = {
  api: {
    getUiState: async ({ key }) => values.get(key) ?? null,
    setUiState: async ({ key, value }) => {
      values.set(key, value)
    },
    getTabChannelIds: async () => ['a', 'b', 'c'],
    setTabChannelIds: async () => {},
    getWatchedChannelsLayout: async ({ tabId }) => structuredClone(layouts.get(tabId)),
    setWatchedChannelsLayout: async ({ tabId, layout }) => {
      layouts.set(tabId, structuredClone(layout))
    },
  },
}
app.watchedChannelsStore.set(watched)
await tabs.initializeChatTabs(backend)
function Harness() {
  const ids = useStore(app.tabChannelIdsStore)
  const state = useStore(tabs.chatTabsStore)
  return React.createElement(ChannelTabBar, {
    watchedChannels: tabs.tabsForChannels(watched, ids, state.value.metadata),
    activeTabId: 'a',
    watchedStatuses: new Map(),
    watchedLiveStatuses: new Map(),
    onSelectTab: (id) => app.activeWatchedTabStore.set(id),
    onAddChannel: () => {},
    onRemoveChannel: (id) => void tabs.closeChatTab(backend, id),
  })
}
const renderer = createRenderer()
renderer.init({
  title: 'TwirChat tabs QA',
  appId: process.env.TWIRCHAT_QA_APP_ID,
  focus: false,
  width: 1280,
  height: 900,
})
const root = createRoot(renderer)
root.render(
  React.createElement(
    BackendContext.Provider,
    { value: backend },
    React.createElement(
      'div',
      { style: { width: '100%', height: '100%', backgroundColor: '#111114' } },
      React.createElement(Harness),
    ),
  ),
)
const loop = startFrameLoop(renderer)
function find(testId) {
  function walk(node) {
    if (node.testId === testId || node.props?.testId === testId) return node.id
    for (const child of node.children ?? []) {
      const found = walk(child)
      if (found !== undefined) return found
    }
  }
  const id = walk(JSON.parse(renderer.getAutomationTree()))
  assert.notEqual(id, undefined, `Missing ${testId}`)
  const bounds = renderer.getElementBounds(id)
  assert.ok(bounds)
  return { id, ...bounds }
}
try {
  await Bun.sleep(500)
  const first = find('tab-a'),
    last = find('tab-c')
  renderer.simulateMouseDown(first.x + first.width / 2, first.y + first.height / 2, 0)
  await Bun.sleep(30)
  renderer.simulateMouseMove(last.x + last.width / 2 + 4, last.y + last.height / 2, 0)
  await Bun.sleep(60)
  renderer.simulateMouseUp(last.x + last.width / 2 + 4, last.y + last.height / 2, 0)
  await Bun.sleep(200)
  assert.deepEqual(app.tabChannelIdsStore.get(), ['b', 'c', 'a'])
  const allNodes = (node) => [node, ...(node.children ?? []).flatMap(allNodes)]
  const tabTree = () => allNodes(JSON.parse(renderer.getAutomationTree()))
  const clickMenuText = async (text) => {
    const entry = tabTree().find((node) => node.text === text)
    assert.ok(entry, `Missing tab context action ${text}`)
    const box = renderer.getElementBounds(entry.id)
    assert.ok(box)
    renderer.simulateClick(box.x + box.width / 2, box.y + box.height / 2, 0)
    await Bun.sleep(100)
  }
  const openTabMenu = async () => {
    const target = find('tab-c')
    renderer.simulateClick(target.x + target.width / 2, target.y + target.height / 2, 2)
    await Bun.sleep(100)
  }
  assert.equal(
    tabTree().some(
      (node) => node.testId?.startsWith('tab-menu-') || node.testId?.startsWith('tab-close-'),
    ),
    false,
    'Tab rows must not render menu/close buttons',
  )
  await openTabMenu()
  assert.ok(tabTree().some((node) => node.text === 'Rename / tab color…'))
  assert.ok(tabTree().some((node) => node.text === 'Duplicate tab'))
  await captureGuiQaDisplay('native-tab-context-menu')
  await clickMenuText('Lock tab')
  assert.equal(tabs.chatTabsStore.get().value.metadata.c?.locked, true)
  await openTabMenu()
  await clickMenuText('Close tab')
  assert.deepEqual(
    app.tabChannelIdsStore.get(),
    ['b', 'c', 'a'],
    'A locked tab must reject context close',
  )
  const home = find('tab-home')
  renderer.focusElement(home.id)
  renderer.simulateClick(home.x + home.width / 2, home.y + home.height / 2, 2)
  renderer.simulateKeystrokes('delete')
  await Bun.sleep(80)
  assert.equal(
    tabTree().some((node) => node.text === 'Close tab'),
    false,
    'Home must not expose a close menu',
  )
  assert.deepEqual(app.tabChannelIdsStore.get(), ['b', 'c', 'a'])
  await openTabMenu()
  renderer.simulateKeystrokes('escape')
  await Bun.sleep(80)
  assert.equal(
    tabTree().some((node) => node.text === 'Close tab'),
    false,
    'Escape must close the tab context menu',
  )
  await openTabMenu()
  await clickMenuText('Unlock tab')
  await openTabMenu()
  await clickMenuText('Close tab')
  await Bun.sleep(150)
  assert.deepEqual(app.tabChannelIdsStore.get(), ['b', 'a'])
  assert.equal(app.watchedChannelsStore.get().length, 3)
  await tabs.restoreClosedChatTab(backend)
  await tabs.duplicateChatTab(backend, 'a')
  await Bun.sleep(100)
  assert.equal(app.tabChannelIdsStore.get().length, 4)
  const restoredAndDuplicated = app.tabChannelIdsStore.get().length
  const screenshot = await captureGuiQaDisplay('native-tabs')
  const { WatchedView } = await import(base + 'components/WatchedView.tsx')
  const { layoutStore } = await import(base + 'state/layout.ts')
  const paneLayout = {
    version: 2,
    root: {
      type: 'split',
      id: 'qa-root',
      direction: 'vertical',
      flex: 100,
      children: ['qa-a', 'qa-b'].map((id) => ({
        type: 'panel',
        id,
        flex: 50,
        content: { type: 'watched', channelId: id },
      })),
    },
  }
  layouts.set('qa-layout', paneLayout)
  layoutStore.set(new Map([['qa-layout', { layout: paneLayout, isLoading: false, error: null }]]))
  app.watchedChannelsStore.set([])
  root.render(
    React.createElement(
      BackendContext.Provider,
      { value: backend },
      React.createElement(WatchedView, { tabId: 'qa-layout' }),
    ),
  )
  await Bun.sleep(150)
  const before = find('pane-qa-a')
  let divider = find('pane-divider')
  renderer.simulateMouseDown(divider.x + 1, divider.y + 30, 0)
  await Bun.sleep(20)
  renderer.simulateMouseMove(divider.x + 101, divider.y + 30, 0)
  await Bun.sleep(40)
  renderer.simulateMouseUp(divider.x + 101, divider.y + 30, 0)
  await Bun.sleep(650)
  const resized = find('pane-qa-a')
  assert.ok(
    Math.abs(resized.width - before.width - 100) < 2,
    `Measured resize changed ${resized.width - before.width}px`,
  )
  assert.ok(layouts.get('qa-layout').root.children[0].flex > 50, 'Measured resize did not persist')
  divider = find('pane-divider')
  renderer.focusElement(divider.id)
  renderer.simulateKeystrokes('right')
  await Bun.sleep(650)
  const nudged = find('pane-qa-a')
  assert.ok(
    Math.abs(nudged.width - resized.width - 10) < 2,
    `Keyboard resize changed ${nudged.width - resized.width}px`,
  )
  divider = find('pane-divider')
  renderer.focusElement(divider.id)
  renderer.simulateMouseDown(divider.x + 1, divider.y + 30, 0)
  await Bun.sleep(20)
  renderer.simulateMouseMove(divider.x + 51, divider.y + 30, 0)
  await Bun.sleep(40)
  renderer.simulateKeystrokes('escape')
  renderer.simulateMouseUp(divider.x + 51, divider.y + 30, 0)
  await Bun.sleep(100)
  assert.ok(
    Math.abs(find('pane-qa-a').width - nudged.width) < 2,
    'Escape did not cancel pane resize',
  )
  const grip = find('pane-drag-qa-a'),
    destination = find('pane-qa-b')
  assert.equal(grip.width, 18, 'Pane dragging must use a compact grip')
  assert.equal(grip.height, 24, 'Pane dragging must not reserve an extra row')
  const layoutBeforeCancel = structuredClone(layouts.get('qa-layout'))
  renderer.simulateMouseDown(grip.x + grip.width / 2, grip.y + 5, 0)
  await Bun.sleep(20)
  renderer.simulateMouseMove(
    destination.x + destination.width / 2,
    destination.y + destination.height - 5,
    0,
  )
  await Bun.sleep(30)
  renderer.simulateKeystrokes('escape')
  await Bun.sleep(30)
  renderer.simulateMouseUp(
    destination.x + destination.width / 2,
    destination.y + destination.height - 5,
    0,
  )
  await Bun.sleep(60)
  assert.deepEqual(layouts.get('qa-layout'), layoutBeforeCancel, 'Escape must cancel pane docking')
  renderer.simulateMouseDown(grip.x + grip.width / 2, grip.y + 5, 0)
  await Bun.sleep(20)
  renderer.simulateMouseMove(
    destination.x + destination.width / 2,
    destination.y + destination.height - 5,
    0,
  )
  await Bun.sleep(40)
  renderer.simulateMouseUp(
    destination.x + destination.width / 2,
    destination.y + destination.height - 5,
    0,
  )
  await Bun.sleep(150)
  assert.equal(layouts.get('qa-layout').root.direction, 'horizontal')
  assert.deepEqual(
    layouts.get('qa-layout').root.children.map((pane) => pane.id),
    ['qa-b', 'qa-a'],
  )
  const layoutScreenshot = await captureGuiQaDisplay('native-layout')

  const { ChatView } = await import(base + 'components/ChatView.tsx')
  const { createDesktopEvents } = await import(base + 'backend/events.ts')
  const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
  const { emotePreferencesStore } = await import(base + 'state/emote-preferences.ts')
  const { applyTranslationSettings } = await import(base + 'state/translation.ts')
  const { DEFAULT_TRANSLATION_SETTINGS } = await import('../src/services/translation')
  const { buildChatSearchSnapshot, requestChatSearchJump, chatSearchJumpStore } = await import(
    base + 'state/chat-search.ts'
  )
  const channel = {
    id: 'qa-youtube',
    platform: 'youtube',
    channelSlug: 'QaVideoChannel',
    displayName: 'QA video chat',
  }
  const searchLayout = {
    version: 2,
    root: {
      type: 'panel',
      id: 'p',
      flex: 100,
      content: { type: 'watched', channelId: channel.id },
    },
  }
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: `qa-message-${index}`,
    channelId: channel.channelSlug,
    platform: 'youtube',
    type: 'message',
    author: {
      id: `author-${index}`,
      username: `reader${index}`,
      displayName: `Reader ${index}`,
      badges: [],
    },
    text: `Historical message ${index} for native jump verification`,
    emotes: [],
    timestamp: new Date(1000 + index),
  }))
  app.settingsStore.set({
    ...structuredClone(DEFAULT_SETTINGS),
    showAvatars: false,
    showBadges: false,
    chatTheme: 'compact',
  })
  app.accountsStore.set([])
  app.watchedChannelsStore.set([channel])
  app.tabChannelIdsStore.set(['qa-search'])
  app.activeWatchedTabStore.set('qa-search')
  app.activeTabStore.set('chat')
  app.watchedMessagesStore.set(new Map([[channel.id, messages]]))
  layoutStore.set(new Map([['qa-search', { layout: searchLayout, isLoading: false, error: null }]]))
  const emotePreferences = emotePreferencesStore.get()
  emotePreferencesStore.set({
    ...emotePreferences,
    loaded: true,
    value: { ...emotePreferences.value, badges: false, paints: false, personal: false },
  })
  applyTranslationSettings({
    settings: structuredClone(DEFAULT_TRANSLATION_SETTINGS),
    credentials: [],
  })
  const events = createDesktopEvents()
  const chatBackend = {
    events,
    api: {
      ...backend.api,
      getChannelEmotes: async () => [],
      getUserCosmetics: async () => null,
      getTranslationSettings: async () => ({
        settings: structuredClone(DEFAULT_TRANSLATION_SETTINGS),
        credentials: [],
      }),
    },
  }
  app.wireBackendToStores(chatBackend)
  root.render(
    React.createElement(
      BackendContext.Provider,
      { value: chatBackend },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(
          'div',
          { style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' } },
          React.createElement(ChatView, {
            paneId: 'qa-search:p',
            layoutTabId: 'qa-search',
            watchedChannel: channel,
          }),
        ),
      ),
    ),
  )
  await Bun.sleep(250)
  const frozen = buildChatSearchSnapshot({
    tabIds: ['qa-search'],
    layouts: new Map([['qa-search', searchLayout]]),
    channels: [channel],
    homeMessages: [],
    watchedMessages: new Map([[channel.id, messages]]),
  })
  const target = frozen.results.find((result) => result.message.id === 'qa-message-20')
  assert.ok(target)
  let arrivals = 0
  const incoming = setInterval(() => {
    arrivals++
    events.emit('watched_channel_message', {
      channelId: channel.id,
      message: {
        ...messages[99],
        id: `new-${arrivals}`,
        text: `Live arrival ${arrivals}`,
        timestamp: new Date(100000 + arrivals),
      },
    })
  }, 5)
  try {
    assert.equal(requestChatSearchJump(target), true)
    const deadline = Date.now() + 2000
    while (chatSearchJumpStore.get()) {
      assert.ok(Date.now() < deadline, 'Search jump did not finish under live traffic')
      await Bun.sleep(10)
    }
    await Bun.sleep(100)
    await captureGuiQaDisplay('native-search-diagnostic')
    await Bun.write(
      `${process.env.TWIRCHAT_QA_SESSION_DIR}/native-search-tree.json`,
      renderer.getAutomationTree(),
    )
    const revealed = find('revealed-search-message'),
      pane = find('chat-pane')
    assert.ok(
      revealed.y >= pane.y && revealed.y + revealed.height <= pane.y + pane.height,
      'Search target was not scrolled into the visible pane',
    )
    assert.ok(
      renderer.getAllText().some((text) => text.includes('chat paused to keep its context')),
    )
    assert.ok(arrivals > 0)
  } finally {
    clearInterval(incoming)
  }
  const searchScreenshot = await captureGuiQaDisplay('native-search')
  console.log(
    JSON.stringify({
      passed: true,
      reordered: ['b', 'c', 'a'],
      closedWithoutRemovingChannel: true,
      restoredAndDuplicated,
      screenshot,
      layoutScreenshot,
      searchScreenshot,
      measuredResize: 100,
      keyboardResize: 10,
      escapeCanceled: true,
      dockOrder: ['qa-b', 'qa-a'],
      searchJumpUnderLiveTraffic: true,
    }),
  )
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  loop.stop()
  root.unmount()
  setTimeout(() => process.exit(process.exitCode ?? 0), 20)
}
