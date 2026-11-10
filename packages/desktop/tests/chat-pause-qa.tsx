if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use qa:gui for this native fixture.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'

import { z } from 'zod'

import type { DesktopBackend } from '../src/gpuix/backend/server'
import type { ChatPausePreferences } from '../src/services/chat-pause'
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import('@gpuix/react')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { BackendContext } = await import('../src/gpuix/backend/context')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { ChatPauseSettings } =
  await import('../src/gpuix/components/chat-settings/ChatPauseSettings')
const { focusNativeQaWindow } = await import('../scripts/qa-x11')
const { createDesktopApi } = await import('../src/gpuix/backend/api')
const { ChatAggregator } = await import('../src/chat/aggregator')
const { BackendConnection } = await import('../src/backend-connection')
const { WatchedChannelManager } = await import('../src/watched-channels/manager')
const { validateChatPausePreferences } = await import('../src/services/chat-pause')
const events = createDesktopEvents()
const api = createDesktopApi({
  events,
  aggregator: new ChatAggregator(),
  backendConn: new BackendConnection('isolated-pause-qa'),
  watchedChannelManager: new WatchedChannelManager(),
  currentStatuses: new Map(),
  openBrowser() {
    throw new Error('Pause QA must not open external applications.')
  },
})
let durable: ChatPausePreferences = {
  hoverSeconds: 3,
  modifier: 'ctrl+shift',
  doubleClickLinks: false,
}
let fail = true
const writes: ChatPausePreferences[] = []
const backend: DesktopBackend = {
  events,
  api: {
    ...api,
    getUiState: async ({ key }) => {
      assert.equal(key, 'ui.chatPause')
      return JSON.stringify(durable)
    },
    setUiState: async ({ key, value }) => {
      assert.equal(key, 'ui.chatPause')
      const parsed = validateChatPausePreferences(JSON.parse(value))
      writes.push(parsed)
      if (fail) throw new Error('QA pause save failed')
      durable = parsed
    },
  },
}
const renderer = createRenderer()
initializeManagedRenderer(renderer, {
  title: 'TwirChat pause QA',
  appId: process.env.TWIRCHAT_QA_APP_ID,
  focus: false,
  width: 760,
  height: 840,
})
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)
root.render(
  React.createElement(
    BackendContext.Provider,
    { value: backend },
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(
        'div',
        { style: { width: '100%', height: '100%', padding: 18, backgroundColor: '#111114' } },
        React.createElement(ChatPauseSettings),
      ),
    ),
  ),
)
interface QaNode {
  id: number
  testId?: string
  children: QaNode[]
}
const qaNodeSchema: z.ZodType<QaNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    children: z
      .array(qaNodeSchema)
      .nullish()
      .transform((children) => children ?? []),
  }),
)
function nodes(
  node: QaNode = qaNodeSchema.parse(JSON.parse(renderer.getAutomationTree())),
): QaNode[] {
  return [node, ...node.children.flatMap((child) => nodes(child))]
}
function find(testId: string) {
  const found = nodes().find((candidate) => candidate.testId === testId)
  assert(found, `Missing ${testId}`)
  return found
}
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
async function click(testId: string) {
  const bounds = renderer.getElementBounds(find(testId).id)
  assert(bounds)
  renderer.simulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)
  await Bun.sleep(80)
}
async function focus(testId: string) {
  const id = find(testId).id
  renderer.focusElement(id)
  await until(() => renderer.getFocusedElementId() === id, `${testId} focused`)
  await Bun.sleep(40)
}
try {
  await focusNativeQaWindow('TwirChat pause QA')
  await until(
    () => nodes().some((node) => node.testId === 'pause-hover-seconds'),
    'saved pause settings hydrated',
  )
  await click('pause-hover-inside')
  await click('save-chat-pause')
  await until(
    () => renderer.getAllText().join(' ').includes('QA pause save failed'),
    'save failure surfaced',
  )
  assert.equal(durable.hoverSeconds, 3, 'failed save leaves durable settings intact')
  fail = false
  await click('save-chat-pause')
  await until(() => durable.hoverSeconds === -1, 'retry saves failed draft')
  await click('pause-hover-timed')
  await focus('pause-hover-seconds')
  renderer.simulateKeystrokes('ctrl-a 2')
  await click('save-chat-pause')
  await until(() => durable.hoverSeconds === 2, 'seconds save')
  renderer.simulateKeystrokes('.')
  await Bun.sleep(100)
  renderer.simulateKeystrokes('5')
  await click('save-chat-pause')
  await until(() => durable.hoverSeconds === 2.5, 'fractional duration save')
  const count = writes.length
  renderer.simulateKeystrokes('ctrl-a minus')
  await until(
    () => renderer.getAllText().join(' ').includes('Timed hover pause must'),
    'invalid duration shown',
  )
  await click('save-chat-pause')
  assert.equal(writes.length, count, 'invalid draft never reaches storage')
  assert.equal(durable.hoverSeconds, 2.5)
  renderer.simulateKeystrokes('ctrl-a 1')
  await click('save-chat-pause')
  await until(() => durable.hoverSeconds === 1, 'repaired duration save')
  await focus('pause-modifier-alt')
  renderer.simulateKeystrokes('space')
  await click('save-chat-pause')
  await until(() => durable.modifier === 'ctrl+alt+shift', 'modifier combination keyboard toggle')
  await focus('pause-double-click')
  renderer.simulateKeystrokes('enter')
  await click('save-chat-pause')
  await until(() => durable.doubleClickLinks, 'double-click setting keyboard toggle')
  assert(renderer.getAllText().join(' ').includes('Saved'))
  console.log(
    JSON.stringify({
      result: 'pass',
      autosave: false,
      retry: true,
      fractionalInput: true,
      invalidDraftPreserved: true,
      keyboardControls: true,
    }),
  )
} finally {
  root.unmount()
  loop.stop()
  nativeWindow(renderer).closeWindow()
}
process.exit(0)
