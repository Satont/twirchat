import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { z } from 'zod'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { captureGuiQaDisplay } from '../src/services/gui-qa-screenshot'
import { benchmarkProvenanceSchema } from './bench-metrics'
import { focusNativeQaWindow } from './qa-x11'

assertGuiQaEnvironment()
assert.equal(process.env.TWIRCHAT_QA_COMPOSITOR, 'xvfb')
await import('../src/gpuix/native-bootstrap')
const { createRenderer, createRoot, startFrameLoop } = await import('@gpuix/react')
const { registerBundledFonts } = await import('../src/gpuix/fonts')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { Text } = await import('../src/gpuix/components/ui/Text')
const session = z.string().min(1).parse(process.env.TWIRCHAT_QA_SESSION_DIR)
const provenance = benchmarkProvenanceSchema.parse(JSON.parse(process.argv[2] ?? '{}'))
const title = 'TwirChat text rendering QA'
const boundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
interface AutomationNode {
  id: number
  type: string
  testId?: string
  text?: string
  bounds?: z.infer<typeof boundsSchema>
  children: AutomationNode[]
}
const nodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    type: z.string(),
    testId: z.string().optional(),
    text: z.string().optional(),
    bounds: boundsSchema.optional(),
    children: z.array(nodeSchema).default([]),
  }),
)
const renderer = createRenderer()
initializeManagedRenderer(renderer, {
  title,
  appId: process.env.TWIRCHAT_QA_APP_ID,
  width: 720,
  height: 880,
  focus: false,
})
registerBundledFonts(renderer)
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)
let pasted = ''
const links: string[] = []
const singleWord = 'Ordinary'
const mixed = ['Alpha ', 'βета ', '42', ' tail']
const wrap = 'Wrapping preserves measured widths, punctuation, Привет and multiple visual lines.'
const highlight = 'Привет 🌍'
root.render(
  <div
    testId="fixture"
    style={{
      width: '100%',
      height: '100%',
      padding: 20,
      gap: 10,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#12141c',
      fontFamily: 'Inter',
      fontSize: 20,
      color: '#e0e7ff',
    }}
  >
    <Text testId="single" style={{ color: '#e0e7ff' }}>
      {singleWord}
    </Text>
    <Text testId="mixed" style={{ color: '#e0e7ff' }}>
      {mixed[0]}
      {mixed[1]}
      {42}
      {mixed[3]}
    </Text>
    <div testId="inherited" style={{ fontFamily: 'Manrope', fontSize: 23, color: '#5ee8b7' }}>
      {'Inherited '}
      {'цвет и шрифт'}
    </div>
    <Text testId="wrapped" style={{ width: '100%', color: '#e0e7ff' }}>
      {wrap}
    </Text>
    <Text
      testId="ellipsis"
      style={{
        width: 180,
        height: 32,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: '#e0e7ff',
      }}
    >
      A constrained line should end with an ellipsis and stay on one row.
    </Text>
    <text
      testId="highlight"
      highlight={{ query: highlight, color: '#b88720' }}
      style={{ fontFamily: 'Inter', fontSize: 20, color: '#e0e7ff' }}
    >
      {'Prefix '}
      {'Привет '}
      {'🌍'}
      {' suffix'}
    </text>
    <div testId="selection" style={{ display: 'flex', flexDirection: 'row', userSelect: 'text' }}>
      <Text testId="selection-a" style={{ color: '#e0e7ff' }}>
        Alpha{' '}
      </Text>
      <Text testId="selection-b" style={{ color: '#e0e7ff' }}>
        {'βета '}
        {42}
        {' tail'}
      </Text>
    </div>
    <div style={{ userSelect: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Text testId="forbidden" style={{ color: '#fda4af' }}>
        Not selectable
      </Text>
      <div style={{ userSelect: 'text' }}>
        <Text testId="island" style={{ color: '#e0e7ff' }}>
          Selectable island
        </Text>
      </div>
    </div>
    <markdown
      testId="link"
      source="[Native link](https://example.invalid/text-qa)"
      onLinkClick={(event) => links.push(event.value ?? '')}
      style={{ fontFamily: 'Inter', fontSize: 20, color: '#93c5fd' }}
    />
    <textarea
      testId="paste-target"
      placeholder="Clipboard verification"
      onChange={(event) => {
        pasted = event.value ?? ''
      }}
      style={{ width: '100%', height: 50, fontSize: 18 }}
    />
  </div>,
)
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 6000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(20)
  }
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function tree(): AutomationNode {
  return nodeSchema.parse(JSON.parse(renderer.getAutomationTree()))
}
function find(testId: string): AutomationNode {
  const node = flatten(tree()).find((entry) => entry.testId === testId)
  assert(node?.bounds, `Missing painted ${testId}`)
  return node
}
function findBounds(testId: string) {
  const result = find(testId).bounds
  assert(result)
  return result
}
async function drag(testId: string) {
  renderer.clearSelection()
  const leaves = flatten(find(testId)).filter(
    (node) => node.text && node.bounds && node.children.length === 0,
  )
  const first = leaves[0]?.bounds ?? findBounds(testId)
  const last = leaves.at(-1)?.bounds ?? first
  const start = { x: first.x + 0.1, y: first.y + first.height / 2 }
  const end = { x: last.x + last.width + 1, y: last.y + last.height / 2 }
  renderer.simulateMouseDown(start.x, start.y, 0)
  for (let step = 1; step <= 12; step++) {
    renderer.simulateMouseMove(
      start.x + ((end.x - start.x) * step) / 12,
      start.y + ((end.y - start.y) * step) / 12,
      0,
    )
    await Bun.sleep(12)
  }
  renderer.simulateMouseUp(end.x, end.y, 0)
  await Bun.sleep(100)
  return renderer.getSelectedText()
}
function geometrySnapshot() {
  return flatten(tree()).map(({ id, type, testId, text, bounds }) => ({
    id,
    type,
    testId,
    text,
    bounds,
  }))
}
async function geometry() {
  let previous = geometrySnapshot()
  for (let attempt = 0; attempt < 10; attempt++) {
    await Bun.sleep(60)
    const next = geometrySnapshot()
    if (JSON.stringify(previous) === JSON.stringify(next)) return next
    previous = next
  }
  throw new Error('Text geometry never stabilized.')
}
const snapshots: unknown[] = []
try {
  await focusNativeQaWindow(title)
  await until(() => renderer.getPaintedText().includes(singleWord), 'ordinary text paint')
  for (const size of [
    { width: 720, height: 880 },
    { width: 360, height: 880 },
  ]) {
    await nativeWindow(renderer).setWindowBounds(size)
    await until(
      () => nativeWindow(renderer).getWindowBounds()?.width === size.width,
      'window resize',
    )
    renderer.clearSelection()
    renderer.simulateMouseMove(0, 0)
    const layout = await geometry()
    const paintedText = renderer.getPaintedText()
    assert(paintedText.some((text) => text.includes('βета')))
    assert(paintedText.some((text) => text.includes('Привет')))
    const highlights = renderer.getPaintedHighlights()
    assert.equal(
      highlights.map((match) => match.text.slice(match.start, match.end)).join(''),
      highlight,
    )
    assert(
      highlights.every(
        (match) =>
          match.rects.length > 0 && match.rects.every((rect) => rect.width > 0 && rect.height > 0),
      ),
    )
    const screenshot = await captureGuiQaDisplay(`text-${size.width}`)
    const selected = await drag('selection')
    assert.equal(selected?.replace(/\s+/gu, ' ').trim(), mixed.join('').trim())
    renderer.simulateKeystrokes('ctrl-c')
    await Bun.sleep(80)
    assert.equal(renderer.getSelectedText(), selected, 'Copy must preserve selection.')
    const target = find('paste-target')
    pasted = ''
    renderer.focusElement(target.id)
    renderer.simulateKeystrokes('ctrl-a backspace ctrl-v')
    await until(() => pasted === selected, 'native copy/paste round trip')
    const forbidden = await drag('forbidden')
    assert.equal(forbidden, null, 'userSelect none must exclude text.')
    const island = await drag('island')
    assert.equal(island?.trim(), 'Selectable island')
    renderer.clearSelection()
    const link = findBounds('link')
    const beforeClick = links.length
    renderer.simulateClick(link.x + 8, link.y + link.height / 2)
    await until(() => links.length > beforeClick, 'native markdown link click')
    assert.equal(links.at(-1), 'https://example.invalid/text-qa')
    const beforeDrag = links.length
    const linkSelection = await drag('link')
    assert.equal(links.length, beforeDrag, 'Dragging a native link must not activate it.')
    const accessibilityGetter: unknown = Reflect.get(renderer, 'getA11yTree')
    let accessibility: unknown = {
      available: false,
      reason: 'Production GpuixRenderer exposes no accessibility dump.',
    }
    if (typeof accessibilityGetter === 'function') {
      const raw: unknown = Reflect.apply(accessibilityGetter, renderer, [])
      accessibility = JSON.parse(z.string().parse(raw))
    }
    snapshots.push({
      size,
      layout,
      paintedText,
      highlights,
      screenshot,
      selected,
      pasted,
      forbidden,
      island,
      linkSelection,
      links: [...links],
      accessibility,
    })
    renderer.clearSelection()
    const input = findBounds('paste-target')
    renderer.simulateClick(input.x + 5, input.y + input.height / 2)
    renderer.simulateKeystrokes('ctrl-a backspace')
    renderer.blur()
  }
  const result = {
    ok: true,
    provenance,
    scriptSha256: createHash('sha256')
      .update(await Bun.file(import.meta.path).bytes())
      .digest('hex'),
    nativeManifest: await Bun.file(
      join(import.meta.dir, '../dist/native/gpuix.linux-x64.node.json'),
    ).json(),
    snapshots,
  }
  const path = join(session, 'text-rendering-result.json')
  await Bun.write(path, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ok: true, result: path }))
} catch (error) {
  await Bun.write(
    join(session, 'text-rendering-error.json'),
    JSON.stringify(
      {
        error: String(error),
        snapshots,
        tree: tree(),
        paintedText: renderer.getPaintedText(),
        highlights: renderer.getPaintedHighlights(),
        selected: renderer.getSelectedText(),
        pasted,
        links,
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  root.unmount()
  loop.stop()
  nativeWindow(renderer).closeWindow()
}
