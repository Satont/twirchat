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
}
type Renderer = GpuixRenderer & NativeWindowControls
const state = createStore<CounterState>({ viewers: 9, unread: 9, mentions: 0, active: 'a' })
const backend = getDesktopBackend()
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
let renderer: Renderer | undefined
let commits = 0
const channels: Parameters<typeof ChannelTabBar>[0]['watchedChannels'] = [
  { id: 'a', platform: 'kick', displayName: 'Satont', channelSlug: 'satont', createdAt: 0 },
  {
    id: 'b',
    platform: 'twitch',
    displayName: 'justovich221337',
    channelSlug: 'justovich221337',
    createdAt: 0,
  },
  {
    id: 'c',
    platform: 'twitch',
    displayName: 'A deliberately long channel title that must remain truncated',
    channelSlug: 'long_channel_title',
    createdAt: 0,
  },
]

function Content() {
  const active = useGpuixRequired()
  const value = useStore(state)
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    renderer = nativeWindow(active)
  }, [active])
  React.useEffect(() => {
    commits++
  })
  const unread = new Map(
    channels.map((channel) => [channel.id, { unread: value.unread, mentions: value.mentions }]),
  )
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#16161c',
      }}
    >
      <ChannelTabBar
        watchedChannels={channels}
        activeTabId={value.active}
        watchedStatuses={new Map()}
        watchedLiveStatuses={
          new Map(
            channels.map((channel) => [
              channel.id,
              { isLive: value.viewers !== undefined, viewerCount: value.viewers },
            ]),
          )
        }
        unread={unread}
        onSelectTab={(id) => state.modify((current) => ({ ...current, active: id }))}
        onAddChannel={() => {}}
        onRemoveChannel={() => {}}
        onSearchAll={() => {}}
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
function idFor(testId: string): number {
  const node = flatten(automationSchema.parse(JSON.parse(current().getAutomationTree()))).find(
    (node) => node.testId === testId,
  )
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
  checked: number
  baseline: Record<string, { x: number; width: number }>
}> = []
const values: Array<number | undefined> = [
  9,
  10,
  99,
  100,
  999,
  1000,
  61500,
  999949,
  999950,
  1000000,
  0,
  undefined,
]
try {
  await manager.start()
  await until(() => !!renderer, 'renderer')
  for (const width of [900, 420]) {
    await current().setWindowBounds({ width, height: 220 })
    const commit = commits
    state.set({ viewers: 9, unread: 9, mentions: 0, active: 'a' })
    await until(() => commits > commit, 'counter initial commit')
    await Bun.sleep(60)
    current().simulateMouseMove(20, 120)
    const testIds =
      width === 900
        ? ['tab-home', 'tab-a', 'tab-b', 'tab-c', 'tab-add']
        : ['tab-home', 'tab-a', 'tab-b']
    const baseline = Object.fromEntries(
      testIds.map((testId) => [testId, { x: bounds(testId).x, width: bounds(testId).width }]),
    )
    for (const [index, viewers] of values.entries()) {
      const previousCommit = commits
      state.set({
        viewers,
        unread: viewers ?? 0,
        mentions: index % 2 ? (viewers ?? 0) : 0,
        active: index % 2 ? 'b' : 'a',
      })
      await until(() => commits > previousCommit, 'counter commit')
      await until(
        () =>
          viewers === undefined ||
          current().getPaintedText().join(' ').includes(formatTabViewers(viewers)),
        'painted counter',
      )
      await Bun.sleep(35)
      for (const testId of testIds) {
        const actual = bounds(testId)
        const expected = baseline[testId]
        assert(expected)
        assert(Math.abs(actual.x - expected.x) < 0.01, `${testId} moved at ${viewers}`)
        assert(Math.abs(actual.width - expected.width) < 0.01, `${testId} resized at ${viewers}`)
      }
    }
    geometry.push({ width, checked: values.length, baseline })
    state.set({ viewers: 61500, unread: 1000, mentions: 999, active: 'a' })
    await Bun.sleep(80)
    screenshots.push(await captureGuiQaDisplay(`tab-counts-${width}`))
    if (width === 420) {
      current().scrollTo(idFor('channel-tab-bar'), -1000, 0)
      await Bun.sleep(80)
      assert(
        bounds('tab-c').width > 150,
        'Long channel label keeps its bounded title beside counters',
      )
      screenshots.push(await captureGuiQaDisplay('tab-counts-420-scrolled'))
    }
  }
  await Bun.write(
    join(session, 'tab-counts-result.json'),
    JSON.stringify({ ok: true, geometry, screenshots, lowRateControlledCheck: true }, null, 2),
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
