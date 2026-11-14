import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import { z } from 'zod'

import type { NativeWindowControls } from '../src/gpuix/native-window'
import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { AppNavigation } = await import('../src/gpuix/components/AppNavigation')
const { ChannelTabBar } = await import('../src/gpuix/components/ChannelTabBar')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
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
interface CounterState {
  unread: number
  mentions: number
  active: string
}
type Renderer = GpuixRenderer & NativeWindowControls
const state = createStore<CounterState>({
  unread: 0,
  mentions: 0,
  active: 'a',
})
const fixtureWidth = createStore(900)
const showDenseHeader = createStore(false)
const backend = getDesktopBackend()
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
let renderer: Renderer | undefined
let commits = 0
const channels: NonNullable<Parameters<typeof ChannelTabBar>[0]['tabs']>['watchedChannels'] = [
  { id: 'a', platform: 'kick', displayName: 'Satont', channelSlug: 'satont', createdAt: 0 },
  {
    id: 'b',
    platform: 'twitch',
    displayName: 'xqc',
    channelSlug: 'xqc',
    createdAt: 0,
  },
  {
    id: 'c',
    platform: 'twitch',
    displayName: 'caseoh_',
    channelSlug: 'caseoh_',
    createdAt: 0,
  },
  {
    id: 'd',
    platform: 'twitch',
    displayName: 'A deliberately long channel title that must remain truncated',
    channelSlug: 'long_channel_title',
    createdAt: 0,
  },
]

const denseChannels: typeof channels = [
  'linaryx',
  'milanrodd',
  'alexue4',
  'suhodolsky',
  'twirapp 1',
  'mikerime',
  'qbnk',
  'lamiory',
  'etoneloxot, le-xot',
  'hibako',
  'lanoreeazy',
  'recrent',
  'chopperinho',
  'dapzer',
].map((name) => ({
  id: name,
  platform: 'twitch',
  displayName: name,
  channelSlug: name,
  createdAt: 0,
}))

function DenseHeader() {
  return (
    <ChannelTabBar
      leading={<AppNavigation onSearchAll={() => {}} />}
      tabs={{
        watchedChannels: denseChannels,
        activeTabId: 'dapzer',
        watchedLiveStatuses: new Map([
          ['twirapp 1', { isLive: true }],
          ['recrent', { isLive: true }],
          ['chopperinho', { isLive: true }],
          ['dapzer', { isLive: true }],
        ]),
        unread: new Map([
          ['recrent', { unread: 30, mentions: 1 }],
          ['chopperinho', { unread: 100, mentions: 0 }],
        ]),
        onSelectTab: () => {},
        onAddChannel: () => {},
        onRemoveChannel: () => {},
      }}
    />
  )
}

function Content() {
  const active = useGpuixRequired()
  const value = useStore(state)
  const width = useStore(fixtureWidth)
  const dense = useStore(showDenseHeader)
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    renderer = nativeWindow(active)
  }, [active])
  React.useEffect(() => {
    commits++
  })
  const unread = new Map<string, { unread: number; mentions: number }>()
  for (const id of ['b', 'c', 'home']) {
    if (id !== value.active) unread.set(id, { unread: value.unread, mentions: value.mentions })
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width,
        height: '100%',
        backgroundColor: '#16161c',
      }}
    >
      {dense ? (
        <DenseHeader />
      ) : (
        <ChannelTabBar
          tabs={{
            watchedChannels: channels,
            activeTabId: value.active,
            watchedLiveStatuses: new Map([['c', { isLive: true }]]),
            unread,
            onSelectTab: (id) => state.modify((previous) => ({ ...previous, active: id })),
            onAddChannel: () => {},
            onRemoveChannel: () => {},
          }}
        />
      )}
    </div>
  )
}
const manager = new DesktopWindowManager(
  backend,
  () => <Content />,
  () => {},
)
function current(): Renderer {
  assert(renderer)
  return renderer
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function nodeFor(testId: string) {
  return flatten(automationSchema.parse(JSON.parse(current().getAutomationTree()))).find(
    (node) => node.testId === testId,
  )
}
function idFor(testId: string): number {
  const node = nodeFor(testId)
  assert(node, `Missing ${testId}`)
  return node.id
}
function bounds(testId: string) {
  const rect = current().getPaintedElementBounds(idFor(testId))
  assert(rect, `Unpainted ${testId}`)
  return rect
}
const tabIds = ['tab-home', 'tab-a', 'tab-b', 'tab-c', 'tab-d', 'tab-add']
function tabGeometry() {
  return Object.fromEntries(
    ['channel-tab-bar', ...tabIds].map((testId) => {
      const { x, y, width, height } = bounds(testId)
      return [testId, { x, y, width, height }]
    }),
  )
}
function assertTabGeometry(expected: ReturnType<typeof tabGeometry>, description: string) {
  const actual = tabGeometry()
  for (const [testId, rect] of Object.entries(expected)) {
    const tab = actual[testId]
    assert(tab)
    for (const axis of ['x', 'y', 'width', 'height'] satisfies Array<keyof typeof rect>) {
      assert(Math.abs(tab[axis] - rect[axis]) < 0.01, `${testId} changed ${axis}: ${description}`)
    }
  }
}
function assertFits(innerId: string, outerId: string) {
  const inner = bounds(innerId)
  const outer = bounds(outerId)
  assert(
    inner.x >= outer.x && inner.x + inner.width <= outer.x + outer.width,
    `${innerId} fits ${outerId} horizontally`,
  )
  assert(
    inner.y >= outer.y && inner.y + inner.height <= outer.y + outer.height,
    `${innerId} fits ${outerId} vertically`,
  )
}
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 5000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(20)
  }
}
const screenshots: string[] = []
const geometry: Array<{ width: number; baseline: ReturnType<typeof tabGeometry> }> = []
async function setState(next: CounterState) {
  const previous = commits
  state.set(next)
  await until(() => commits > previous, 'counter commit')
  await Bun.sleep(70)
}
try {
  await manager.start()
  await until(() => !!renderer, 'renderer')
  const read = { unread: 0, mentions: 0, active: 'a' } satisfies CounterState
  let wrapWidth = 0
  for (const size of [900, 'wrap', 420, 320, 248]) {
    const width = size === 'wrap' ? wrapWidth : size
    assert(typeof width === 'number' && width > 0)
    fixtureWidth.set(width)
    await current().setWindowBounds({ width: Math.max(320, width), height: 220 })
    current().simulateMouseMove(20, 140)
    await setState(read)
    const baseline = tabGeometry()
    const readLabel = bounds('tab-c-label')
    const longLabel = bounds('tab-d-label')
    for (const testId of tabIds) assertFits(testId, 'channel-tab-bar')
    for (const testId of ['tab-home', 'tab-a', 'tab-b', 'tab-c']) {
      assert.equal(bounds(testId).height, 32, 'Tabs keep the original height')
    }
    assertFits('tab-d-label', 'tab-d')
    assertFits('tab-c-live', 'tab-c')
    assert(!nodeFor('tab-b-live'), 'The live dot only appears on live channels')
    if (width === 900) assert(longLabel.width > 150, 'Long titles can use their full width')
    if (width === 248)
      assert(longLabel.height > readLabel.height, 'Long titles wrap at narrow widths')
    if (!wrapWidth) {
      const channel = bounds('tab-c')
      wrapWidth = Math.ceil(channel.x + channel.width + 10)
    }
    if (size === 'wrap') {
      const home = bounds('tab-home')
      const channel = bounds('tab-c')
      assert.equal(channel.y, home.y, 'The live tab fits at the wrap threshold')
      assert(width - channel.x - channel.width - 8 < 5, 'An extra badge slot would force a wrap')
    }
    if (width <= 320) {
      assert(bounds('tab-d').y > bounds('tab-home').y, 'Narrow tabs wrap to another row')
    }
    await setState({ ...read, unread: 124 })
    assertTabGeometry(baseline, 'ordinary unread appears')
    assert.deepEqual(bounds('tab-c-label'), readLabel, 'Ordinary unread leaves the title intact')
    assert(!nodeFor('tab-c-mentions'), 'Ordinary unread has no numeric badge')
    assert(!nodeFor('tab-c-viewers') && !nodeFor('tab-home-viewers'), 'Tabs render no viewer count')
    assert(!current().getPaintedText().includes('124'), 'Ordinary unread total never paints')
    const channelTab = bounds('tab-c')
    const tabX = channelTab.x + 6
    const tabY = channelTab.y + channelTab.height / 2
    current().simulateMouseMove(tabX, tabY)
    await until(
      () => current().getPaintedText().includes('Unread messages'),
      'Ordinary unread tooltip describes state without a count',
    )
    current().simulateMouseMove(20, 140)
    for (const [mentions, badge] of [
      [1, '1'],
      [9, '9'],
      [10, '10'],
      [99, '99'],
      [124, '99+'],
    ] satisfies Array<[number, string]>) {
      await setState({ ...read, unread: 124, mentions })
      assertTabGeometry(baseline, `mention badge for ${mentions}`)
      for (const id of ['tab-home', 'tab-b', 'tab-c']) {
        assertFits(`${id}-mentions`, id)
      }
      const pill = bounds('tab-c-mentions')
      const label = bounds('tab-c-label')
      assert.deepEqual(label, readLabel, 'Mention badges leave the entire title visible')
      assert(label.x + label.width <= pill.x, 'The mention count clears the title')
      await until(() => current().getPaintedText().includes(badge), 'Mention count paints')
    }
    current().simulateMouseMove(tabX, tabY)
    await until(() => !!nodeFor('tab-c-counts-tooltip'), 'Tooltip opens over the tab')
    await until(
      () => current().getPaintedText().includes('124 mentions'),
      'Tooltip shows the exact mention count',
    )
    current().simulateClick(tabX, tabY, 0)
    await until(
      () => state.get().active === 'c' && !nodeFor('tab-c-mentions'),
      'Click selects the tab and clears mentions',
    )
    assertTabGeometry(baseline, 'pointer selection clears mentions')
    current().focusElement(idFor('tab-home'))
    current().simulateKeystrokes('enter')
    await until(
      () => state.get().active === 'home' && !nodeFor('tab-home-mentions'),
      'Enter selects Home and clears mentions',
    )
    assertTabGeometry(baseline, 'keyboard selection clears mentions')
    current().focusElement(idFor('tab-d'))
    current().simulateKeystrokes('enter')
    await until(() => state.get().active === 'd', 'keyboard selection on a wrapped tab')
    geometry.push({ width, baseline })
    screenshots.push(await captureGuiQaDisplay('tab-counts-' + width))
  }
  fixtureWidth.set(650)
  showDenseHeader.set(true)
  await current().setWindowBounds({ width: 650, height: 220 })
  current().simulateMouseMove(20, 145)
  await until(() => !!nodeFor('tab-dapzer'), 'dense navigation header paints')
  const nav = bounds('app-navigation')
  const home = bounds('tab-home')
  assert(
    nav.y < home.y + home.height && home.y < nav.y + nav.height,
    'Navigation shares the first tab row',
  )
  const denseTabIds = ['tab-home', ...denseChannels.map(({ id }) => `tab-${id}`)]
  for (const testId of [...denseTabIds, 'tab-add']) assertFits(testId, 'channel-tab-bar')
  const rows = new Set(denseTabIds.map((testId) => bounds(testId).y))
  assert(rows.size > 1, 'The 650px header wraps fourteen channels')
  screenshots.push(await captureGuiQaDisplay('tab-counts-dense-650'))
  await Bun.write(
    join(session, 'tab-counts-result.json'),
    JSON.stringify({ ok: true, geometry, screenshots }, null, 2),
  )
} catch (error) {
  await captureGuiQaDisplay('tab-counts-failure')
  await Bun.write(
    join(session, 'tab-counts-failure.json'),
    JSON.stringify({ error: String(error), text: renderer?.getPaintedText() }, null, 2),
  )
  throw error
} finally {
  await manager.quit()
  backend.dispose?.()
}
process.exit(0)
