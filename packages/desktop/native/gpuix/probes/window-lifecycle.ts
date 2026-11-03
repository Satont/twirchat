import assert from 'node:assert/strict'
import { resolve } from 'node:path'

import { nativeArtifactName } from '../../../scripts/build-gpuix-native'
import { focusNativeQaWindow, getNativeQaWindowGeometry } from '../../../scripts/qa-x11'
import { assertGuiQaEnvironment } from '../../../src/services/gui-qa'
import { GPUIX_NATIVE_API_VERSION } from '../../../src/services/native-runtime'

assertGuiQaEnvironment()

interface Bounds {
  x: number
  y: number
  width: number
  height: number
  mode: string
}
interface Renderer {
  init(options: object): void
  getTwirNativeApiVersion(): number
  closeWindow(): void
  isWindowOpen(): boolean
  isWindowActive(): boolean
  getWindowBounds(): Bounds | null
  getWindowCapabilities(): { position: boolean; clickThrough: boolean }
  setWindowBounds(bounds: Partial<Bounds>): Promise<void>
  setClickThrough(enabled: boolean): Promise<void>
  runTextInputAction(action: string): Promise<boolean>
  applyBatch(json: string): number[]
  scrollToItem(id: number, index: number, offset?: number): void
  getListScrollTop(id: number): number[] | null
  getElementBounds(id: number): Bounds | null
  getPaintedText(): string[]
  focusElement(id: number): void
  simulateKeystrokes(keys: string): void
  getFocusedElementId(): number | null
  focusNext(): void
  blur(): void
  tick(): boolean
}
const addon: unknown = require(
  resolve(import.meta.dir, '../../../dist/native', nativeArtifactName()),
)
assert(addon && typeof addon === 'object' && 'GpuixRenderer' in addon)
const NativeConstructor = addon.GpuixRenderer
assert.equal(typeof NativeConstructor, 'function')
function isRenderer(value: unknown): value is Renderer {
  return (
    value !== null &&
    typeof value === 'object' &&
    [
      'init',
      'getTwirNativeApiVersion',
      'closeWindow',
      'isWindowOpen',
      'isWindowActive',
      'getWindowBounds',
      'getWindowCapabilities',
      'setWindowBounds',
      'setClickThrough',
      'runTextInputAction',
      'applyBatch',
      'scrollToItem',
      'getListScrollTop',
      'getElementBounds',
      'getPaintedText',
      'focusElement',
      'simulateKeystrokes',
      'getFocusedElementId',
      'focusNext',
      'blur',
      'tick',
    ].every((method) => typeof Reflect.get(value, method) === 'function')
  )
}
function createRenderer(
  callback: (
    error: unknown,
    event: { eventType: string; elementId: number; value?: string },
  ) => void,
): Renderer {
  assert.equal(typeof NativeConstructor, 'function')
  if (typeof NativeConstructor !== 'function')
    throw new Error('Native renderer constructor missing')
  const instance: unknown = Reflect.construct(NativeConstructor, [callback])
  assert(isRenderer(instance), 'Native renderer methods missing')
  return instance
}
const focusEvents: Array<{ id: number; type: string }> = []
const bFocusEvents: Array<{ id: number; type: string }> = []
const changes: string[] = []
const a = createRenderer((error, event) => {
  if (error) throw error
  if (event?.eventType === 'focus' || event?.eventType === 'blur')
    focusEvents.push({ id: event.elementId, type: event.eventType })
  if (event?.eventType === 'change' && event.elementId === 4 && event.value !== undefined)
    changes.push(event.value)
})
const b = createRenderer((error, event) => {
  if (error) throw error
  if (event?.eventType === 'focus' || event?.eventType === 'blur')
    bFocusEvents.push({ id: event.elementId, type: event.eventType })
})

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
function inputShapeRectCount(): number {
  const result = Bun.spawnSync(
    ['python3', resolve(import.meta.dir, 'x11-input-shape.py'), 'TwirChat native probe A'],
    { env: process.env },
  )
  assert.equal(result.exitCode, 0, result.stderr.toString())
  return Number(result.stdout.toString().trim())
}
function listTree(label: string, width: number): unknown[] {
  const batch: unknown[] = [
    ['createElement', 1, 'div'],
    ['setStyle', 1, { flexDirection: 'column', width: '100%', height: '100%' }],
    ['createElement', 2, 'virtual-list'],
    ['setStyle', 2, { width, height: 120 }],
    ['setCustomProp', 2, 'estimatedItemHeight', 24],
    ['appendChild', 1, 2],
    ['setRoot', 1],
  ]
  for (let index = 0; index < 100; index++) {
    const id = 10 + index * 2
    batch.push(
      ['createElement', id, 'div'],
      ['setStyle', id, { height: 24, width }],
      ['createElement', id + 1, 'text'],
      ['setText', id + 1, `${label} row ${index}`],
      ['appendChild', id, id + 1],
      ['appendChild', 2, id],
    )
  }
  return batch
}

try {
  assert.equal(a.getTwirNativeApiVersion(), GPUIX_NATIVE_API_VERSION)
  assert.equal(b.getTwirNativeApiVersion(), GPUIX_NATIVE_API_VERSION)
  assert.equal(a.isWindowOpen(), false)
  assert.equal(a.isWindowActive(), false)
  assert.equal(b.isWindowActive(), false)
  assert.equal(a.getWindowBounds(), null)
  a.init({ title: 'TwirChat native probe A', width: 420, height: 260, x: 10, y: 20, focus: false })
  b.init({
    title: 'TwirChat native probe B',
    width: 460,
    height: 300,
    x: 500,
    y: 20,
    focus: false,
    kind: 'floating',
  })
  a.applyBatch(JSON.stringify(listTree('alpha', 210)))
  b.applyBatch(JSON.stringify(listTree('beta', 310)))
  await until(() => !!a.getElementBounds(10) && !!b.getElementBounds(10), 'both windows painted')
  const rowA = a.getElementBounds(10)
  const rowB = b.getElementBounds(10)
  assert(rowA && rowB)
  assert.equal(rowA.width, 210)
  assert.equal(rowB.width, 310)
  assert(a.getPaintedText().some((text) => text.includes('alpha')))
  assert(b.getPaintedText().some((text) => text.includes('beta')))
  assert(!a.getPaintedText().some((text) => text.includes('beta')))
  assert(!b.getPaintedText().some((text) => text.includes('alpha')))

  const beforeB = b.getWindowBounds()
  assert(beforeB)
  await a.setWindowBounds({ width: 520, height: 340 })
  await until(
    () => a.getWindowBounds()?.width === 520 && a.getWindowBounds()?.height === 340,
    'observed client resize',
  )
  assert.equal(b.getWindowBounds()?.width, beforeB.width)
  if (a.getWindowCapabilities().position) {
    await a.setWindowBounds({ x: 60, y: 70 })
    await until(
      () => a.getWindowBounds()?.x === 60 && a.getWindowBounds()?.y === 70,
      'observed global move',
    )
  } else {
    await assert.rejects(a.setWindowBounds({ x: 60 }))
  }
  if (a.getWindowCapabilities().position) {
    await a.setWindowBounds({ x: 110, y: 130, width: 540, height: 360 })
    await until(
      () =>
        a.getWindowBounds()?.x === 110 &&
        a.getWindowBounds()?.y === 130 &&
        a.getWindowBounds()?.width === 540 &&
        a.getWindowBounds()?.height === 360,
      'combined native move and resize observed',
    )
    await b.setWindowBounds({ x: 650, y: 70, width: 480, height: 320 })
    await until(
      () =>
        b.getWindowBounds()?.x === 650 &&
        b.getWindowBounds()?.y === 70 &&
        b.getWindowBounds()?.width === 480 &&
        b.getWindowBounds()?.height === 320,
      'second window combined move and resize observed',
    )
    if (process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb') {
      const boundsA = a.getWindowBounds()
      const boundsB = b.getWindowBounds()
      assert(boundsA && boundsB)
      const { mode: modeA, ...cachedA } = boundsA
      const { mode: modeB, ...cachedB } = boundsB
      assert.equal(modeA, 'windowed')
      assert.equal(modeB, 'windowed')
      assert.deepEqual(
        cachedA,
        getNativeQaWindowGeometry('TwirChat native probe A'),
        'A cache matches actual X server geometry',
      )
      assert.deepEqual(
        cachedB,
        getNativeQaWindowGeometry('TwirChat native probe B'),
        'B cache matches actual X server geometry',
      )
    }
  }
  assert(a.getWindowCapabilities().clickThrough)
  await a.setClickThrough(true)
  if (process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb')
    assert.equal(inputShapeRectCount(), 0, 'empty native pointer region')
  await a.setClickThrough(false)
  if (process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb')
    assert(inputShapeRectCount() > 0, 'normal native pointer region restored')

  a.scrollToItem(2, 35, 0)
  await until(() => (a.getListScrollTop(2)?.[0] ?? 0) >= 34, 'window A scroll')
  assert.equal(b.getListScrollTop(2)?.[0], 0)
  b.scrollToItem(2, 65, 0)
  await until(() => (b.getListScrollTop(2)?.[0] ?? 0) >= 64, 'window B scroll')
  assert((a.getListScrollTop(2)?.[0] ?? 100) < 40)
  assert.equal(await a.runTextInputAction('undo'), false)
  assert.throws(() => a.runTextInputAction('invalid'))

  a.applyBatch(
    JSON.stringify([
      ['createElement', 3, 'div'],
      ['setStyle', 3, { width: 300, height: 60, flexShrink: 0 }],
      ['createElement', 4, 'input'],
      ['setStyle', 4, { width: 280, height: 32 }],
      ['setCustomProp', 4, 'value', 'alpha beta'],
      ['setEventListener', 4, 'change', true],
      ['setEventListener', 4, 'focus', true],
      ['setEventListener', 4, 'blur', true],
      ['appendChild', 3, 4],
      ['createElement', 5, 'text'],
      ['setText', 5, 'retained editor'],
      ['appendChild', 3, 5],
      ['appendChild', 1, 3],
      ['createElement', 7, 'div'],
      ['setStyle', 7, { height: 20, width: 200, flexShrink: 0 }],
      ['createElement', 8, 'text'],
      ['setText', 8, 'footer'],
      ['appendChild', 7, 8],
      ['appendChild', 1, 7],
    ]),
  )
  await until(() => !!a.getElementBounds(7), 'retained editor subtree painted')
  await focusNativeQaWindow('TwirChat native probe A')
  await until(() => a.isWindowActive(), 'A actual window activation cached')
  assert.equal(b.isWindowActive(), false)
  a.focusElement(4)
  await until(() => a.getFocusedElementId() === 4, 'native editor focus')
  await until(
    () => focusEvents.filter((event) => event.id === 4 && event.type === 'focus').length === 1,
    'first native input focus event',
  )
  a.focusElement(4)
  await Bun.sleep(30)
  assert.equal(
    focusEvents.filter((event) => event.id === 4 && event.type === 'focus').length,
    1,
    'same focus request emits once',
  )
  assert.equal(await a.runTextInputAction('copy'), false, 'empty editor selection cannot copy')
  assert.equal(await a.runTextInputAction('cut'), false, 'empty editor selection cannot cut')
  assert.equal(await a.runTextInputAction('cursorToEnd'), true)
  assert.equal(await a.runTextInputAction('selectWord'), true)
  assert.equal(await a.runTextInputAction('copy'), true, 'selected editor text actually copies')
  assert.equal(await a.runTextInputAction('cut'), true)
  await until(() => changes.at(-1) === 'alpha ', 'native word selection and cut')
  assert.equal(await a.runTextInputAction('undo'), true)
  await until(() => changes.at(-1) === 'alpha beta', 'native undo')
  assert.equal(await a.runTextInputAction('redo'), true)
  await until(() => changes.at(-1) === 'alpha ', 'native redo')
  assert.equal(await a.runTextInputAction('undo'), true)
  assert.equal(await a.runTextInputAction('selectAll'), true)
  a.simulateKeystrokes('d r a f t')
  await until(() => changes.at(-1) === 'draft', 'unsaved native draft')
  const footer = a.getElementBounds(7)
  assert(footer)
  const footerBefore = footer.y
  a.blur()
  a.applyBatch(
    JSON.stringify([['setStyle', 3, { display: 'none', width: 300, height: 60, flexShrink: 0 }]]),
  )
  await until(
    () => a.getElementBounds(7)?.y === footerBefore - 60,
    'hidden subtree takes no layout space',
  )
  assert(
    !a.getPaintedText().some((text) => text.includes('retained editor') || text.includes('draft')),
  )
  a.focusNext()
  await Bun.sleep(30)
  assert.notEqual(a.getFocusedElementId(), 4, 'hidden editor excluded from tab traversal')
  a.applyBatch(
    JSON.stringify([['setStyle', 3, { display: 'flex', width: 300, height: 60, flexShrink: 0 }]]),
  )
  await until(() => a.getElementBounds(7)?.y === footerBefore, 'restored subtree layout')
  assert(
    a.getPaintedText().some((text) => text.includes('draft')),
    'native draft survived hide/show',
  )
  a.focusElement(4)
  await until(() => a.getFocusedElementId() === 4, 'restored editor focus')
  assert.equal(await a.runTextInputAction('undo'), true)
  await until(() => changes.at(-1) !== 'draft', 'native undo history survived hide/show')
  if (changes.at(-1) !== 'alpha beta') {
    assert.equal(await a.runTextInputAction('undo'), true)
    await until(
      () => changes.at(-1) === 'alpha beta',
      'replacement undo history survived hide/show',
    )
  }

  const autoFocusInput = [
    ['createElement', 990, 'input'],
    ['setStyle', 990, { width: 200, height: 30 }],
    ['setCustomProp', 990, 'autoFocus', true],
    ['setEventListener', 990, 'focus', true],
    ['setEventListener', 990, 'blur', true],
    ['appendChild', 1, 990],
  ]
  a.applyBatch(JSON.stringify(autoFocusInput))
  await until(
    () => focusEvents.some((event) => event.id === 990 && event.type === 'focus'),
    'first mounted autoFocus event',
  )
  assert.equal(focusEvents.filter((event) => event.id === 990 && event.type === 'focus').length, 1)
  b.applyBatch(JSON.stringify(autoFocusInput))
  await until(() => b.getFocusedElementId() === 990, 'inactive window logical autofocus')
  assert.equal(bFocusEvents.length, 0, 'inactive window cannot report editor focus')
  await focusNativeQaWindow('TwirChat native probe B')
  await until(() => b.isWindowActive() && !a.isWindowActive(), 'active window cached independently')
  await until(
    () => bFocusEvents.some((event) => event.id === 990 && event.type === 'focus'),
    'second window activated focus',
  )
  assert.equal(focusEvents.filter((event) => event.id === 990 && event.type === 'blur').length, 1)
  await focusNativeQaWindow('TwirChat native probe A')
  await until(
    () => focusEvents.filter((event) => event.id === 990 && event.type === 'focus').length === 2,
    'first window reactivated focus',
  )
  assert.equal(bFocusEvents.filter((event) => event.id === 990 && event.type === 'blur').length, 1)

  const start = performance.now()
  for (let index = 0; index < 10000; index++) {
    a.getWindowBounds()
    b.isWindowOpen()
  }
  assert(
    performance.now() - start < 1000,
    'cached lifecycle/geometry must not block on UI round-trips',
  )
  a.closeWindow()
  const pending = Array.from({ length: 32 }, (_, index) => [
    a.setWindowBounds({ width: 301 + index }),
    a.setClickThrough(index % 2 === 0),
    a.runTextInputAction('copy'),
  ]).flat()
  const closeRace = await Promise.race([
    Promise.allSettled(pending).then((settled) => settled.length),
    Bun.sleep(1000).then(() => 'hung'),
  ])
  assert.equal(closeRace, 96, 'all queued native operations settle when a window closes')
  await until(() => !a.isWindowOpen(), 'A close event')
  assert(b.isWindowOpen(), 'B stays open after A closes')
  assert.equal(a.tick(), false)
  assert.equal(a.isWindowActive(), false)
  assert.equal(b.tick(), true)
  await assert.rejects(a.setWindowBounds({ width: 300 }))
  b.scrollToItem(2, 20, 0)
  await until(() => (b.getListScrollTop(2)?.[0] ?? 100) < 25, 'B remains usable')
  b.closeWindow()
  await until(() => !b.isWindowOpen(), 'B close event')
  assert.equal(b.isWindowActive(), false)
  console.log(
    JSON.stringify({
      result: 'pass',
      windows: 2,
      geometry: true,
      scrollIsolation: true,
      paintedTextIsolation: true,
      closeIsolation: true,
    }),
  )
} finally {
  a.closeWindow()
  b.closeWindow()
}
process.exit(0)
