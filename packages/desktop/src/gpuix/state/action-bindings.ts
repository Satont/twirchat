import type { KeyEvent } from '@gpuix/react'
import { useEffect, useRef } from 'react'

import {
  createHotkeyDispatcher,
  HOTKEY_ACTIONS,
  type HotkeyAction,
  normalizeKeyChord,
  type HotkeyContext,
  validateHotkeyConfiguration,
  type HotkeyConfiguration,
  type HotkeyBinding,
} from '../hotkey-bindings'
import { showNotice } from './app'
import { onTextInputFocusChange } from './focus'
import { getTopOverlayHotkeyContext, onOverlayStackChange } from './overlays'
import { persistentResource } from './persistent-resources'
import type { PreferenceStore } from './preferences'
import { createPreferenceStore, type PreferenceApi } from './preferences'
import { useWindowScope } from './window-scope'

export const actionBindingsPreferences = persistentResource('preference:ui.actionBindings', () =>
  createPreferenceStore<HotkeyConfiguration>(
    'ui.actionBindings',
    { bindings: [], legacyNavigation: true },
    validateHotkeyConfiguration,
  ),
)
export const actionBindingsStore = actionBindingsPreferences.store
export const loadActionBindings = (api: PreferenceApi): Promise<void> =>
  actionBindingsPreferences.load(api)

export interface NativeHotkeyPlanBinding {
  readonly id: string
  readonly contextId: string
  readonly keys: readonly string[]
}
export interface NativeHotkeyPlan {
  readonly generation: number
  readonly bindings: readonly NativeHotkeyPlanBinding[]
  readonly recordAll?: boolean
}
export interface SupplementalHotkeyBinding {
  id: string
  keys: readonly string[]
  handler: () => void | Promise<unknown>
}
interface SupplementalSource {
  id: string
  bindings: () => readonly SupplementalHotkeyBinding[]
  priority: 'beforeCustom' | 'afterCustom'
}
type PlanRecord =
  | { kind: 'custom'; contextId: string; binding: HotkeyBinding }
  | {
      kind: 'supplemental'
      contextId: string
      source: SupplementalSource
      binding: SupplementalHotkeyBinding
    }
interface NativeObserver {
  callbacks: Map<object, (plan: NativeHotkeyPlan) => void>
  plan: NativeHotkeyPlan
  entries: Map<string, PlanRecord>
  stopActivity: () => void
}
const contexts = new Map<string, HotkeyContext>()
const routes = new Map<string, { ids: readonly string[]; priority: number }[]>()
const recorders = new Map<string, { handle: (event: KeyEvent) => void }>()
const supplements = new Map<string, Map<string, SupplementalSource>>()
const nativeObservers = new Map<string, NativeObserver>()
const activity = new Map<string, { refs: number; stop: () => void }>()
let generation = 0
let stopConfiguration: (() => void) | undefined
let previousConfiguration = actionBindingsStore.get().value
const key = (windowId: string, id: string) => JSON.stringify([windowId, id])
const entryKey = (contextId: string, bindingId: string) => JSON.stringify([contextId, bindingId])
const reportError = (error: unknown) =>
  showNotice('error', `Shortcut failed: ${error instanceof Error ? error.message : String(error)}`)
const dispatcher = createHotkeyDispatcher({
  bindings: () => actionBindingsStore.get().value.bindings,
  onError: reportError,
})

function eligibleContexts(scope: string): readonly string[] {
  const stack = [...(routes.get(scope) ?? [])].sort((a, b) => a.priority - b.priority)
  const owner = getTopOverlayHotkeyContext(scope)
  if (owner === null) return []
  if (owner !== undefined) {
    return contexts.get(key(scope, owner))?.category === 'popupWindow' &&
      stack.some((route) => route.ids.includes(owner))
      ? [owner]
      : []
  }
  return stack.at(-1)?.ids ?? []
}
function invoke(action: () => unknown): void {
  try {
    Promise.resolve(action()).catch(reportError)
  } catch (error) {
    reportError(error)
  }
}
function retainActivity(scope: string): () => void {
  let entry = activity.get(scope)
  if (!entry) {
    const stopOverlay = onOverlayStackChange(() => refreshNativeHotkeyPlan(scope), scope)
    const stopFocus = onTextInputFocusChange(() => refreshNativeHotkeyPlan(scope), scope)
    entry = {
      refs: 0,
      stop: () => {
        stopOverlay()
        stopFocus()
      },
    }
    activity.set(scope, entry)
  }
  entry.refs++
  let active = true
  return () => {
    if (!active) return
    active = false
    entry.refs--
    if (!entry.refs && activity.get(scope) === entry) {
      activity.delete(scope)
      entry.stop()
    }
  }
}
function supplementalBindings(source: SupplementalSource): readonly SupplementalHotkeyBinding[] {
  try {
    return source
      .bindings()
      .filter(
        (binding) =>
          typeof binding.handler === 'function' &&
          binding.keys.length > 0 &&
          binding.keys.length <= 4,
      )
      .map((binding) => ({ ...binding, keys: binding.keys.map(normalizeKeyChord) }))
  } catch (error) {
    console.error('[hotkeys] supplemental plan:', error)
    return []
  }
}
function buildPlan(scope: string): { plan: NativeHotkeyPlan; entries: Map<string, PlanRecord> } {
  const bindings: NativeHotkeyPlanBinding[] = []
  const entries = new Map<string, PlanRecord>()
  if (recorders.has(scope))
    return {
      plan: Object.freeze({
        generation: ++generation,
        bindings: Object.freeze(bindings),
        recordAll: true,
      }),
      entries,
    }
  const used = new Set<string>()
  const appendSupplements = (priority: SupplementalSource['priority']) => {
    if (getTopOverlayHotkeyContext(scope) !== undefined) return
    for (const source of supplements.get(scope)?.values() ?? []) {
      if (source.priority !== priority) continue
      for (const binding of supplementalBindings(source)) {
        if (bindings.length >= 520) return
        const id = `legacy:${source.id}:${binding.id}`
        const contextId = `legacy:${source.id}`
        bindings.push(Object.freeze({ id, contextId, keys: Object.freeze([...binding.keys]) }))
        entries.set(entryKey(contextId, id), { kind: 'supplemental', contextId, source, binding })
      }
    }
  }
  appendSupplements('beforeCustom')
  for (const contextId of eligibleContexts(scope)) {
    const context = contexts.get(key(scope, contextId))
    if (!context) continue
    for (const binding of actionBindingsStore.get().value.bindings) {
      if (
        used.has(binding.id) ||
        !binding.enabled ||
        binding.category !== context.category ||
        typeof context.handlers[binding.action] !== 'function'
      )
        continue
      used.add(binding.id)
      bindings.push(
        Object.freeze({ id: binding.id, contextId, keys: Object.freeze([...binding.keys]) }),
      )
      entries.set(entryKey(contextId, binding.id), { kind: 'custom', contextId, binding })
    }
  }
  appendSupplements('afterCustom')
  return {
    plan: Object.freeze({ generation: ++generation, bindings: Object.freeze(bindings) }),
    entries,
  }
}
function deliver(callback: (plan: NativeHotkeyPlan) => void, plan: NativeHotkeyPlan): void {
  try {
    callback(plan)
  } catch (error) {
    console.error('[hotkeys] native plan:', error)
    reportError(error)
  }
}
/** Explicit route/focus changes invalidate pending native and synthetic sequences. */
export function refreshNativeHotkeyPlan(scope: string): void {
  dispatcher.cancel(scope)
  const observer = nativeObservers.get(scope)
  if (!observer) return
  Object.assign(observer, buildPlan(scope))
  const plan = observer.plan
  for (const callback of [...observer.callbacks.values()]) {
    if (nativeObservers.get(scope) !== observer || observer.plan !== plan) break
    deliver(callback, plan)
  }
}
function syncConfiguration(): void {
  const configuration = actionBindingsStore.get().value
  if (configuration === previousConfiguration) return
  previousConfiguration = configuration
  for (const scope of routes.keys()) dispatcher.cancel(scope)
  for (const scope of nativeObservers.keys()) refreshNativeHotkeyPlan(scope)
}
/** Receives an immediate immutable plan; disposing its last observer clears native capture. */
export function observeNativeHotkeyPlan(
  scope: string,
  callback: (plan: NativeHotkeyPlan) => void,
): () => void {
  syncConfiguration()
  let observer = nativeObservers.get(scope)
  if (!observer) {
    observer = { callbacks: new Map(), ...buildPlan(scope), stopActivity: retainActivity(scope) }
    nativeObservers.set(scope, observer)
    dispatcher.cancel(scope)
  }
  if (!stopConfiguration) stopConfiguration = actionBindingsStore.subscribe(syncConfiguration)
  const token = {}
  observer.callbacks.set(token, callback)
  deliver(callback, observer.plan)
  let active = true
  return () => {
    if (!active) return
    active = false
    observer.callbacks.delete(token)
    if (observer.callbacks.size || nativeObservers.get(scope) !== observer) return
    nativeObservers.delete(scope)
    observer.stopActivity()
    dispatcher.cancel(scope)
    deliver(callback, Object.freeze({ generation: ++generation, bindings: Object.freeze([]) }))
    if (!nativeObservers.size) {
      stopConfiguration?.()
      stopConfiguration = undefined
    }
  }
}
export function registerSupplementalHotkeys(
  scope: string,
  id: string,
  bindings: SupplementalSource['bindings'],
  priority: SupplementalSource['priority'] = 'afterCustom',
): () => void {
  const sources = supplements.get(scope) ?? new Map<string, SupplementalSource>()
  const source = { id, bindings, priority }
  sources.set(id, source)
  supplements.set(scope, sources)
  refreshNativeHotkeyPlan(scope)
  return () => {
    if (sources.get(id) !== source) return
    sources.delete(id)
    if (!sources.size && supplements.get(scope) === sources) supplements.delete(scope)
    refreshNativeHotkeyPlan(scope)
  }
}
export function registerHotkeyContext(context: HotkeyContext): () => void {
  contexts.set(key(context.windowId, context.id), context)
  const dispose = dispatcher.register(context)
  refreshNativeHotkeyPlan(context.windowId)
  return () => {
    if (contexts.get(key(context.windowId, context.id)) === context) {
      contexts.delete(key(context.windowId, context.id))
      refreshNativeHotkeyPlan(context.windowId)
    }
    dispose()
  }
}
export function setHotkeyRoute(
  windowId: string,
  orderedIDs: readonly string[],
  priority = 0,
): () => void {
  const stack = routes.get(windowId) ?? []
  const entry = { ids: [...orderedIDs], priority }
  stack.push(entry)
  routes.set(windowId, stack)
  const stopActivity = retainActivity(windowId)
  refreshNativeHotkeyPlan(windowId)
  return () => {
    const index = stack.indexOf(entry)
    if (index < 0) return
    stack.splice(index, 1)
    if (!stack.length) routes.delete(windowId)
    refreshNativeHotkeyPlan(windowId)
    stopActivity()
  }
}
export function registerHotkeyRecorder(
  windowId: string,
  handle: (event: KeyEvent) => void,
): () => void {
  const entry = { handle }
  recorders.set(windowId, entry)
  refreshNativeHotkeyPlan(windowId)
  return () => {
    if (recorders.get(windowId) !== entry) return
    recorders.delete(windowId)
    refreshNativeHotkeyPlan(windowId)
  }
}
interface CapturedKeyEvent extends KeyEvent {
  hotkeyGeneration?: number
  hotkeyBindingId?: string
  hotkeyContextId?: string
  hotkeyPrefix?: boolean
  hotkeyRecorded?: boolean
}
function dispatchCaptured(event: CapturedKeyEvent, scope: string): boolean {
  event.preventDefault()
  event.stopPropagation()
  dispatcher.cancel(scope)
  const observer = nativeObservers.get(scope)
  if (!observer || event.hotkeyGeneration !== observer.plan.generation) return true
  if (event.hotkeyRecorded) {
    const recorder = recorders.get(scope)
    if (observer.plan.recordAll && recorder) invoke(() => recorder.handle(event))
    return true
  }
  if (recorders.has(scope) || event.hotkeyPrefix) return true
  if (typeof event.hotkeyBindingId !== 'string' || typeof event.hotkeyContextId !== 'string')
    return true
  const record = observer.entries.get(entryKey(event.hotkeyContextId, event.hotkeyBindingId))
  if (!record) return true
  if (record.kind === 'custom') {
    if (!eligibleContexts(scope).includes(record.contextId)) return true
    const context = contexts.get(key(scope, record.contextId))
    const binding = actionBindingsStore
      .get()
      .value.bindings.find((binding) => binding.id === record.binding.id)
    if (
      !binding?.enabled ||
      binding.category !== context?.category ||
      binding.action !== record.binding.action ||
      JSON.stringify(binding.keys) !== JSON.stringify(record.binding.keys)
    )
      return true
    const handler = context?.handlers[binding.action]
    if (typeof handler === 'function') invoke(() => handler(binding.arguments))
  } else {
    if (
      getTopOverlayHotkeyContext(scope) !== undefined ||
      supplements.get(scope)?.get(record.source.id) !== record.source
    )
      return true
    const binding = supplementalBindings(record.source).find(
      (binding) =>
        binding.id === record.binding.id &&
        JSON.stringify(binding.keys) === JSON.stringify(record.binding.keys),
    )
    if (binding) invoke(binding.handler)
  }
  return true
}
export function dispatchCustomHotkey(event: KeyEvent, scope = 'main'): boolean {
  syncConfiguration()
  if (
    [
      'hotkeyGeneration',
      'hotkeyBindingId',
      'hotkeyContextId',
      'hotkeyPrefix',
      'hotkeyRecorded',
    ].some((field) => Object.hasOwn(event, field))
  )
    return dispatchCaptured(event, scope)
  if (event.defaultPrevented) return false
  const recorder = recorders.get(scope)
  if (recorder) {
    event.preventDefault()
    event.stopPropagation()
    invoke(() => recorder.handle(event))
    return true
  }
  return dispatcher.handle(event, scope, eligibleContexts(scope))
}
export function useHotkeyContext(
  context: Omit<HotkeyContext, 'windowId'>,
  windowId?: string,
): void {
  const scope = useWindowScope()
  const handlers = useRef(context.handlers)
  handlers.current = context.handlers
  const available = Object.entries(context.handlers)
    .filter(([, handler]) => typeof handler === 'function')
    .map(([action]) => action)
    .sort()
    .join('|')
  useEffect(() => {
    const proxies: HotkeyContext['handlers'] = {}
    const enabled = new Set(available.split('|'))
    for (const action of new Set<HotkeyAction>(Object.values(HOTKEY_ACTIONS).flat())) {
      if (!enabled.has(action)) continue
      Object.defineProperty(proxies, action, {
        enumerable: true,
        get: () => handlers.current[action] ?? null,
      })
    }
    return registerHotkeyContext({
      id: context.id,
      category: context.category,
      windowId: windowId ?? scope,
      handlers: proxies,
    })
  }, [context.id, context.category, windowId, scope, available])
}
export function useHotkeyRoute(
  ids: readonly string[],
  enabled = true,
  priority = ids.length,
): void {
  const scope = useWindowScope()
  const identity = JSON.stringify(ids)
  useEffect(() => {
    if (enabled) return setHotkeyRoute(scope, JSON.parse(identity), priority)
  }, [scope, identity, enabled, priority])
}

declare module './persistent-resources' {
  interface PersistentResources {
    'preference:ui.actionBindings': PreferenceStore<HotkeyConfiguration>
  }
}
