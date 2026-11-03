import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type {
  NormalizedChatMessage,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'
import { z } from 'zod'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { useGpuixRequired, flushSync } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { nativeWindow } = await import('../src/gpuix/native-window')
import type { NativeWindowControls } from '../src/gpuix/native-window'
const { ChannelTabBar } = await import('../src/gpuix/components/ChannelTabBar')
const { WatchedView } = await import('../src/gpuix/components/WatchedView')
const app = await import('../src/gpuix/state/app')
const tabs = await import('../src/gpuix/state/chat-tabs')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
const { layoutStore } = await import('../src/gpuix/state/layout')
const { windowActivityStore } = await import('../src/gpuix/state/window-activity')
const { emotePreferencesStore } = await import('../src/gpuix/state/emote-preferences')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { focusNativeQaWindow, closeNativeQaWindow } = await import('./qa-x11')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')

interface AutomationNode {
  id: number
  testId?: string
  children: AutomationNode[]
}
const automationSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    children: z.array(automationSchema).default([]),
  }),
)
type Renderer = GpuixRenderer & NativeWindowControls
interface FocusTarget {
  renderer: Renderer
  update(): void
}
const focusTargets = new Map<string, FocusTarget>()
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
const backend = getDesktopBackend()
const channels: WatchedChannel[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map(
  (id) => ({
    id,
    platform: 'kick',
    channelSlug: id,
    displayName: `Stream ${id.toUpperCase()}`,
    createdAt: 0,
  }),
)
let savedTabs = channels.map((channel) => channel.id)
let tabSaves = 0
let paneSaves = 0
const values = new Map<string, string>()
const layouts = new Map<string, WatchedChannelsLayout>()
const tabId = 'qa-drag-panes'
const paneLayout: WatchedChannelsLayout = {
  version: 2,
  root: {
    type: 'split',
    id: 'qa-split',
    direction: 'vertical',
    flex: 100,
    children: ['a', 'b'].map((id) => ({
      type: 'panel',
      id: `pane-${id}`,
      flex: 50,
      content: { type: 'watched', channelId: id },
    })),
  },
}
layouts.set(tabId, paneLayout)
backend.api.getUiState = async ({ key }) => values.get(key) ?? null
backend.api.setUiState = async ({ key, value }) => {
  values.set(key, value)
}
backend.api.getTabChannelIds = async () => savedTabs
backend.api.setTabChannelIds = async ({ ids }) => {
  savedTabs = [...ids]
  tabSaves++
}
backend.api.getWatchedChannelsLayout = async ({ tabId: id }) =>
  structuredClone(layouts.get(id) ?? null)
backend.api.setWatchedChannelsLayout = async ({ tabId: id, layout }) => {
  layouts.set(id, structuredClone(layout))
  if (id === tabId) paneSaves++
}
backend.api.removeWatchedChannelsLayout = async ({ tabId: id }) => {
  layouts.delete(id)
}
backend.api.getChannelEmotes = async () => []
app.settingsStore.set({ ...DEFAULT_SETTINGS, chatTheme: 'compact', showAvatars: false })
app.accountsStore.set([])
app.watchedChannelsStore.set(channels)
app.watchedStatusesStore.set(
  new Map(
    channels.map((channel) => [
      channel.id,
      {
        platform: 'kick',
        status: 'connected',
        mode: 'anonymous',
      },
    ]),
  ),
)
emotePreferencesStore.update({
  value: {
    ...emotePreferencesStore.get().value,
    badges: false,
    paints: false,
    personal: false,
    enabled: { twitch: false, seventv: false, bttv: false, ffz: false },
  },
})
await tabs.initializeChatTabs(backend)
const stopMessages = app.wireBackendToStores(backend)
const mode = createStore<'tabs' | 'panes'>('tabs')
let renderer: Renderer | undefined
function Content() {
  const instance = useGpuixRequired()
  const view = useStore(mode)
  const ids = useStore(app.tabChannelIdsStore)
  const state = useStore(tabs.chatTabsStore)
  React.useEffect(() => {
    assert(instance instanceof NativeRenderer)
    renderer = nativeWindow(instance)
    return () => {
      renderer = undefined
    }
  }, [instance])
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {view === 'tabs' ? (
        <ChannelTabBar
          watchedChannels={tabs.tabsForChannels(channels, ids, state.value.metadata)}
          activeTabId="a"
          watchedStatuses={app.watchedStatusesStore.get()}
          watchedLiveStatuses={new Map()}
          onSelectTab={() => {}}
          onAddChannel={() => {}}
          onRemoveChannel={() => {}}
        />
      ) : (
        <WatchedView tabId={tabId} />
      )}
    </div>
  )
}
function FocusTarget({ id }: { id: string }) {
  const instance = useGpuixRequired()
  const [revision, setRevision] = React.useState(0)
  const activity = useStore(app.chatActivityStore)
  React.useEffect(() => {
    assert(instance instanceof NativeRenderer)
    focusTargets.set(id, {
      renderer: nativeWindow(instance),
      update: () => setRevision((value) => value + 1),
    })
    return () => {
      focusTargets.delete(id)
    }
  }, [id, instance])
  return (
    <div style={{ width: '100%', height: '100%' }}>
      Private focus target {activity.get('a')?.total ?? 0} / {revision}
    </div>
  )
}
const manager = new DesktopWindowManager(
  backend,
  (descriptor) => (descriptor.kind === 'main' ? <Content /> : <FocusTarget id={descriptor.id} />),
  () => {},
)
function current(): Renderer {
  assert(renderer)
  return renderer
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function find(testId: string) {
  const node = flatten(automationSchema.parse(JSON.parse(current().getAutomationTree()))).find(
    (entry) => entry.testId === testId,
  )
  assert(node, `Missing ${testId}`)
  const bounds = current().getPaintedElementBounds(node.id)
  assert(bounds, `Unpainted ${testId}`)
  return { id: node.id, ...bounds }
}
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
let sequence = 0
let checkingDrag = false
let heartbeatTicks = 0
let maximumLagMs = 0
let previousTick = performance.now()
let freshBoundsCalls = 0
const heartbeat = setInterval(() => {
  const now = performance.now()
  if (checkingDrag) {
    heartbeatTicks++
    maximumLagMs = Math.max(maximumLagMs, now - previousTick - 10)
  }
  previousTick = now
}, 10)
const traffic = setInterval(() => {
  for (const channel of channels.slice(0, 2)) {
    const message: NormalizedChatMessage = {
      id: `drag-traffic-${sequence++}`,
      platform: 'kick',
      channelId: channel.channelSlug,
      text: `Live chat continues during pointer gestures ${sequence}`,
      timestamp: new Date(),
      type: 'message',
      emotes: [],
      author: { id: 'viewer', username: 'viewer', displayName: 'Viewer', badges: [] },
    }
    backend.events.emit('watched_channel_message', { channelId: channel.id, message })
  }
}, 20)
function beginMeasurement() {
  checkingDrag = true
  previousTick = performance.now()
}
function endMeasurement() {
  checkingDrag = false
}
async function dragTo(
  source: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
) {
  const sx = source.x + source.width / 2,
    sy = source.y + Math.min(10, source.height / 2)
  current().simulateMouseDown(sx, sy, 0)
  await Bun.sleep(30)
  for (let step = 1; step <= 20; step++) {
    current().simulateMouseMove(sx + ((x - sx) * step) / 20, sy + ((y - sy) * step) / 20, 0)
    await Bun.sleep(8)
  }
}
function savedLayout() {
  const layout = layouts.get(tabId)
  assert(layout)
  return layout
}
function firstFlex() {
  const root = savedLayout().root
  assert(root.type === 'split')
  return root.children[0]?.flex
}
const wrapping: Array<{
  width: number
  rows: number
  bounds: Array<ReturnType<typeof find> & { testId: string }>
  screenshot: string
}> = []
async function recordWrapping(width: number) {
  const bar = find('channel-tab-bar')
  const bounds = ['tab-home', ...channels.map((channel) => `tab-${channel.id}`), 'tab-add'].map(
    (testId) => ({ testId, ...find(testId) }),
  )
  for (const tab of bounds) {
    assert(tab.x >= bar.x && tab.x + tab.width <= bar.x + bar.width, 'Tabs fit the row width')
    assert(tab.y >= bar.y && tab.y + tab.height <= bar.y + bar.height, 'Tabs fit the bar height')
  }
  const rows = new Set(bounds.filter((tab) => tab.testId !== 'tab-add').map((tab) => tab.y)).size
  wrapping.push({
    width,
    rows,
    bounds,
    screenshot: await captureGuiQaDisplay(`wrapping-tabs-${width}`),
  })
  return rows
}
function dragResult(
  originalTabs: string[],
  screenshot: Awaited<ReturnType<typeof captureGuiQaDisplay>>,
) {
  return {
    ok: true,
    originalTabs,
    tabSaves,
    paneSaves,
    freshBoundsCalls,
    heartbeatTicks,
    maximumLagMs,
    messages: sequence,
    screenshot,
    wrapping,
    wrappedReorder: true,
    lostButtonCancel: true,
    outsideCancel: true,
    blurCancel: true,
    escapeCancel: true,
    followUpDock: true,
  }
}
let successfulResult: ReturnType<typeof dragResult> | undefined
const reactErrors: string[] = []
const originalConsoleError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  const message = args
    .map((value) => (value instanceof Error ? (value.stack ?? value.message) : String(value)))
    .join(' ')
  if (
    reactErrors.length < 32 &&
    /react-reconciler|React render failed|GPUI UI thread|Invalid hook call|Maximum update depth|cannot update GpuixView/iu.test(
      message,
    )
  )
    reactErrors.push(message)
  originalConsoleError(...args)
}
try {
  await manager.start()
  await until(() => renderer !== undefined, 'main renderer')
  await current().setWindowBounds({ width: 900, height: 600 })
  await focusNativeQaWindow('TwirChat')
  await Bun.sleep(150)
  const normalRows = await recordWrapping(900)
  const fresh = current().getElementBounds.bind(current())
  current().getElementBounds = (id) => {
    if (checkingDrag) {
      freshBoundsCalls++
      throw new Error('Fresh geometry queried during a drag')
    }
    return fresh(id)
  }

  const original = [...app.tabChannelIdsStore.get()]
  let source = find('tab-a'),
    target = find('tab-c')
  let saved = tabSaves
  beginMeasurement()
  await dragTo(source, target.x + target.width / 2, target.y + target.height / 2)
  assert.equal(tabSaves, saved, 'Moving tabs must not persist layout')
  current().simulateMouseUp(target.x + target.width / 2, target.y + target.height / 2, 0)
  await Bun.sleep(120)
  endMeasurement()
  assert.deepEqual(app.tabChannelIdsStore.get().slice(0, 3), ['b', 'c', 'a'])
  assert.equal(tabSaves, saved + 1, 'A tab drop persists once')

  const reordered = [...app.tabChannelIdsStore.get()]
  source = find('tab-b')
  target = find('tab-a')
  saved = tabSaves
  beginMeasurement()
  await dragTo(source, target.x, target.y + 4)
  current().simulateMouseMove(target.x, target.y + 100, 0)
  current().simulateMouseUp(target.x, target.y + 100, 0)
  await Bun.sleep(80)
  endMeasurement()
  assert.deepEqual(
    app.tabChannelIdsStore.get(),
    reordered,
    'Releasing outside tabs cancels reorder',
  )
  assert.equal(tabSaves, saved)

  beginMeasurement()
  await dragTo(source, target.x, target.y + 4)
  current().simulateMouseMove(target.x, target.y + 4)
  await Bun.sleep(40)
  current().simulateMouseUp(target.x, target.y + 4, 0)
  await Bun.sleep(50)
  endMeasurement()
  assert.deepEqual(app.tabChannelIdsStore.get(), reordered, 'Missing left button cancels tab drag')

  await current().setWindowBounds({ width: 420, height: 300 })
  await Bun.sleep(80)
  const narrowRows = await recordWrapping(420)
  assert(narrowRows > normalRows, 'Narrower windows move tabs onto more rows')
  source = find('tab-b')
  target = find('tab-l')
  assert(target.y > source.y, 'The reorder target is on a later row')
  const previousY = source.y
  saved = tabSaves
  beginMeasurement()
  await dragTo(source, target.x + target.width / 2, target.y + 4)
  current().simulateMouseUp(target.x + target.width / 2, target.y + 4, 0)
  await Bun.sleep(100)
  endMeasurement()
  assert(
    app.tabChannelIdsStore.get().indexOf('l') < app.tabChannelIdsStore.get().indexOf('b'),
    'Reorder uses both coordinates of wrapped tab geometry',
  )
  assert.equal(tabSaves, saved + 1, 'A cross-row drop persists once')
  assert(find('tab-b').y > previousY, 'Reordered tab moves to the target row')
  await current().setWindowBounds({ width: 900, height: 600 })
  await Bun.sleep(80)
  assert.equal(await recordWrapping(900), normalRows, 'Widening restores the original row count')

  layoutStore.modify((states) =>
    new Map(states).set(tabId, { layout: paneLayout, isLoading: false, error: null }),
  )
  mode.set('panes')
  await current().setWindowBounds({ width: 1000, height: 700 })
  await Bun.sleep(200)
  const before = find('pane-pane-a')
  let divider = find('pane-divider')
  saved = paneSaves
  beginMeasurement()
  await dragTo(divider, divider.x + 82, divider.y + 10)
  assert.equal(paneSaves, saved, 'Resizing uses only transient draft state')
  current().simulateMouseUp(divider.x + 82, divider.y + 10, 0)
  await Bun.sleep(100)
  endMeasurement()
  await until(() => paneSaves === saved + 1, 'one accepted resize save')
  assert(
    Math.abs(find('pane-pane-a').width - before.width - 80) < 3,
    'Measured resize keeps pixel delta',
  )
  assert((firstFlex() ?? 0) > 50)

  const afterResize = find('pane-pane-a').width
  divider = find('pane-divider')
  saved = paneSaves
  beginMeasurement()
  await dragTo(divider, divider.x + 50, divider.y + 10)
  current().simulateMouseMove(divider.x + 50, divider.y + 10)
  await Bun.sleep(40)
  current().simulateMouseUp(divider.x + 50, divider.y + 10, 0)
  await Bun.sleep(100)
  endMeasurement()
  assert(
    Math.abs(find('pane-pane-a').width - afterResize) < 2,
    'Lost left button reverts resize draft',
  )
  assert.equal(paneSaves, saved)

  let grip = find('pane-drag-pane-a'),
    destination = find('pane-pane-b')
  let beforeDock = structuredClone(savedLayout())
  beginMeasurement()
  await dragTo(grip, destination.x + destination.width / 2, destination.y + 10)
  current().simulateKeystrokes('escape')
  await Bun.sleep(30)
  current().simulateMouseUp(destination.x + destination.width / 2, destination.y + 10, 0)
  await Bun.sleep(60)
  endMeasurement()
  assert.deepEqual(savedLayout(), beforeDock, 'Escape cancels pane docking')

  beginMeasurement()
  await dragTo(grip, destination.x + destination.width / 2, destination.y + 10)
  current().simulateMouseMove(-20, -20, 0)
  current().simulateMouseUp(-20, -20, 0)
  await Bun.sleep(60)
  endMeasurement()
  assert.deepEqual(savedLayout(), beforeDock, 'Outside drop does not dock the last hovered pane')

  const child = await manager.openChat(tabId)
  await focusNativeQaWindow('TwirChat')
  await Bun.sleep(80)
  beginMeasurement()
  await dragTo(grip, destination.x + destination.width / 2, destination.y + 10)
  endMeasurement()
  await focusNativeQaWindow('TwirChat chat')
  await until(
    () => windowActivityStore.get().get('main')?.active === false,
    'native window deactivation',
  )
  await Bun.sleep(60)
  await manager.close(child)
  await focusNativeQaWindow('TwirChat')
  current().simulateMouseUp(destination.x + destination.width / 2, destination.y + 10, 0)
  await Bun.sleep(80)
  assert.deepEqual(savedLayout(), beforeDock, 'Deactivation cancels pane drag')

  grip = find('pane-drag-pane-a')
  destination = find('pane-pane-b')
  beforeDock = structuredClone(savedLayout())
  const activityBefore = app.chatActivityStore.get().get('a')?.total ?? 0
  const ticksBefore = heartbeatTicks
  beginMeasurement()
  await dragTo(grip, destination.x + destination.width / 2, destination.y + destination.height - 8)
  assert.deepEqual(savedLayout(), beforeDock, 'Pane preview does not persist layout')
  current().simulateMouseUp(
    destination.x + destination.width / 2,
    destination.y + destination.height - 8,
    0,
  )
  await Bun.sleep(100)
  endMeasurement()
  await until(() => {
    const root = savedLayout().root
    return root.type === 'split' && root.direction === 'horizontal'
  }, 'follow-up pane docking')
  assert(
    (app.chatActivityStore.get().get('a')?.total ?? 0) > activityBefore,
    'Chat continues during drag',
  )
  assert(heartbeatTicks > ticksBefore + 5, 'Event loop continues while moving')
  assert.equal(freshBoundsCalls, 0, 'Drag handlers never request a fresh native layout')
  assert(maximumLagMs < 150, `Pointer interaction stalled event loop ${maximumLagMs.toFixed(1)}ms`)

  const externallyClosed = await manager.openChat(tabId)
  await until(() => focusTargets.has(externallyClosed), 'live close-test root')
  const closingTarget = focusTargets.get(externallyClosed)
  assert(closingTarget)
  closeNativeQaWindow('TwirChat chat')
  // Keep Bun in this task so the frame-loop callback cannot dispose the React root first.
  const closeDeadline = performance.now() + 1000
  while (closingTarget.renderer.isWindowOpen() && performance.now() < closeDeadline) {
    /* wait for native close */
  }
  assert.equal(closingTarget.renderer.isWindowOpen(), false, 'Native OS close completed')
  assert(focusTargets.has(externallyClosed), 'React root remains mounted before the close callback')
  flushSync(() => closingTarget.update())
  await manager.close(externallyClosed)
  await Bun.sleep(50)
  assert.equal(reactErrors.length, 0, 'A late React commit after native close is safe')

  const screenshot = await captureGuiQaDisplay('drag-interactions')
  successfulResult = dragResult(original, screenshot)
} catch (error) {
  process.exitCode = 1
  await captureGuiQaDisplay('drag-interactions-failure').catch(() => {})
  await Bun.write(
    join(session, 'drag-interactions-debug.json'),
    JSON.stringify(
      {
        error: String(error),
        freshBoundsCalls,
        maximumLagMs,
        tabs: app.tabChannelIdsStore.get(),
        layout: layouts.get(tabId),
        notice: app.noticeStore.get(),
        tree: renderer ? automationSchema.parse(JSON.parse(renderer.getAutomationTree())) : null,
      },
      null,
      2,
    ),
  )
  console.error(error)
} finally {
  clearInterval(heartbeat)
  clearInterval(traffic)
  stopMessages()
  try {
    await manager.quit()
  } catch (error) {
    process.exitCode = 1
    console.error(error)
  }
  await Bun.sleep(100)
  if (reactErrors.length) {
    process.exitCode = 1
    await Bun.write(
      join(session, 'drag-interactions-react-errors.json'),
      JSON.stringify({ ok: false, reactErrors }, null, 2),
    )
    originalConsoleError(
      'Native drag QA caught React or renderer errors, including during cleanup.',
    )
  }
  if ((process.exitCode ?? 0) === 0 && successfulResult) {
    await Bun.write(
      join(session, 'drag-interactions-result.json'),
      JSON.stringify({ ...successfulResult, reactErrors }, null, 2),
    )
    console.log('Native tab, pane and divider gesture QA passed, including cleanup.')
  }
  console.error = originalConsoleError
  process.exit(process.exitCode ?? 0)
}
