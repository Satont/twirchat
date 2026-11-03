import { expect, test } from 'bun:test'

import type { KeyEvent } from '@gpuix/react'

import {
  actionBindingsStore,
  dispatchCustomHotkey,
  observeNativeHotkeyPlan,
  refreshNativeHotkeyPlan,
  registerHotkeyContext,
  registerHotkeyRecorder,
  registerSupplementalHotkeys,
  setHotkeyRoute,
  type NativeHotkeyPlan,
} from '../src/gpuix/state/action-bindings'
import { trackTextInputFocus } from '../src/gpuix/state/focus'
import { registerHotkeyActions } from '../src/gpuix/state/hotkeys'
import { pushOverlayClose } from '../src/gpuix/state/overlays'
import { literal, required } from './fixture-values'

const event = (metadata: object = {}, key = 'right'): KeyEvent =>
  Object.assign(
    {
      elementId: 0,
      eventType: 'keyDown',
      key,
      modifiers: { ctrl: true, shift: false, alt: false, cmd: false },
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      stopPropagation() {},
    },
    metadata,
  )

function fixture(scope: string) {
  const previous = actionBindingsStore.get()
  const stops: (() => void)[] = []
  let plan: NativeHotkeyPlan | undefined
  actionBindingsStore.set({
    ...previous,
    value: {
      legacyNavigation: false,
      bindings: [
        {
          id: 'popup-next',
          category: 'popupWindow',
          action: 'openTab',
          keys: ['ctrl+arrowright'],
          arguments: ['next'],
          name: '',
          enabled: true,
        },
        {
          id: 'popup-close',
          category: 'popupWindow',
          action: 'delete',
          keys: ['ctrl+k'],
          arguments: [],
          name: '',
          enabled: true,
        },
      ],
    },
  })
  stops.push(
    observeNativeHotkeyPlan(scope, (next) => {
      plan = next
    }),
  )
  return {
    stops,
    get plan() {
      return required(plan)
    },
    captured(id = 'popup-next', context = 'popup') {
      return event({
        hotkeyGeneration: required(plan).generation,
        hotkeyBindingId: id,
        hotkeyContextId: context,
      })
    },
    dispose() {
      for (const stop of stops.reverse()) stop()
      actionBindingsStore.set(previous)
    },
  }
}

test('focused completion bindings precede custom shortcuts and retire with their source', () => {
  const scope = 'completion-priority'
  const f = fixture(scope)
  const calls: string[] = []
  try {
    f.stops.push(
      registerHotkeyContext({
        id: 'popup',
        windowId: scope,
        category: 'popupWindow',
        handlers: {
          openTab: () => {
            calls.push('custom')
          },
        },
      }),
      setHotkeyRoute(scope, ['popup']),
      registerSupplementalHotkeys(scope, 'navigation', () => [
        {
          id: 'normal',
          keys: ['down'],
          handler: () => {
            calls.push('normal')
          },
        },
      ]),
    )
    const stopCompletion = registerSupplementalHotkeys(
      scope,
      'completion',
      () => [
        {
          id: 'next',
          keys: ['down'],
          handler: () => {
            calls.push('completion')
          },
        },
      ],
      'beforeCustom',
    )
    f.stops.push(stopCompletion)
    expect(f.plan.bindings.map((binding) => binding.id)).toEqual([
      'legacy:completion:next',
      'popup-next',
      'legacy:navigation:normal',
    ])
    const captured = f.captured('legacy:completion:next', 'legacy:completion')
    expect(dispatchCustomHotkey(captured, scope)).toBe(true)
    expect(calls).toEqual(['completion'])
    const stopOverlay = pushOverlayClose(() => {}, scope)
    expect(f.plan.bindings).toEqual([])
    stopOverlay()
    const stale = f.captured('legacy:completion:next', 'legacy:completion')
    stopCompletion()
    expect(f.plan.bindings.map((binding) => binding.id)).toEqual([
      'popup-next',
      'legacy:navigation:normal',
    ])
    expect(dispatchCustomHotkey(stale, scope)).toBe(true)
    expect(calls).toEqual(['completion'])
  } finally {
    f.dispose()
  }
})

test('plans contain available handlers only, dedupe routed IDs, and consume captured prefixes without JS replay', () => {
  const f = fixture('plan-availability')
  const calls: unknown[] = []
  try {
    f.stops.push(
      registerHotkeyContext({
        id: 'popup',
        windowId: 'plan-availability',
        category: 'popupWindow',
        handlers: {
          openTab: (args) => {
            calls.push(args)
          },
          delete: null,
        },
      }),
      registerHotkeyContext({
        id: 'older',
        windowId: 'plan-availability',
        category: 'popupWindow',
        handlers: {
          openTab: () => {
            calls.push('wrong')
          },
        },
      }),
      setHotkeyRoute('plan-availability', ['popup', 'older']),
    )
    expect(f.plan.bindings).toEqual([
      { id: 'popup-next', contextId: 'popup', keys: ['ctrl+arrowright'] },
    ])
    const prefix = event({ hotkeyGeneration: f.plan.generation, hotkeyPrefix: true })
    expect(dispatchCustomHotkey(prefix, 'plan-availability')).toBe(true)
    expect(prefix.defaultPrevented).toBe(true)
    expect(calls).toEqual([])
    expect(dispatchCustomHotkey(f.captured(), 'plan-availability')).toBe(true)
    expect(calls).toEqual([['next']])
    const stale = f.captured()
    refreshNativeHotkeyPlan('plan-availability')
    expect(dispatchCustomHotkey(stale, 'plan-availability')).toBe(true)
    expect(calls.length).toBe(1)
  } finally {
    f.dispose()
  }
})

test('explicit overlay ownership is independent of mount order and nested generic overlays block older popups', () => {
  const scope = 'plan-overlays',
    f = fixture(scope)
  try {
    const owner = pushOverlayClose(() => {}, scope, 'popup')
    f.stops.push(owner)
    expect(f.plan.bindings).toEqual([])
    f.stops.push(
      setHotkeyRoute(scope, ['popup']),
      registerHotkeyContext({
        id: 'popup',
        windowId: scope,
        category: 'popupWindow',
        handlers: { openTab: () => {} },
      }),
    )
    expect(f.plan.bindings.length).toBe(1)
    const captured = f.captured()
    const generic = pushOverlayClose(() => {}, scope)
    expect(f.plan.bindings).toEqual([])
    expect(dispatchCustomHotkey(captured, scope)).toBe(true)
    generic()
    expect(f.plan.bindings.length).toBe(1)
    const other = pushOverlayClose(() => {}, scope, 'not-registered')
    expect(f.plan.bindings).toEqual([])
    other()
    expect(f.plan.bindings.length).toBe(1)
  } finally {
    f.dispose()
  }
})

test('recorder captures reserved keys, focus resets generations, and windows never share captures', () => {
  const scope = 'plan-recorder',
    f = fixture(scope)
  const keys: string[] = []
  let other: NativeHotkeyPlan | undefined
  try {
    f.stops.push(
      observeNativeHotkeyPlan('plan-recorder-other', (plan) => {
        other = plan
      }),
    )
    const before = f.plan.generation
    trackTextInputFocus(true, scope)
    expect(f.plan.generation).toBeGreaterThan(before)
    trackTextInputFocus(false, scope)
    const stopRecorder = registerHotkeyRecorder(scope, (e) => {
      keys.push(required(e.key))
    })
    f.stops.push(stopRecorder)
    expect(f.plan.recordAll).toBe(true)
    expect(required(other).recordAll).toBeUndefined()
    for (const key of ['escape', 'enter', 'right']) {
      expect(
        dispatchCustomHotkey(
          event({ hotkeyGeneration: f.plan.generation, hotkeyRecorded: true }, key),
          scope,
        ),
      ).toBe(true)
    }
    expect(keys).toEqual(['escape', 'enter', 'right'])
    expect(
      dispatchCustomHotkey(
        event({ hotkeyGeneration: f.plan.generation, hotkeyRecorded: true }),
        'plan-recorder-other',
      ),
    ).toBe(true)
    expect(keys.length).toBe(3)
    stopRecorder()
    expect(f.plan.recordAll).toBeUndefined()
  } finally {
    f.dispose()
  }
})

test('legacy native captures follow custom entries and obey scoped editing and overlay guards', () => {
  const scope = 'plan-legacy',
    f = fixture(scope)
  let opened = 0,
    chat = false
  try {
    f.stops.push(
      registerHotkeyContext({
        id: 'popup',
        windowId: scope,
        category: 'popupWindow',
        handlers: { delete: () => {} },
      }),
      setHotkeyRoute(scope, ['popup']),
      registerHotkeyActions(
        {
          openAddChannel() {},
          openTabSelector() {
            opened++
          },
          isChatActive: () => chat,
        },
        scope,
      ),
    )
    expect(f.plan.bindings.map((b) => b.id)).toEqual([
      'popup-close',
      'legacy:navigation:quick-switcher',
    ])
    const legacy = required(f.plan.bindings[1])
    dispatchCustomHotkey(f.captured(legacy.id, legacy.contextId), scope)
    expect(opened).toBe(1)
    trackTextInputFocus(true, scope)
    expect(f.plan.bindings.map((b) => b.id)).toEqual(['popup-close'])
    chat = true
    refreshNativeHotkeyPlan(scope)
    expect(f.plan.bindings.length).toBe(2)
    trackTextInputFocus(false, scope)
    const stop = pushOverlayClose(() => {}, scope)
    expect(f.plan.bindings).toEqual([])
    stop()
    expect(f.plan.bindings.length).toBe(2)
  } finally {
    f.dispose()
  }
})

test('configuration changes reject captures synchronously and observer disposal clears native state', () => {
  const scope = 'plan-config',
    f = fixture(scope)
  let calls = 0
  try {
    f.stops.push(
      registerHotkeyContext({
        id: 'popup',
        windowId: scope,
        category: 'popupWindow',
        handlers: {
          openTab() {
            calls++
          },
        },
      }),
      setHotkeyRoute(scope, ['popup']),
    )
    const captured = f.captured()
    const current = actionBindingsStore.get()
    actionBindingsStore.set({
      ...current,
      value: {
        ...current.value,
        bindings: current.value.bindings.map((binding) => ({ ...binding, enabled: false })),
      },
    })
    dispatchCustomHotkey(captured, scope)
    expect(calls).toBe(0)
    expect(f.plan.bindings).toEqual([])
    const before = f.plan.generation
    const stopObserver = required(f.stops.shift())
    stopObserver()
    expect(f.plan.generation).toBeGreaterThan(before)
    expect(f.plan.bindings).toEqual([])
    const stopAgain = observeNativeHotkeyPlan(scope, (plan) => {
      expect(plan.generation).toBeGreaterThan(before)
    })
    stopAgain()
  } finally {
    f.dispose()
  }
})

test('all 512 custom bindings remain present alongside available legacy native captures', () => {
  const scope = 'plan-capacity',
    f = fixture(scope)
  try {
    const current = actionBindingsStore.get()
    actionBindingsStore.set({
      ...current,
      value: {
        legacyNavigation: false,
        bindings: Array.from({ length: 512 }, (_, index) => ({
          id: `custom-${index}`,
          name: '',
          enabled: true,
          category: literal('popupWindow'),
          action: literal('delete'),
          arguments: [],
          keys: [
            'ctrl+z',
            ...index
              .toString(8)
              .padStart(3, '0')
              .split('')
              .map((digit) => String.fromCharCode(97 + Number(digit))),
          ],
        })),
      },
    })
    f.stops.push(
      registerHotkeyContext({
        id: 'popup',
        windowId: scope,
        category: 'popupWindow',
        handlers: { delete() {} },
      }),
      setHotkeyRoute(scope, ['popup']),
      registerHotkeyActions(
        { openAddChannel() {}, openTabSelector() {}, openAllChatSearch() {} },
        scope,
      ),
    )
    expect(f.plan.bindings.length).toBe(514)
    expect(
      f.plan.bindings.slice(0, 512).every((binding, index) => binding.id === `custom-${index}`),
    ).toBe(true)
    expect(f.plan.bindings.slice(512).map((binding) => binding.id)).toEqual([
      'legacy:navigation:quick-switcher',
      'legacy:navigation:global-search',
    ])
  } finally {
    f.dispose()
  }
})
