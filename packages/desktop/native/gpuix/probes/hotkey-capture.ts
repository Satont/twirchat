import assert from 'node:assert/strict'
import { resolve } from 'node:path'

import { nativeArtifactName } from '../../../scripts/build-gpuix-native'
import { focusNativeQaWindow } from '../../../scripts/qa-x11'
import { assertGuiQaEnvironment } from '../../../src/services/gui-qa'
import { GPUIX_NATIVE_API_VERSION } from '../../../src/services/native-runtime'

assertGuiQaEnvironment()
interface NativeEvent {
  elementId: number
  eventType: string
  key?: string
  isHeld?: boolean
  value?: string
  modifiers?: { ctrl?: boolean; alt?: boolean; shift?: boolean; cmd?: boolean }
  keystrokeId?: number
  hotkeyGeneration?: number
  hotkeyBindingId?: string
  hotkeyContextId?: string
  hotkeyPrefix?: boolean
  hotkeyRecorded?: boolean
}
interface Binding {
  id: string
  contextId: string
  keys: string[]
}
interface Renderer {
  init(options: object): void
  getTwirNativeApiVersion(): number
  applyBatch(json: string): number[]
  setWindowKeyEvents(down: boolean, up: boolean, id: number): void
  setHotkeyPlan(json: string): void
  runTextInputAction(name: string): Promise<boolean>
  focusElement(id: number): void
  getFocusedElementId(): number | null
  getElementBounds(id: number): object | null
  simulateKeystrokes(keys: string): void
  simulateKeyDown(key: string, held?: boolean): void
  closeWindow(): void
  isWindowOpen(): boolean
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
      'applyBatch',
      'setWindowKeyEvents',
      'setHotkeyPlan',
      'runTextInputAction',
      'focusElement',
      'getFocusedElementId',
      'getElementBounds',
      'simulateKeystrokes',
      'simulateKeyDown',
      'closeWindow',
      'isWindowOpen',
    ].every((method) => typeof Reflect.get(value, method) === 'function')
  )
}
function createRenderer(callback: (error: unknown, event: NativeEvent) => void): Renderer {
  assert.equal(typeof NativeConstructor, 'function')
  if (typeof NativeConstructor !== 'function')
    throw new Error('Native renderer constructor missing')
  const instance: unknown = Reflect.construct(NativeConstructor, [callback])
  assert(isRenderer(instance), 'Native renderer methods missing')
  return instance
}
const eventsA: NativeEvent[] = []
const eventsB: NativeEvent[] = []
let textA = 'alpha beta'
let textB = 'alpha beta'
const a = createRenderer((error, event) => {
  if (error) throw error
  eventsA.push(event)
  if (event.eventType === 'change') textA = event.value ?? ''
})
const b = createRenderer((error, event) => {
  if (error) throw error
  eventsB.push(event)
  if (event.eventType === 'change') textB = event.value ?? ''
})
let generation = 0
function publish(renderer: Renderer, bindings: Binding[] = [], recordAll = false): number {
  const current = ++generation
  renderer.setHotkeyPlan(JSON.stringify({ generation: current, bindings, recordAll }))
  return current
}
const reserved = [{ id: 'emotes', contextId: 'input:a', keys: ['ctrl+right'] }]
const sequence = [{ id: 'sequence', contextId: 'input:a', keys: ['ctrl+k', 'x'] }]
const capturedA = () => eventsA.filter((event) => Number.isSafeInteger(event.hotkeyGeneration))
const capturedB = () => eventsB.filter((event) => Number.isSafeInteger(event.hotkeyGeneration))
function captured(index: number): NativeEvent {
  const event = capturedA().at(index)
  assert(event, `Missing captured event ${index}`)
  return event
}
function dispatchId(index: number): number {
  const id = captured(index).keystrokeId
  assert.equal(typeof id, 'number')
  if (typeof id !== 'number') throw new Error('Native dispatch ID missing')
  return id
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
async function reset(renderer: Renderer, windowName: string): Promise<void> {
  publish(renderer)
  await focusNativeQaWindow(windowName)
  renderer.focusElement(2)
  await until(() => renderer.getFocusedElementId() === 2, `${windowName} editor focus`)
  assert.equal(await renderer.runTextInputAction('selectAll'), true)
  renderer.simulateKeystrokes('a l p h a space b e t a')
  await until(() => (renderer === a ? textA : textB) === 'alpha beta', 'native editor reset')
  assert.equal(await renderer.runTextInputAction('cursorToStart'), true)
  await Bun.sleep(30)
  ;(renderer === a ? eventsA : eventsB).length = 0
}
function mount(renderer: Renderer, title: string, rootEventId: number): void {
  assert.equal(renderer.getTwirNativeApiVersion(), GPUIX_NATIVE_API_VERSION)
  renderer.init({
    title,
    width: 480,
    height: 200,
    focus: false,
    appId: process.env.TWIRCHAT_QA_APP_ID,
  })
  renderer.applyBatch(
    JSON.stringify([
      ['createElement', 1, 'div'],
      ['setStyle', 1, { width: '100%', height: '100%', padding: 20 }],
      ['createElement', 2, 'input'],
      ['setStyle', 2, { width: 400, height: 40 }],
      ['setCustomProp', 2, 'value', 'alpha beta'],
      ['setEventListener', 2, 'change', true],
      ['setEventListener', 2, 'keyDown', true],
      ['appendChild', 1, 2],
      ['setRoot', 1],
    ]),
  )
  renderer.setWindowKeyEvents(true, false, rootEventId)
}
try {
  mount(a, 'TwirChat hotkey A', 55)
  mount(b, 'TwirChat hotkey B', 66)
  await until(() => !!a.getElementBounds(2) && !!b.getElementBounds(2), 'both editors painted')

  await reset(a, 'TwirChat hotkey A')
  const first = publish(a, reserved)
  a.simulateKeystrokes('ctrl-right z')
  await until(
    () => capturedA().length === 1 && textA === 'zalpha beta',
    'custom CtrlRight overrides native WordRight',
  )
  assert.equal(captured(0).elementId, 55)
  assert.equal(captured(0).eventType, 'windowKeyDown')
  assert.equal(captured(0).hotkeyBindingId, 'emotes')
  assert.equal(captured(0).hotkeyContextId, 'input:a')
  assert.equal(captured(0).hotkeyGeneration, first)
  assert.equal(captured(0).key, 'right')
  assert.equal(captured(0).modifiers?.ctrl, true)
  assert.equal(captured(0).isHeld, false)
  assert(Number.isSafeInteger(captured(0).keystrokeId))

  await reset(a, 'TwirChat hotkey A')
  a.simulateKeystrokes('ctrl-right z')
  await until(
    () => textA.includes('z') && textA !== 'alpha beta',
    'unavailable binding preserves native WordRight',
  )
  assert(!textA.startsWith('z'), 'native cursor moved when no custom binding was available')
  assert.equal(capturedA().length, 0)

  await reset(a, 'TwirChat hotkey A')
  publish(a, sequence)
  a.simulateKeystrokes('ctrl-k x')
  await until(
    () => capturedA().length === 2,
    'fast sequence captures unmodified next chord without JS acknowledgement',
  )
  assert.equal(textA, 'alpha beta')
  assert.equal(captured(0).hotkeyPrefix, true)
  assert.equal(captured(0).hotkeyBindingId, undefined)
  assert.equal(captured(1).hotkeyPrefix, false)
  assert.equal(captured(1).hotkeyBindingId, 'sequence')
  assert(dispatchId(1) > dispatchId(0))

  await reset(a, 'TwirChat hotkey A')
  publish(a, sequence)
  a.simulateKeystrokes('ctrl-k ctrl-right x')
  await until(() => textA.includes('x'), 'unmatched reserved key resumes native editing')
  assert(!textA.startsWith('x'), 'unmatched WordRight ran natively')
  assert.equal(
    capturedA().length,
    1,
    'old sequence cannot consume x after a native unmatched chord',
  )

  await reset(a, 'TwirChat hotkey A')
  publish(a, [...sequence, { id: 'fresh', contextId: 'input:a', keys: ['x'] }])
  a.simulateKeystrokes('ctrl-k ctrl-right x')
  await until(() => capturedA().length === 2, 'fresh first chord after an unmatched reserved key')
  assert.equal(
    captured(1).hotkeyBindingId,
    'fresh',
    'completed metadata cannot execute a stale JS prefix',
  )
  assert.equal(textA, 'alpha beta')

  await reset(a, 'TwirChat hotkey A')
  publish(a, sequence)
  a.simulateKeystrokes('ctrl-k')
  await Bun.sleep(1100)
  a.simulateKeystrokes('x')
  await until(
    () => textA === 'xalpha beta',
    'expired native prefix does not capture a plain character',
  )
  assert.equal(capturedA().length, 1)

  await reset(a, 'TwirChat hotkey A')
  publish(a, sequence)
  a.simulateKeystrokes('ctrl-k')
  publish(a, sequence)
  a.simulateKeystrokes('x')
  await until(() => textA === 'xalpha beta', 'new plan generation cancels pending prefix')

  await reset(a, 'TwirChat hotkey A')
  publish(a, sequence)
  a.simulateKeystrokes('ctrl-k')
  await focusNativeQaWindow('TwirChat hotkey B')
  await focusNativeQaWindow('TwirChat hotkey A')
  a.simulateKeystrokes('x')
  await until(() => textA === 'xalpha beta', 'window deactivation cancels pending prefix')

  await reset(a, 'TwirChat hotkey A')
  publish(a, reserved, true)
  a.simulateKeystrokes('ctrl-right escape enter tab q')
  await until(() => capturedA().length === 5, 'recorder captures reserved and unmodified keys')
  assert(capturedA().every((event) => event.hotkeyRecorded === true && !event.hotkeyBindingId))
  assert.equal(textA, 'alpha beta', 'recorder never edits the input')
  a.simulateKeyDown('ctrl-right', true)
  await until(() => capturedA().length === 6, 'held native key recorded')
  assert.equal(captured(-1).isHeld, true)

  await reset(b, 'TwirChat hotkey B')
  publish(a, reserved)
  b.simulateKeystrokes('ctrl-right z')
  await until(
    () => textB.includes('z') && textB !== 'alpha beta',
    'other renderer keeps native editing',
  )
  assert.equal(capturedB().length, 0)
  assert(!textB.startsWith('z'))
  await reset(a, 'TwirChat hotkey A')
  const boundaryBindings = Array.from({ length: 520 }, (_, index) => ({
    id: `bound-${index}`,
    contextId: 'input:a',
    keys: ['ctrl+right'],
  }))
  assert.doesNotThrow(() => publish(a, boundaryBindings))
  assert.throws(() =>
    publish(a, [
      ...boundaryBindings,
      { id: 'overflow', contextId: 'input:a', keys: ['ctrl+right'] },
    ]),
  )
  publish(a, [{ id: 'alias', contextId: 'popup', keys: ['Control+ArrowRight'] }])
  assert.throws(() => a.setHotkeyPlan('{"generation":-1,"bindings":[]}'))
  a.simulateKeystrokes('ctrl-right')
  await until(() => capturedA().length === 1, 'invalid update leaves old capture plan intact')
  assert.equal(captured(0).hotkeyBindingId, 'alias')
  assert.equal(captured(0).hotkeyContextId, 'popup')
  a.closeWindow()
  await until(() => !a.isWindowOpen(), 'A closes with interceptor cleanup')
  assert(b.isWindowOpen())
  publish(b, reserved)
  b.closeWindow()
  await until(() => !b.isWindowOpen(), 'B closes with interceptor cleanup')
  console.log(
    JSON.stringify({
      result: 'pass',
      nativeEditorOverride: true,
      unavailableNativeFallback: true,
      fastSequences: true,
      timeoutAndReset: true,
      recorder: true,
      heldMetadata: true,
      windowIsolation: true,
    }),
  )
} finally {
  a.closeWindow()
  b.closeWindow()
}
process.exit(0)
