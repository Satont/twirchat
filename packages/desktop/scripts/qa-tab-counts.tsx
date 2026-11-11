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
        ? { unread: channel.id === 'c' ? 100 : 0, mentions: 0 }
        : { unread: value.unread, mentions: value.mentions },
    ]),
  )
  if (value.mode === 'mixed') unread.set('home', { unread: 22, mentions: 0 })
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
          onSelectTab: (id) => state.modify((current) => ({ ...current, active: id })),
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
  const bounds = current().getPaintedElementBounds(idFor(testId))
  assert(bounds, `Unpainted ${testId}`)
  return bounds
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
  for (const width of [900, 420, 320, 248, 900]) {
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
      const testIds = ['tab-home', 'tab-a', 'tab-b', 'tab-c', 'tab-d', 'tab-add']
      const baseline = Object.fromEntries(
        testIds.map((testId) => {
          const { x, y, width } = bounds(testId)
          return [testId, { x, y, width }]
        }),
      )
      const bar = bounds('channel-tab-bar')
      for (const testId of testIds) {
        const tab = bounds(testId)
        assert(tab.x >= bar.x && tab.x + tab.width <= bar.x + bar.width, `${testId} fits the row`)
        assert(tab.y >= bar.y && tab.y + tab.height <= bar.y + bar.height, `${testId} fits the bar`)
      }
      for (const channel of channels) {
        const tab = bounds(`tab-${channel.id}`)
        const counts = bounds(`tab-${channel.id}-counts`)
        assert(
          counts.x >= tab.x && counts.x + counts.width <= tab.x + tab.width,
          'Counts fit the tab',
        )
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
        for (const testId of testIds) {
          const actual = bounds(testId)
          const expected = baseline[testId]
          assert(expected)
          assert(
            Math.abs(actual.x - expected.x) < 0.01,
            testId + ' moved in ' + group.name + ' at ' + viewers,
          )
          assert(
            Math.abs(actual.y - expected.y) < 0.01,
            testId + ' changed row in ' + group.name + ' at ' + viewers,
          )
          assert(
            Math.abs(actual.width - expected.width) < 0.01,
            testId + ' resized in ' + group.name + ' at ' + viewers,
          )
        }
      }
      geometry.push({ width, mode: group.name, checked: group.values.length, baseline })
    }
    await setState({ viewers: undefined, unread: 0, mentions: 0, active: 'b', mode: 'mixed' })
    assert(!nodeFor('tab-b-counts'), 'An empty tab must not contain invisible counter cells')
    assert(!nodeFor('tab-a-unread'), 'A read tab must not reserve an unread pill')
    assert(
      nodeFor('tab-c-viewers') && nodeFor('tab-c-unread'),
      'Both viewer and unread counts remain visible together',
    )
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
    const lowerTab = bounds('tab-d')
    current().simulateMouseDown(lowerTab.x + 10, lowerTab.y + 10, 0)
    current().simulateMouseUp(lowerTab.x + 10, lowerTab.y + 10, 0)
    await until(() => state.get().active === 'd', 'pointer selection on a wrapped tab')
    await setState({ viewers: undefined, unread: 0, mentions: 0, active: 'b', mode: 'mixed' })
    current().focusElement(idFor('tab-d'))
    current().simulateKeystrokes('enter')
    await until(() => state.get().active === 'd', 'keyboard selection on a wrapped tab')
    compactWidths.push({ width, empty, oneViewer, both: bounds('tab-c').width })
    screenshots.push(await captureGuiQaDisplay('tab-counts-' + width))
    await setState({ viewers: undefined, unread: 0, mentions: 0, active: 'b', mode: 'uniform' })
    assert(
      !nodeFor('tab-a-counts'),
      'Unavailable viewers and zero unread must leave no counter group',
    )
    assert(!nodeFor('tab-home-counts'), 'The home tab must not reserve absent statistics')
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
