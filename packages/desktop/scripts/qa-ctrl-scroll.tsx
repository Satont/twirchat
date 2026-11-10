if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { z } from 'zod'

const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const app = await import('../src/gpuix/state/app')
const { layoutStore } = await import('../src/gpuix/state/layout')
const { CHAT_FONT_SIZE_MAX, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_SAVE_DELAY_MS } =
  await import('../src/gpuix/state/chat-font-size')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { DEFAULT_TRANSLATION_SETTINGS } = await import('../src/services/translation')
const directory = process.env.TWIRCHAT_QA_SESSION_DIR
assert.ok(directory, 'Private QA artifact directory is required.')

const automationNodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    type: z.string().optional(),
    testId: z.string().optional(),
    text: z.string().optional(),
    children: z.array(automationNodeSchema).optional(),
  }),
)
interface AutomationNode {
  id: number
  type?: string
  testId?: string
  text?: string
  children?: AutomationNode[]
}

const channel = { id: 'qa', platform: 'kick', channelSlug: 'qa', displayName: 'QA', createdAt: 0 }
const layout = {
  version: 2,
  root: { type: 'panel', id: 'pane', flex: 100, content: { type: 'watched', channelId: 'qa' } },
}
const values = new Map<string, string>()
const layouts = new Map([['qa-tab', layout]])
const saved: unknown[] = []
const backend = {
  events: createDesktopEvents(),
  api: {
    getUiState: async ({ key }: { key: string }) => values.get(key) ?? null,
    setUiState: async ({ key, value }: { key: string; value: string }) => {
      values.set(key, value)
    },
    getWatchedChannelsLayout: async ({ tabId }: { tabId: string }) => layouts.get(tabId) ?? null,
    setWatchedChannelsLayout: async ({
      tabId,
      layout: next,
    }: {
      tabId: string
      layout: typeof layout
    }) => {
      layouts.set(tabId, next)
    },
    removeWatchedChannelsLayout: async ({ tabId }: { tabId: string }) => {
      layouts.delete(tabId)
    },
    getChannelEmotes: async () => [],
    getModerationCapabilities: async () => ({ canModerate: false }),
    getTranslationSettings: async () => ({
      settings: DEFAULT_TRANSLATION_SETTINGS,
      credentials: [],
    }),
    saveSettings: async (settings: unknown) => {
      saved.push(settings)
    },
    notify: async () => {},
    openExternalUrl: async () => {},
  },
}
let renderer: ReturnType<typeof useGpuixRequired> | undefined
const stopMessages = app.wireBackendToStores(backend)

function Content() {
  const current = useGpuixRequired()
  React.useEffect(() => {
    renderer = current
  }, [current])
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

function nodes(node = parseTree()): AutomationNode[] {
  return [node, ...(node.children ?? []).flatMap((child) => nodes(child))]
}
function parseTree(): AutomationNode {
  if (!renderer) throw new Error('The native renderer is not ready.')
  return automationNodeSchema.parse(JSON.parse(renderer.getAutomationTree()))
}
function find(testId: string): AutomationNode | undefined {
  return nodes().find((node) => node.testId === testId)
}
function findByType(type: string): AutomationNode | undefined {
  return nodes().find((node) => node.type === type)
}
function bounds(testId: string) {
  const node = find(testId)
  assert.ok(node, `Missing ${testId}`)
  assert.ok(renderer, 'The native renderer is not ready.')
  const box = renderer.getElementBounds(node.id)
  assert.ok(box, `Missing painted bounds for ${testId}`)
  return box
}
async function until(check: () => boolean, label: string, timeout = 5000): Promise<void> {
  const end = performance.now() + timeout
  while (performance.now() < end) {
    if (check()) return
    // eslint-disable-next-line no-await-in-loop -- The wait loop polls one condition.
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
function fontSize(): number {
  const settings = app.settingsStore.get()
  assert.ok(settings, 'Settings are not loaded.')
  return settings.fontSize
}
async function wheel(deltaY: number, modifiers?: string) {
  const viewport = bounds('chat-messages')
  assert.ok(renderer, 'The native renderer is not ready.')
  const x = viewport.x + viewport.width / 2
  const y = viewport.y + viewport.height / 2
  renderer.simulateMouseMove(x, y)
  await Bun.sleep(20)
  renderer.simulateScrollWheel(x, y, 0, deltaY, modifiers)
  await Bun.sleep(80)
}
async function settleSave() {
  await Bun.sleep(CHAT_FONT_SIZE_SAVE_DELAY_MS + 120)
}
async function returnToTail() {
  const pill = find('scroll-to-latest')
  if (!pill) return
  assert.ok(renderer, 'The native renderer is not ready.')
  const box = renderer.getElementBounds(pill.id)
  assert.ok(box, 'Missing painted bounds for scroll-to-latest')
  renderer.simulateMouseDown(box.x + box.width / 2, box.y + box.height / 2, 0)
  renderer.simulateMouseUp(box.x + box.width / 2, box.y + box.height / 2, 0)
  await until(() => !find('scroll-to-latest'), 'returning to the tail')
  // Let the settled range snapshot observe the tail before the next gesture.
  await Bun.sleep(160)
}

try {
  app.settingsStore.set({ ...DEFAULT_SETTINGS, showAvatars: false, showBadges: false })
  app.accountsStore.set([])
  app.watchedChannelsStore.set([channel])
  app.watchedStatusesStore.set(
    new Map([['qa', { platform: 'kick', status: 'connected', mode: 'authenticated' }]]),
  )
  layoutStore.set(new Map([['qa-tab', { layout, isLoading: false, error: null }]]))
  await manager.start()
  await until(() => !!find('chat-messages'), 'chat pane')
  for (let index = 0; index < 200; index++) {
    backend.events.emit('watched_channel_message', {
      channelId: 'qa',
      message: {
        id: `qa-${index}`,
        platform: 'kick',
        channelId: 'qa',
        type: 'message',
        timestamp: new Date(Date.now() + index),
        text: `QA_ROW_${String(index).padStart(3, '0')}`,
        author: { id: 'viewer', username: 'viewer', displayName: 'Viewer', badges: [] },
        emotes: [],
      },
    })
  }
  await until(() => nodes().some((node) => node.text === 'QA_ROW_199'), 'newest message painted')
  await Bun.sleep(120)

  assert.equal(fontSize(), DEFAULT_SETTINGS.fontSize, 'starts on the default size')
  await wheel(120, 'ctrl')
  await until(() => fontSize() === DEFAULT_SETTINGS.fontSize + 1, 'Ctrl+wheel up grows the font')
  await settleSave()
  assert.equal(saved.length, 1, 'the gesture persists once')
  const persisted = app.settingsStore.get()
  assert.ok(persisted, 'Settings are not loaded.')
  assert.deepEqual(saved[0], persisted, 'the persisted snapshot is the current one')
  await until(() => !find('scroll-to-latest'), 'growing the font at the tail keeps the list pinned')

  const beforePlain = fontSize()
  await wheel(120)
  await wheel(-120)
  assert.equal(fontSize(), beforePlain, 'a plain wheel does not resize the font')
  await returnToTail()

  app.settingsStore.set({ ...persisted, fontSize: CHAT_FONT_SIZE_MAX })
  await Bun.sleep(120)
  await wheel(120, 'ctrl')
  await Bun.sleep(160)
  assert.equal(fontSize(), CHAT_FONT_SIZE_MAX, 'the gesture stops at the maximum')
  assert.equal(find('scroll-to-latest'), undefined, 'a bound keeps the tail pinned')

  app.settingsStore.set({ ...persisted, fontSize: CHAT_FONT_SIZE_MIN })
  await wheel(-120, 'ctrl')
  await Bun.sleep(160)
  assert.equal(fontSize(), CHAT_FONT_SIZE_MIN, 'the gesture stops at the minimum')
  assert.equal(find('scroll-to-latest'), undefined, 'the minimum keeps the tail pinned')

  app.settingsStore.set({ ...persisted, fontSize: DEFAULT_SETTINGS.fontSize })
  await Bun.sleep(120)
  for (let index = 0; index < 3; index++) {
    // eslint-disable-next-line no-await-in-loop -- Each wheel tick needs its own frame.
    await wheel(120)
  }
  await until(() => !!find('scroll-to-latest'), 'scrolling up leaves the tail')
  // The pre-gesture range settles a moment after the last plain tick.
  await Bun.sleep(160)
  assert.ok(renderer, 'The native renderer is not ready.')
  const list = findByType('virtual-list')
  assert.ok(list, 'Missing virtual-list')
  const anchorBefore = renderer.getListScrollTop(list.id)
  assert.ok(anchorBefore, 'Virtual list anchor is available')
  await wheel(120, 'ctrl')
  await until(
    () => fontSize() === DEFAULT_SETTINGS.fontSize + 1,
    'Ctrl+wheel up while reading history grows the font',
  )
  await Bun.sleep(160)
  const anchorAfter = renderer.getListScrollTop(list.id)
  assert.ok(anchorAfter, 'Virtual list anchor is available after resizing')
  assert.equal(anchorAfter[0], anchorBefore[0], 'the reader stays on the same row')

  assert.ok(find('scroll-to-latest'), 'the reader still sees the tail pill')
  await returnToTail()
  assert.ok(renderer, 'The native renderer is not ready.')
  const native = renderer
  // Leaving the tail for the instant the list scrolls natively would expand the
  // whole feed and rebuild every retained row.
  const baselineTree = native.getAutomationTree().length
  let largestTree = baselineTree
  let sampling = true
  const sampler = (async () => {
    while (sampling) {
      largestTree = Math.max(largestTree, native.getAutomationTree().length)
      // eslint-disable-next-line no-await-in-loop -- Sample one frame at a time.
      await Bun.sleep(5)
    }
  })()
  await wheel(120, 'ctrl')
  await until(
    () => fontSize() === DEFAULT_SETTINGS.fontSize + 2,
    'Ctrl+wheel up at the tail grows the font again',
  )
  await Bun.sleep(220)
  sampling = false
  await sampler
  assert.ok(
    largestTree < baselineTree * 2,
    `Ctrl+wheel at the tail must not expand the history (${baselineTree} -> ${largestTree})`,
  )
  assert.equal(
    find('scroll-to-latest'),
    undefined,
    'the tail does not show the pill after resizing',
  )

  await settleSave()
  assert.deepEqual(saved.at(-1), app.settingsStore.get(), 'the last gesture is persisted')
  await Bun.write(
    join(directory, 'ctrl-scroll-result.json'),
    JSON.stringify(
      {
        ok: true,
        saves: saved.length,
        fontSize: fontSize(),
        treeBaseline: baselineTree,
        treePeak: largestTree,
      },
      null,
      2,
    ),
  )
  console.log('Ctrl+wheel font resize QA passed.')
} catch (error) {
  const viewport = renderer ? find('chat-messages') : undefined
  const box = viewport && renderer ? renderer.getElementBounds(viewport.id) : undefined
  await Bun.write(
    join(directory, 'ctrl-scroll-debug.json'),
    JSON.stringify(
      {
        error: String(error),
        fontSize: app.settingsStore.get()?.fontSize,
        box,
        hits:
          box && renderer
            ? renderer.getElementsAt(box.x + box.width / 2, box.y + box.height / 2)
            : null,
        tree: renderer ? JSON.parse(renderer.getAutomationTree()) : null,
        painted: renderer?.getPaintedText(),
        saved,
      },
      null,
      2,
    ),
  )
  console.error(error)
  process.exitCode = 1
} finally {
  stopMessages()
  await manager.quit()
  await Bun.sleep(100)
  process.exit(process.exitCode ?? 0)
}
