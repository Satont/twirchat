if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')

import assert from 'node:assert/strict'
import { join } from 'node:path'

import { z } from 'zod'

const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()

const React = await import('react')
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import('@gpuix/react')
const { BackendContext } = await import('../src/gpuix/backend/context')
const { ChatAppearanceDialog } =
  await import('../src/gpuix/components/chat-settings/ChatAppearanceDialog')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { darkTheme } = await import('../src/gpuix/theme')
const { ThemeContext } = await import('../src/gpuix/theme-context')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')

const expectScroll = !process.argv.includes('--before')
const normalWidth = process.argv.includes('--normal')
const width = normalWidth ? 1000 : 680
const height = normalWidth ? 480 : 860
const sizeLabel = normalWidth ? 'normal' : 'narrow'

interface AutomationNode {
  id: number
  testId?: string
  text?: string
  children: AutomationNode[]
}

interface QaRenderer {
  getAutomationTree(): string
  getElementBounds(id: number): { x: number; y: number; width: number; height: number } | null
  getScrollOffset(id: number): readonly number[] | null
  simulateScrollWheel(x: number, y: number, deltaX: number, deltaY: number): void
}

const automationNodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    text: z.string().optional(),
    children: z.array(automationNodeSchema).default([]),
  }),
)

const backend = {
  events: { on: () => () => {} },
  api: {
    saveSettings: async () => {},
  },
}

const renderer = createRenderer()
renderer.init({
  title: 'TwirChat chat appearance QA',
  appId: process.env.TWIRCHAT_QA_APP_ID,
  focus: false,
  width,
  height,
})
const automation: QaRenderer = renderer
const root = createRoot(renderer)
startFrameLoop(renderer)

function tree(): AutomationNode | null {
  const parsed: unknown = JSON.parse(automation.getAutomationTree())
  if (parsed === null) return null
  return automationNodeSchema.parse(parsed)
}

function find(testId: string): AutomationNode | undefined {
  const root = tree()
  if (!root) return undefined
  const visit = (node: AutomationNode): AutomationNode | undefined => {
    if (node.testId === testId) return node
    for (const child of node.children) {
      const match = visit(child)
      if (match) return match
    }
    return undefined
  }
  return visit(root)
}

function requireNode(testId: string): AutomationNode {
  const node = find(testId)
  assert.ok(node, `Missing ${testId}`)
  return node
}

function box(testId: string): { x: number; y: number; width: number; height: number } {
  const bounds = automation.getElementBounds(requireNode(testId).id)
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `No visible bounds: ${testId}`)
  return bounds
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!check()) {
    assert.ok(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(25)
  }
}

async function scrollToBottom(): Promise<void> {
  const area = box('appearance-scroll')
  // Scroll over the settings column, not the preview: the preview has its own
  // chat scroller and would consume the wheel gesture instead of the dialog.
  const x = area.x + area.width - 160
  const y = area.y + area.height / 2
  for (let attempt = 0; attempt < 16; attempt++) {
    automation.simulateScrollWheel(x, y, 0, -300)
    await Bun.sleep(80)
  }
}

function insideViewport(
  testId: string,
  viewport: { x: number; y: number; height: number },
): boolean {
  const bounds = automation.getElementBounds(requireNode(testId).id)
  if (!bounds) return false
  return bounds.y >= viewport.y - 2 && bounds.y + bounds.height <= viewport.y + viewport.height + 2
}

root.render(
  React.createElement(
    BackendContext.Provider,
    { value: backend },
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(
        ThemeContext.Provider,
        { value: darkTheme },
        React.createElement(
          'div',
          {
            style: {
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#111114',
            },
          },
          React.createElement(ChatAppearanceDialog, {
            settings: structuredClone(DEFAULT_SETTINGS),
            onClose: () => {},
          }),
        ),
      ),
    ),
  ),
)

const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session, 'Missing isolated QA session directory')

try {
  await until(() => find('appearance-scroll') !== undefined, 'appearance dialog')
  await Bun.sleep(250)

  const scrollArea = requireNode('appearance-scroll')
  const viewport = box('appearance-scroll')
  const initialCard = automation.getElementBounds(requireNode('theme-modern').id)
  assert.ok(initialCard, 'Missing initial Layout card bounds')
  const rowLayout = initialCard.x > viewport.x + viewport.width / 2
  assert.equal(
    rowLayout,
    normalWidth,
    normalWidth ? 'Expected the normal-width row layout' : 'Expected the narrow column layout',
  )
  assert.ok(!insideViewport('theme-modern', viewport), 'Layout cards start inside the viewport')

  await scrollToBottom()

  const offset = automation.getScrollOffset(scrollArea.id)?.[1] ?? 0
  if (expectScroll) {
    assert.ok(offset < -10, `Appearance content did not scroll (offset ${offset})`)
    const cardBounds = automation.getElementBounds(requireNode('theme-modern').id)
    assert.ok(
      insideViewport('theme-modern', viewport),
      `Layout cards did not scroll into view (offset ${offset}, card ${JSON.stringify(cardBounds)}, viewport ${JSON.stringify(viewport)})`,
    )
    const screenshot = await captureGuiQaDisplay(`chat-appearance-${sizeLabel}-scrolled`)
    await Bun.write(
      join(session, 'chat-appearance-result.json'),
      JSON.stringify({ ok: true, width, height, layout: sizeLabel, offset, screenshot }, null, 2),
    )
  } else {
    assert.equal(offset, 0, `Appearance content scrolled without a scroll container (${offset})`)
    assert.ok(!insideViewport('theme-modern', viewport), 'Layout cards became reachable')
    const screenshot = await captureGuiQaDisplay(`chat-appearance-${sizeLabel}-clipped`)
    await Bun.write(
      join(session, 'chat-appearance-result.json'),
      JSON.stringify({ ok: true, width, height, layout: sizeLabel, offset, screenshot }, null, 2),
    )
  }

  console.log(expectScroll ? 'Chat appearance scroll QA passed.' : 'Clipped baseline captured.')
  process.exit(0)
} catch (error) {
  if (process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb')
    await captureGuiQaDisplay('chat-appearance-failure').catch(() => {})
  console.error(error)
  process.exit(1)
}
