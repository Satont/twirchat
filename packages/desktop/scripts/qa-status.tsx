if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { join } from 'node:path'
const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { App } = await import('../src/gpuix/components/App')
const { ChatWindow } = await import('../src/gpuix/components/ChatWindow')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const app = await import('../src/gpuix/state/app')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { DEFAULT_TRANSLATION_SETTINGS } = await import('../src/services/translation')
const { DEFAULT_STREAMER_MODE_SETTINGS } = await import('../src/services/streamer-mode')
const { wireStreamerMode, saveStreamerMode } = await import('../src/gpuix/state/streamer-mode')
const { actionBindingsStore } = await import('../src/gpuix/state/action-bindings')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { focusNativeQaWindow } = await import('./qa-x11')
const values = new Map(),
  layouts = new Map()
const channels = ['a', 'b'].map((id) => ({
  id: `status-channel-${id}`,
  platform: 'twitch',
  channelSlug: `status-${id}`,
  displayName: `Channel ${id.toUpperCase()}`,
  createdAt: 0,
}))
const layout = {
  version: 2,
  root: {
    type: 'split',
    id: 'status-root',
    direction: 'vertical',
    flex: 100,
    children: ['status-a', 'status-b'].map((id) => ({
      type: 'panel',
      id,
      flex: 50,
      content: { type: 'main' },
    })),
  },
}
layouts.set('home', layout)
let automatic = false
let status = {
  mode: 'off',
  effectiveEnabled: false,
  checking: false,
  error: null,
  settings: { ...DEFAULT_STREAMER_MODE_SETTINGS },
}
const events = createDesktopEvents()
const backend = {
  events,
  api: {
    getUiState: async ({ key }) => values.get(key) ?? null,
    setUiState: async ({ key, value }) => {
      values.set(key, value)
    },
    getTabChannelIds: async () => channels.map((channel) => channel.id),
    setTabChannelIds: async () => {},
    getWatchedChannelsLayout: async ({ tabId }) => structuredClone(layouts.get(tabId) ?? null),
    setWatchedChannelsLayout: async ({ tabId, layout: next }) => {
      layouts.set(tabId, structuredClone(next))
    },
    removeWatchedChannelsLayout: async ({ tabId }) => {
      layouts.delete(tabId)
    },
    getChannelEmotes: async () => [],
    getTranslationSettings: async () => ({
      settings: structuredClone(DEFAULT_TRANSLATION_SETTINGS),
      credentials: [],
    }),
    getStreamerMode: async () => status,
    setStreamerMode: async ({ mode }) => {
      const selected = mode === 'toggle' ? (status.effectiveEnabled ? 'off' : 'on') : mode
      status = {
        ...status,
        mode: selected,
        effectiveEnabled: selected === 'on' || (selected === 'auto' && automatic),
      }
      return status
    },
  },
}
app.settingsStore.set({ ...DEFAULT_SETTINGS, showAvatars: false })
app.accountsStore.set([])
app.activeTabStore.set('chat')
app.activeWatchedTabStore.set('home')
app.tabChannelIdsStore.set(channels.map((channel) => channel.id))
app.watchedChannelsStore.set(channels)
const renderers = new Map()
function Content({ descriptor }) {
  const renderer = useGpuixRequired()
  React.useEffect(() => {
    renderers.set(descriptor.id, renderer)
    return () => {
      renderers.delete(descriptor.id)
    }
  }, [renderer, descriptor])
  return descriptor.kind === 'main'
    ? React.createElement(App)
    : React.createElement(ChatWindow, { descriptor })
}
const stopStreamer = wireStreamerMode(backend)
const manager = new DesktopWindowManager(
  backend,
  (descriptor) => React.createElement(Content, { descriptor }),
  () => {},
)
const screenshots = []
const nodes = (renderer) => {
  const walk = (node) => [node, ...(node.children ?? []).flatMap(walk)]
  return walk(JSON.parse(renderer.getAutomationTree()))
}
function node(renderer, id) {
  const found = nodes(renderer).find((entry) => entry.testId === id)
  assert.ok(found, `Missing ${id}`)
  return found
}
function bounds(renderer, id) {
  const result = renderer.getElementBounds(node(renderer, id).id)
  assert.ok(result)
  return result
}
async function tooltip(renderer, expected) {
  renderer.focusElement(node(renderer, 'app-status-icon').id)
  await Bun.sleep(90)
  assert.ok(
    nodes(renderer).some((entry) => entry.testId === 'app-status-tooltip'),
    'Status tooltip must open with keyboard focus',
  )
  assert.ok(renderer.getPaintedText().includes(expected), `Tooltip must show ${expected}`)
}
async function check(renderer, enabled, expected) {
  await Bun.sleep(100)
  assert.equal(
    nodes(renderer).some((entry) => entry.testId === 'streamer-mode-dot'),
    enabled,
  )
  renderer.blur()
  await Bun.sleep(100)
  assert.equal(
    renderer.getPaintedText().includes('Streamer mode enabled'),
    false,
    'No standalone status banner may consume a row',
  )
  await tooltip(renderer, expected)
}
try {
  await manager.start()
  await Bun.sleep(500)
  const main = renderers.get('main')
  assert.ok(main)
  await focusNativeQaWindow('TwirChat')
  await check(main, false, 'Streamer mode disabled')
  const headerBefore = bounds(main, 'chat-header')
  actionBindingsStore.update({
    loaded: true,
    value: {
      legacyNavigation: false,
      bindings: [
        {
          id: 'status-toggle',
          name: 'Status QA',
          enabled: true,
          category: 'window',
          action: 'setStreamerMode',
          keys: ['ctrl+f12'],
          arguments: ['toggle'],
        },
      ],
    },
  })
  await Bun.sleep(40)
  main.simulateKeystrokes('ctrl-f12')
  await check(main, true, 'Streamer mode enabled')
  assert.equal(
    bounds(main, 'chat-header').y,
    headerBefore.y,
    'Enabling streamer mode must not shift chat content',
  )
  const dotBefore = bounds(main, 'streamer-mode-dot')
  await Bun.sleep(400)
  assert.deepEqual(bounds(main, 'streamer-mode-dot'), dotBefore, 'The red dot must remain static')
  screenshots.push(await captureGuiQaDisplay('status-main-tooltip-wide'))
  main.blur()
  await Bun.sleep(100)
  screenshots.push(await captureGuiQaDisplay('status-main-enabled-wide'))
  main.simulateKeystrokes('ctrl-f12')
  await check(main, false, 'Streamer mode disabled')
  await saveStreamerMode(backend, 'auto')
  await check(main, false, 'Streamer mode disabled (automatic)')
  automatic = true
  status = { ...status, mode: 'auto', effectiveEnabled: true }
  events.emit('streamer_mode_changed', status)
  await check(main, true, 'Streamer mode enabled (automatic)')
  await main.setWindowBounds({ width: 680, height: 820 })
  await Bun.sleep(150)
  main.blur()
  await Bun.sleep(100)
  for (const entry of nodes(main).filter((entry) => entry.testId === 'chat-header-actions')) {
    const toolbar = main.getElementBounds(entry.id)
    assert.ok(toolbar)
    assert.ok(toolbar.height <= 26, `Narrow chat toolbar must occupy one row: ${toolbar.height}`)
  }
  for (const entry of nodes(main).filter((entry) => entry.testId === 'chat-header')) {
    const header = main.getElementBounds(entry.id)
    assert.ok(header)
    assert.ok(
      header.height <= 80,
      `Narrow chat header must occupy at most two rows: ${header.height}`,
    )
  }
  screenshots.push(await captureGuiQaDisplay('status-main-enabled-small'))
  const childId = await manager.openChat('home')
  await Bun.sleep(350)
  const child = renderers.get(childId)
  assert.ok(child)
  await focusNativeQaWindow('TwirChat chat')
  assert.equal(
    nodes(child).filter((entry) => entry.testId === 'app-status-icon').length,
    1,
    'Only the first native chat header owns the app icon',
  )
  await check(child, true, 'Streamer mode enabled (automatic)')
  const icon = bounds(child, 'app-status-icon'),
    header = bounds(child, 'chat-header')
  assert.ok(
    icon.y >= header.y && icon.y + icon.height <= header.y + header.height,
    'Standalone status icon stays in the existing header',
  )
  screenshots.push(await captureGuiQaDisplay('status-native-tooltip'))
  child.blur()
  await Bun.sleep(100)
  screenshots.push(await captureGuiQaDisplay('status-native-header'))
  await manager.close('main')
  await Bun.sleep(150)
  assert.equal(child.isWindowOpen(), true)
  automatic = false
  status = { ...status, effectiveEnabled: false }
  events.emit('streamer_mode_changed', status)
  await check(child, false, 'Streamer mode disabled (automatic)')
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'status-result.json'),
    JSON.stringify(
      {
        passed: true,
        states: ['off', 'on', 'auto-off', 'auto-on'],
        staticDot: true,
        noBannerRow: true,
        nativeHeader: true,
        afterMainClose: true,
        screenshots,
      },
      null,
      2,
    ),
  )
} catch (error) {
  await captureGuiQaDisplay('status-failure')
  console.error(error)
  process.exitCode = 1
} finally {
  stopStreamer()
  await manager.quit()
  process.exit(process.exitCode ?? 0)
}
