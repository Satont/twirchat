if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { join } from 'node:path'
const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const app = await import('../src/gpuix/state/app')
const { layoutStore } = await import('../src/gpuix/state/layout')
const { actionBindingsStore } = await import('../src/gpuix/state/action-bindings')
const { chatPauseStore } = await import('../src/gpuix/state/chat-pause')
const { messageSimilarityStore, getMessageSimilarity } =
  await import('../src/gpuix/state/message-similarity')
const { chatRulesStore } = await import('../src/gpuix/state/chat-rules')
const { streamerModeStore } = await import('../src/gpuix/state/streamer-mode')
const { wireHighlightNotifications, notificationPreferences } =
  await import('../src/gpuix/state/highlight-notifications')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { DEFAULT_TRANSLATION_SETTINGS } = await import('../src/services/translation')
const { emotePreferencesStore } = await import('../src/gpuix/state/emote-preferences')
const { focusNativeQaWindow } = await import('./qa-x11')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const channel = { id: 'qa', platform: 'kick', channelSlug: 'qa', displayName: 'QA', createdAt: 0 }
const layout = {
  version: 2,
  root: { type: 'panel', id: 'pane', flex: 100, content: { type: 'watched', channelId: 'qa' } },
}
const values = new Map(),
  layouts = new Map([['qa-tab', layout]]),
  alerts = [],
  opened = []
const backend = {
  events: createDesktopEvents(),
  api: {
    getUiState: async ({ key }) => values.get(key) ?? null,
    setUiState: async ({ key, value }) => {
      values.set(key, value)
    },
    getWatchedChannelsLayout: async ({ tabId }) => layouts.get(tabId) ?? null,
    setWatchedChannelsLayout: async ({ tabId, layout: next }) => {
      layouts.set(tabId, next)
    },
    removeWatchedChannelsLayout: async ({ tabId }) => {
      layouts.delete(tabId)
    },
    getChannelEmotes: async () => [],
    getModerationCapabilities: async () => ({ canModerate: false }),
    getTranslationSettings: async () => ({
      settings: DEFAULT_TRANSLATION_SETTINGS,
      credentials: [],
    }),
    notify: async (notice) => {
      alerts.push(notice)
    },
    openExternalUrl: async ({ url }) => {
      opened.push(url)
    },
  },
}
app.settingsStore.set({ ...DEFAULT_SETTINGS, showAvatars: false })
app.accountsStore.set([
  {
    id: 'qa-own',
    platform: 'kick',
    platformUserId: 'owner',
    username: 'owner',
    displayName: 'Owner',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
])
app.watchedChannelsStore.set([channel])
app.watchedStatusesStore.set(
  new Map([['qa', { platform: 'kick', status: 'connected', mode: 'authenticated' }]]),
)
layoutStore.set(new Map([['qa-tab', { layout, isLoading: false, error: null }]]))
emotePreferencesStore.update({
  value: {
    ...emotePreferencesStore.get().value,
    badges: false,
    paints: false,
    personal: false,
    enabled: { twitch: false, seventv: false, bttv: false, ffz: false },
  },
})
const stopMessages = app.wireBackendToStores(backend)
const stopNotices = wireHighlightNotifications(backend)
let renderer
function Content() {
  const currentRenderer = useGpuixRequired()
  React.useEffect(() => {
    renderer = currentRenderer
  }, [currentRenderer])
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#16161c',
      },
    },
    React.createElement(ChatView, {
      paneId: 'qa-tab:pane',
      layoutTabId: 'qa-tab',
      layoutPanelId: 'pane',
      watchedChannel: channel,
    }),
  )
}
const manager = new DesktopWindowManager(
  backend,
  () => React.createElement(Content),
  () => {},
)
async function until(check, label) {
  const end = performance.now() + 5000
  while (performance.now() < end) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
const painted = (text) => renderer.getPaintedText().some((run) => run.includes(text))
const nodes = (node = JSON.parse(renderer.getAutomationTree())) => [
  node,
  ...(node.children ?? []).flatMap((child) => nodes(child)),
]
function bounds(testId) {
  const node = nodes().find((node) => node.testId === testId)
  assert.ok(node, testId)
  return renderer.getElementBounds(node.id)
}
function incoming(id, text = id, metadata) {
  const message = {
    id,
    platform: 'kick',
    channelId: 'qa',
    type: 'message',
    timestamp: new Date(),
    text,
    author: { id: 'viewer', username: 'viewer', displayName: 'Viewer', badges: [] },
    emotes: [],
    ...(metadata ? { metadata } : {}),
  }
  backend.events.emit('watched_channel_message', { channelId: 'qa', message })
  return message
}
async function command(text) {
  actionBindingsStore.update({
    value: {
      legacyNavigation: false,
      bindings: [
        {
          id: 'qa',
          name: 'QA',
          category: 'split',
          action: 'runCommand',
          enabled: true,
          keys: ['ctrl+f12'],
          arguments: [text],
        },
      ],
    },
  })
  await Bun.sleep(30)
  renderer.simulateKeystrokes('ctrl-f12')
  await Bun.sleep(60)
}
function pause(options) {
  chatPauseStore.update({
    value: { hoverSeconds: 0, modifier: 'none', doubleClickLinks: false, ...options },
  })
}
try {
  await manager.start()
  await until(
    () => renderer && nodes().some((node) => node.testId === 'chat-messages'),
    'chat pane',
  )
  await focusNativeQaWindow('TwirChat')
  incoming('BEFORE_HOVER')
  await until(() => painted('BEFORE_HOVER'), 'initial message')
  pause({ hoverSeconds: -1 })
  await Bun.sleep(50)
  const list = bounds('chat-messages')
  renderer.simulateMouseMove(list.x + list.width / 2, list.y + list.height / 2)
  await Bun.sleep(70)
  incoming('DURING_HOVER')
  await Bun.sleep(80)
  assert.equal(painted('DURING_HOVER'), false, 'hover retains snapshot')
  await command('/pause')
  renderer.simulateMouseMove(10, 10)
  await Bun.sleep(60)
  incoming('MANUAL_REMAINS')
  await Bun.sleep(80)
  assert.equal(painted('MANUAL_REMAINS'), false, 'leaving mouse preserves manual pause')
  await command('/resume')
  await until(() => painted('MANUAL_REMAINS'), 'resume all reasons')
  pause({ modifier: 'ctrl' })
  await Bun.sleep(60)
  renderer.simulateMouseMove(list.x + 40, list.y + 30, undefined, 'ctrl')
  await Bun.sleep(60)
  incoming('DURING_MODIFIER')
  await Bun.sleep(80)
  assert.equal(painted('DURING_MODIFIER'), false, 'modifier retains snapshot')
  renderer.simulateMouseMove(list.x + 50, list.y + 30, undefined, 'shift')
  await until(() => painted('DURING_MODIFIER'), 'different modifier releases pause')
  pause({ doubleClickLinks: true })
  incoming('link', 'https://example.com/qa')
  await until(() => painted('https://example.com/qa'), 'link text')
  const link = nodes().find((node) => node.text === 'https://example.com/qa')
  assert.ok(link)
  const box = renderer.getElementBounds(link.id)
  assert.ok(box)
  renderer.simulateMouseDown(box.x + 5, box.y + 5, 0)
  renderer.simulateMouseUp(box.x + 5, box.y + 5, 0)
  incoming('DURING_LINK_PRESS')
  await Bun.sleep(60)
  assert.equal(painted('DURING_LINK_PRESS'), false, 'first link press pauses for second click')
  assert.deepEqual(opened, [], 'single click does not open a double-click link')
  await until(() => painted('DURING_LINK_PRESS'), '200ms link pause expires')
  renderer.focusElement(link.id)
  renderer.simulateKeystrokes('enter')
  await until(() => opened.length === 1, 'keyboard link activation')
  pause({})
  messageSimilarityStore.update({
    value: { ...messageSimilarityStore.get().value, enabled: true, hideSimilar: false },
  })
  chatRulesStore.update({
    value: {
      ...chatRulesStore.get().value,
      highlights: [
        {
          id: 'ping',
          enabled: true,
          pattern: 'PING',
          regex: false,
          caseSensitive: true,
          wholeWord: false,
          target: 'message',
          color: '#a78bfa',
          mentions: true,
          sound: true,
          flash: true,
        },
      ],
    },
  })
  await Bun.sleep(60)
  assert.equal(notificationPreferences.store.get().value.backgroundOnly, true)
  incoming('visible-highlight', 'PING_visible_notification_gate_distinct_message_0123456789')
  await until(() => painted('PING_visible_'), 'visible-window highlight')
  assert.equal(alerts.length, 0, 'visible window suppresses background-only notifications')
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, backgroundOnly: false },
  })
  incoming('repeat-a', 'PING_REPEAT')
  await until(() => alerts.length === 1, 'first highlight')
  await Bun.sleep(1600)
  const repeated = incoming('repeat-b', 'PING_REPEAT')
  await until(() => getMessageSimilarity(repeated)?.similar === true, 'incoming similarity flag')
  await Bun.sleep(100)
  assert.equal(alerts.length, 1, 'similar messages do not repeat alerts')
  messageSimilarityStore.update({
    value: { ...messageSimilarityStore.get().value, hideSimilar: true },
  })
  await until(
    () => renderer.getPaintedText().filter((run) => run.includes('PING_REPEAT')).length === 1,
    'R9K hides only similar row',
  )
  streamerModeStore.set({ ...streamerModeStore.get(), mode: 'on', effectiveEnabled: true })
  await Bun.sleep(1600)
  incoming('private', 'PING_PRIVATE')
  incoming('whisper', 'WHISPER_PRIVATE', { flags: { whisper: true } })
  await Bun.sleep(150)
  assert.equal(alerts.length, 1, 'streamer mode mutes mention alerts')
  assert.equal(painted('WHISPER_PRIVATE'), false, 'streamer mode hides inline whisper')
  const screenshot = await captureGuiQaDisplay('chat-behavior')
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR!, 'chat-behavior-result.json'),
    JSON.stringify({ ok: true, alerts: alerts.length, opened, screenshot }, null, 2),
  )
  console.log('Native pause, similarity and streamer behavior QA passed.')
} catch (error) {
  await captureGuiQaDisplay('chat-behavior-failure').catch(() => {})
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR!, 'chat-behavior-debug.json'),
    JSON.stringify(
      {
        error: String(error),
        notice: app.noticeStore.get(),
        painted: renderer?.getPaintedText(),
        tree: renderer ? JSON.parse(renderer.getAutomationTree()) : null,
      },
      null,
      2,
    ),
  )
  console.error(error)
  process.exitCode = 1
} finally {
  stopMessages()
  stopNotices()
  await manager.quit()
  await Bun.sleep(100)
  process.exit(process.exitCode ?? 0)
}
