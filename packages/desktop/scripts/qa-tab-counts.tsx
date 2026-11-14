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
const { ChannelTabBar } = await import('../src/gpuix/components/ChannelTabBar')
const { formatTabViewers } = await import('../src/gpuix/tab-counts')
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
  viewers: number | undefined
  unread: number
  mentions: number
  active: string
  mode: 'uniform' | 'mixed'
}
type Renderer = GpuixRenderer & NativeWindowControls
const state = createStore<CounterState>({
  viewers: 9,
  unread: 9,
  mentions: 0,
  active: 'a',
  mode: 'uniform',
})
const fixtureWidth = createStore(900)
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

function Content() {
  const active = useGpuixRequired()
  const value = useStore(state)
  const width = useStore(fixtureWidth)
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    renderer = nativeWindow(active)
  }, [active])
  React.useEffect(() => {
    commits++
  })
  const unread = new Map(
    channels.map((channel) => [
      channel.id,
      value.mode === 'mixed'
        ? {
            unread: channel.id === 'c' && value.active !== 'c' ? value.unread : 0,
            mentions: channel.id === 'c' && value.active !== 'c' ? value.mentions : 0,
          }
        : { unread: value.unread, mentions: value.mentions },
    ]),
  )
  if (value.mode === 'mixed' && value.active !== 'home')
    unread.set('home', { unread: value.unread, mentions: 0 })
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
      <ChannelTabBar
        tabs={{
          watchedChannels: channels,
          activeTabId: value.active,
          homeViewerCount: value.mode === 'mixed' ? 11 : undefined,
          watchedLiveStatuses: new Map(
            channels.map((channel) => [
              channel.id,
              value.mode === 'mixed'
                ? {
                    isLive: channel.id === 'a' || channel.id === 'c',
                    viewerCount: channel.id === 'a' ? 1 : channel.id === 'c' ? 62200 : undefined,
                  }
                : { isLive: value.viewers !== undefined, viewerCount: value.viewers },
            ]),
          ),
          unread,
          onSelectTab: (id) => state.modify((previous) => ({ ...previous, active: id })),
          onAddChannel: () => {},
          onRemoveChannel: () => {},
        }}
      />
      <text style={{ color: '#8b8b99', padding: 12 }}>
        Private controlled counter geometry check
      </text>
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
const geometry: Array<{
  width: number
  mode: string
  checked: number
  baseline: Record<string, { x: number; y: number; width: number }>
}> = []
const compactWidths: Array<{ width: number; empty: number; oneViewer: number; both: number }> = []
const groups = [
  { name: 'plain', values: [9, 10, 99, 999], mentions: false },
  { name: 'compact', values: [60000, 61500, 68800, 99900], mentions: false },
  { name: 'mentions', values: [9, 10, 99, 999], mentions: true },
]
async function setState(next: CounterState) {
  const previous = commits
  state.set(next)
  await until(() => commits > previous, 'counter commit')
  await Bun.sleep(70)
}
try {
  await manager.start()
  await until(() => !!renderer, 'renderer')
  for (const width of [900, 470, 420, 320, 248, 900]) {
    fixtureWidth.set(width)
    await current().setWindowBounds({ width: Math.max(320, width), height: 220 })
    current().simulateMouseMove(20, 120)
    for (const group of groups) {
      await setState({ viewers: 9, unread: 9, mentions: 0, active: 'a', mode: 'uniform' })
      const first = group.values[0]
      assert(first !== undefined)
      await setState({
        viewers: first,
        unread: first,
        mentions: group.mentions ? first : 0,
        active: 'a',
        mode: 'uniform',
      })
      const baseline = tabGeometry()
      for (const testId of tabIds) assertFits(testId, 'channel-tab-bar')
      for (const channel of channels) {
        assertFits(`tab-${channel.id}-viewers`, `tab-${channel.id}`)
        assertFits(`tab-${channel.id}-unread`, `tab-${channel.id}`)
      }
      if (width <= 420)
        assert(bounds('tab-d').y > bounds('tab-home').y, 'Narrow tabs wrap to another row')
      for (const [index, viewers] of group.values.entries()) {
        await setState({
          viewers,
          unread: viewers,
          mentions: group.mentions ? viewers : 0,
          active: index % 2 ? 'b' : 'a',
          mode: 'uniform',
        })
        await until(
          () => current().getPaintedText().join(' ').includes(formatTabViewers(viewers)),
          'painted viewer count',
        )
        assertTabGeometry(baseline, `${group.name} at ${viewers} viewers`)
      }
      geometry.push({ width, mode: group.name, checked: group.values.length, baseline })
    }
    const read = {
      viewers: undefined,
      unread: 0,
      mentions: 0,
      active: 'b',
      mode: 'mixed',
    } satisfies CounterState
    await setState(read)
    const baseline = tabGeometry()
    if (width === 470) {
      const home = bounds('tab-home')
      const channel = bounds('tab-c')
      assert.equal(channel.y, home.y, 'The live tab fits at the wrap threshold')
      assert(width - channel.x - channel.width - 8 < 28, 'An inline pill would force a wrap')
    }
    const regular = { ...read, unread: 100 }
    await setState(regular)
    assertTabGeometry(baseline, 'unread badges appear')
    assert(!nodeFor('tab-b-unread') && !nodeFor('tab-b-viewers'), 'Empty tabs render no counters')
    assert(!nodeFor('tab-a-unread'), 'A read tab renders no unread pill')
    const empty = bounds('tab-b').width
    const oneViewer = bounds('tab-a').width
    assert(empty < 90, 'The empty xqc tab should stay compact')
    assert(oneViewer < 120, 'The single-viewer Satont tab should stay compact')
    await until(
      () =>
        current().getPaintedText().join(' ').includes('62.2K') &&
        current().getPaintedText().join(' ').includes('99+'),
      'both visible count labels without scrolling',
    )
    await setState({ ...regular, mentions: 100 })
    assertTabGeometry(baseline, 'unread becomes a mention')
    await until(() => current().getPaintedText().includes('@99+'), 'painted capped mention badge')
    const badge = bounds('tab-c-unread')
    assertFits('tab-c-unread', 'tab-c')
    for (const testId of ['tab-c-label', 'tab-c-viewers']) {
      assert(badge.y + badge.height <= bounds(testId).y, `Mention badge clears ${testId}`)
    }
    current().simulateMouseMove(badge.x + badge.width / 2, badge.y + badge.height / 2)
    await until(() => !!nodeFor('tab-c-counts-tooltip'), 'counts tooltip opens over the badge')
    await until(
      () =>
        current()
          .getPaintedText()
          .join(' ')
          .includes('62,200 viewers · 100 unread messages · 100 mentions'),
      'counts tooltip shows exact totals',
    )
    current().simulateClick(badge.x + badge.width / 2, badge.y + badge.height / 2, 0)
    await until(
      () => state.get().active === 'c' && !nodeFor('tab-c-unread'),
      'click selects and reads tab',
    )
    assertTabGeometry(baseline, 'pointer selection clears unread')
    current().focusElement(idFor('tab-home'))
    current().simulateKeystrokes('enter')
    await until(
      () => state.get().active === 'home' && !nodeFor('tab-home-unread'),
      'Enter selects and reads Home',
    )
    assertTabGeometry(baseline, 'keyboard selection clears unread')
    await setState(regular)
    const lowerTab = bounds('tab-d')
    current().simulateMouseDown(lowerTab.x + 10, lowerTab.y + 10, 0)
    current().simulateMouseUp(lowerTab.x + 10, lowerTab.y + 10, 0)
    await until(() => state.get().active === 'd', 'pointer selection on a wrapped tab')
    await setState(regular)
    current().focusElement(idFor('tab-d'))
    current().simulateKeystrokes('enter')
    await until(() => state.get().active === 'd', 'keyboard selection on a wrapped tab')
    compactWidths.push({ width, empty, oneViewer, both: bounds('tab-c').width })
    screenshots.push(await captureGuiQaDisplay('tab-counts-' + width))
    await setState({ viewers: undefined, unread: 0, mentions: 0, active: 'b', mode: 'uniform' })
    assert(!nodeFor('tab-a-viewers') && !nodeFor('tab-a-unread'), 'No absent channel counters')
    assert(!nodeFor('tab-home-viewers') && !nodeFor('tab-home-unread'), 'No absent Home counters')
  }
  await Bun.write(
    join(session, 'tab-counts-result.json'),
    JSON.stringify(
      { ok: true, geometry, compactWidths, screenshots, lowRateControlledCheck: true },
      null,
      2,
    ),
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
