import { afterEach, describe, expect, test } from 'bun:test'

import type { KeyEvent } from '@gpuix/react'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

import {
  createHotkeyDispatcher,
  normalizeKeyChord,
  recordHotkeyStroke,
  eventKeyChord,
  parseHotkeyArguments,
  validateHotkeyBindings,
  validateHotkeyConfiguration,
  type HotkeyBinding,
} from '../src/gpuix/hotkey-bindings'
import {
  actionBindingsPreferences,
  actionBindingsStore,
  dispatchCustomHotkey,
  registerHotkeyContext,
  registerHotkeyRecorder,
  setHotkeyRoute,
} from '../src/gpuix/state/action-bindings'
import { settingsStore, activeWatchedTabStore } from '../src/gpuix/state/app'
import { trackTextInputFocus } from '../src/gpuix/state/focus'
import { handleGlobalKeyDown, registerHotkeyActions } from '../src/gpuix/state/hotkeys'
import { pushOverlayClose } from '../src/gpuix/state/overlays'
import { createPreferenceStore } from '../src/gpuix/state/preferences'
import { literal } from './fixture-values'

function event(key: string, modifiers: Partial<KeyEvent['modifiers']> = {}): KeyEvent {
  let prevented = false
  return {
    elementId: 0,
    eventType: 'keyDown',
    key,
    modifiers: { ctrl: false, alt: false, shift: false, cmd: false, ...modifiers },
    get defaultPrevented() {
      return prevented
    },
    preventDefault() {
      prevented = true
    },
    stopPropagation() {},
  }
}
const binding = (update: Partial<HotkeyBinding> = {}): HotkeyBinding => ({
  id: crypto.randomUUID(),
  name: 'Test',
  category: 'split',
  action: 'clearMessages',
  keys: ['f2'],
  arguments: [],
  enabled: true,
  ...update,
})
const disposers: (() => void)[] = []
const previous = actionBindingsStore.get()
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  actionBindingsStore.set(previous)
})

describe('action shortcut validation', () => {
  test('normalizes modifiers, native Return/arrow aliases and plus without accepting duplicate modifiers', () => {
    expect(normalizeKeyChord('Shift+Command+Return')).toBe('cmd+shift+enter')
    expect(normalizeKeyChord('CTRL+ArrowLeft')).toBe('ctrl+left')
    expect(normalizeKeyChord('ctrl++')).toBe('ctrl+plus')
    expect(eventKeyChord(event('return', { cmd: true }))).toBe('cmd+enter')
    expect(eventKeyChord(event(' '))).toBe('space')
    expect(eventKeyChord(event('control'))).toBeNull()
    expect(eventKeyChord(event('invalid key'))).toBeNull()
    expect(() => normalizeKeyChord('ctrl+control+x')).toThrow()
  })
  test('keeps commands as one complete argument and rejects blank lines without dropping them', () => {
    expect(parseHotkeyArguments('/timeout @viewer  60 reason with spaces')).toEqual([
      '/timeout @viewer  60 reason with spaces',
    ])
    expect(parseHotkeyArguments('a\n\nb')).toEqual(['a', '', 'b'])
    expect(parseHotkeyArguments('')).toEqual([])
    expect(parseHotkeyArguments('  command  ')).toEqual(['command'])
    expect(parseHotkeyArguments('  first \n\n second  ')).toEqual(['first', '', 'second'])
    expect(() =>
      validateHotkeyBindings([
        binding({ action: 'runCommand', arguments: parseHotkeyArguments('command\n\nsecond') }),
      ]),
    ).toThrow()
    expect(
      validateHotkeyBindings([
        binding({ action: 'runCommand', arguments: [' /timeout user  60 reason '] }),
      ])[0]?.arguments,
    ).toEqual([' /timeout user  60 reason '])
  })
  test('rejects wrong categories, arguments, duplicate ids, sequences and enabled prefix conflicts', () => {
    expect(() =>
      validateHotkeyBindings([binding({ category: 'window', action: 'clearMessages' })]),
    ).toThrow('Unknown')
    expect(() =>
      validateHotkeyBindings([binding({ action: 'scrollPage', arguments: ['upwards'] })]),
    ).toThrow('choose')
    expect(() => validateHotkeyBindings([binding({ keys: Array(5).fill('f1') })])).toThrow()
    const first = binding({ keys: ['ctrl+k'] })
    expect(() => validateHotkeyBindings([first, { ...first }])).toThrow('unique')
    expect(() => validateHotkeyBindings([first, binding({ keys: ['ctrl+k', 'ctrl+c'] })])).toThrow(
      'conflicts',
    )
    expect(
      validateHotkeyBindings([first, binding({ enabled: false, keys: ['ctrl+k', 'ctrl+c'] })]),
    ).toHaveLength(2)
    expect(() => validateHotkeyConfiguration({ bindings: [], legacyNavigation: 'true' })).toThrow()
  })
})

describe('explicit shortcut routing', () => {
  test('multi-stroke sequences only continue in their original window/context with timeout', () => {
    let time = 0
    let calls = 0
    const dispatcher = createHotkeyDispatcher({
      bindings: () => [binding({ keys: ['ctrl+k', 'ctrl+c'] })],
      now: () => time,
    })
    dispatcher.register({
      windowId: 'main',
      id: 'pane',
      category: 'split',
      handlers: {
        clearMessages: () => {
          calls++
        },
      },
    })
    dispatcher.register({
      windowId: 'other',
      id: 'pane',
      category: 'split',
      handlers: {
        clearMessages: () => {
          calls += 100
        },
      },
    })
    expect(dispatcher.handle(event('k', { ctrl: true }), 'main', ['pane'])).toBe(true)
    expect(dispatcher.handle(event('c', { ctrl: true }), 'other', ['pane'])).toBe(false)
    expect(dispatcher.handle(event('c', { ctrl: true }), 'main', ['pane'])).toBe(true)
    expect(calls).toBe(1)
    dispatcher.handle(event('k', { ctrl: true }), 'main', ['pane'])
    time = 1001
    expect(dispatcher.handle(event('c', { ctrl: true }), 'main', ['pane'])).toBe(false)
    dispatcher.handle(event('k', { ctrl: true }), 'main', ['pane'])
    dispatcher.cancel('main')
    expect(dispatcher.handle(event('c', { ctrl: true }), 'main', ['pane'])).toBe(false)
  })
  test('null and unregistered handlers do not consume keys or fall into another window', () => {
    const dispatcher = createHotkeyDispatcher({ bindings: () => [binding()] })
    dispatcher.register({
      windowId: 'main',
      id: 'pane',
      category: 'split',
      handlers: { clearMessages: null },
    })
    dispatcher.register({
      windowId: 'other',
      id: 'pane',
      category: 'split',
      handlers: {
        clearMessages: () => {
          throw new Error('cross-window')
        },
      },
    })
    const key = event('f2')
    expect(dispatcher.handle(key, 'main', ['pane'])).toBe(false)
    expect(key.defaultPrevented).toBe(false)
    expect(dispatcher.handle(event('f2'), 'main', ['missing'])).toBe(false)
  })
  test('routes prioritize focused editor over split and report async action errors once', async () => {
    const failures: unknown[] = []
    const calls: string[] = []
    const dispatcher = createHotkeyDispatcher({
      bindings: () => [binding(), binding({ category: 'splitInput', action: 'clear' })],
      onError: (error) => failures.push(error),
    })
    dispatcher.register({
      windowId: 'main',
      id: 'split',
      category: 'split',
      handlers: {
        clearMessages: () => {
          calls.push('split')
        },
      },
    })
    dispatcher.register({
      windowId: 'main',
      id: 'input',
      category: 'splitInput',
      handlers: {
        clear: async () => {
          calls.push('input')
          throw new Error('failed action')
        },
      },
    })
    expect(dispatcher.handle(event('f2'), 'main', ['input', 'split'])).toBe(true)
    await Promise.resolve()
    expect(calls).toEqual(['input'])
    expect(failures).toHaveLength(1)
    const consumed = event('f2')
    consumed.preventDefault()
    expect(dispatcher.handle(consumed, 'main', ['input'])).toBe(false)
  })
  test('disposing an old registration cannot remove its replacement', () => {
    let calls = 0
    const dispatcher = createHotkeyDispatcher({ bindings: () => [binding()] })
    const first = dispatcher.register({
      windowId: 'main',
      id: 'pane',
      category: 'split',
      handlers: { clearMessages: () => {} },
    })
    dispatcher.register({
      windowId: 'main',
      id: 'pane',
      category: 'split',
      handlers: {
        clearMessages: () => {
          calls++
        },
      },
    })
    first()
    dispatcher.handle(event('f2'), 'main', ['pane'])
    expect(calls).toBe(1)
  })
})

test('state routes cancel prefixes on focus changes, honor recorder priority and block background modal actions', () => {
  let calls = 0
  actionBindingsStore.update({
    value: { bindings: [binding({ keys: ['f2', 'f3'] })], legacyNavigation: true },
  })
  disposers.push(
    registerHotkeyContext({
      windowId: 'main',
      id: 'pane',
      category: 'split',
      handlers: {
        clearMessages: () => {
          calls++
        },
      },
    }),
  )
  disposers.push(setHotkeyRoute('main', ['pane']))
  expect(dispatchCustomHotkey(event('f2'))).toBe(true)
  const otherRoute = setHotkeyRoute('main', [])
  otherRoute()
  expect(dispatchCustomHotkey(event('f3'))).toBe(false)
  let captured = 0
  const stopRecording = registerHotkeyRecorder('main', () => {
    captured++
  })
  expect(dispatchCustomHotkey(event('f2'))).toBe(true)
  expect(captured).toBe(1)
  stopRecording()
  const stopOverlay = pushOverlayClose(() => {})
  expect(dispatchCustomHotkey(event('f2'))).toBe(false)
  stopOverlay()
  dispatchCustomHotkey(event('f2'))
  dispatchCustomHotkey(event('f3'))
  expect(calls).toBe(1)
})

test('custom function keys run while editing and legacy navigation can be explicitly disabled', () => {
  const oldSettings = settingsStore.get()
  const oldTab = activeWatchedTabStore.get()
  let calls = 0
  settingsStore.set(structuredClone(DEFAULT_SETTINGS))
  actionBindingsStore.update({ value: { bindings: [binding()], legacyNavigation: false } })
  disposers.push(
    registerHotkeyContext({
      windowId: 'main',
      id: 'pane',
      category: 'split',
      handlers: {
        clearMessages: () => {
          calls++
        },
      },
    }),
  )
  disposers.push(setHotkeyRoute('main', ['pane']))
  disposers.push(
    registerHotkeyActions({
      openAddChannel: () => {},
      openTabSelector: () => {},
      cycleTab: () => {
        calls += 100
      },
    }),
  )
  trackTextInputFocus(true)
  try {
    handleGlobalKeyDown(event('f2'))
    expect(calls).toBe(1)
    handleGlobalKeyDown(event('right', { alt: true }))
    expect(calls).toBe(1)
  } finally {
    trackTextInputFocus(false)
    settingsStore.set(oldSettings)
    activeWatchedTabStore.set(oldTab)
  }
})

test('a parent mounting after an editor cannot replace its route and a dialog still takes priority', () => {
  const calls: string[] = []
  actionBindingsStore.update({
    value: {
      bindings: [
        binding({ category: 'window', action: 'newTab' }),
        binding({ id: 'editor', category: 'splitInput', action: 'clear' }),
        binding({ id: 'popup', category: 'popupWindow', action: 'accept' }),
      ],
      legacyNavigation: false,
    },
  })
  for (const [id, category, action] of literal([
    ['input', 'splitInput', 'clear'],
    ['window', 'window', 'newTab'],
    ['popup', 'popupWindow', 'accept'],
  ])) {
    disposers.push(
      registerHotkeyContext({
        windowId: 'main',
        id,
        category,
        handlers: {
          [action]: () => {
            calls.push(id)
          },
        },
      }),
    )
  }
  disposers.push(setHotkeyRoute('main', ['input', 'split', 'window'], 3))
  disposers.push(setHotkeyRoute('main', ['window'], 1))
  expect(dispatchCustomHotkey(event('f2'))).toBe(true)
  expect(calls).toEqual(['input'])
  disposers.push(setHotkeyRoute('main', ['popup'], 1))
  const close = pushOverlayClose(() => {}, 'main', 'popup')
  try {
    expect(dispatchCustomHotkey(event('f2'))).toBe(true)
  } finally {
    close()
  }
  expect(calls).toEqual(['input', 'popup'])
})

test('persisted config validates before applying and failed writes can be retried', async () => {
  const store = createPreferenceStore(
    `test-hotkeys-${crypto.randomUUID()}`,
    { bindings: [], legacyNavigation: true },
    validateHotkeyConfiguration,
  )
  await store.load({
    getUiState: async () =>
      JSON.stringify({ bindings: [binding({ keys: [] })], legacyNavigation: true }),
    setUiState: async () => {},
  })
  expect(store.store.get().value.bindings).toHaveLength(0)
  expect(store.store.get().error).toBeTruthy()
  let fail = true
  let persisted = ''
  const api = {
    getUiState: async () => null,
    setUiState: async ({ value }: { value: string }) => {
      if (fail) throw new Error('disk full')
      persisted = value
    },
  }
  const config = {
    bindings: [
      binding({
        category: 'split',
        action: 'runCommand',
        arguments: ['/timeout user  60 reason here'],
      }),
    ],
    legacyNavigation: false,
  }
  await expect(store.save(api, config)).rejects.toThrow('disk full')
  expect(store.store.get().error).toBe('disk full')
  fail = false
  await store.save(api, config)
  expect(validateHotkeyConfiguration(JSON.parse(persisted))).toEqual(config)
  expect(store.store.get().error).toBeNull()
  expect(actionBindingsPreferences).toBeDefined()
})

test('recorder keeps Enter, normalizes modifiers and finishes at four strokes', () => {
  expect(recordHotkeyStroke([], event('ctrl'))).toBeNull()
  expect(recordHotkeyStroke(['f1'], event('return', { cmd: true }))).toEqual({
    keys: ['f1', 'cmd+enter'],
    cancelled: false,
    complete: false,
  })
  expect(recordHotkeyStroke(['f1', 'f2', 'f3'], event('return'))).toEqual({
    keys: ['f1', 'f2', 'f3', 'enter'],
    cancelled: false,
    complete: true,
  })
  expect(recordHotkeyStroke(['f1'], event('escape'))?.cancelled).toBe(true)
})

test('runCommand dispatch delivers the complete argument without splitting its spaces', () => {
  let received: readonly string[] = []
  const command = '/timeout viewer  60 a reason with spaces'
  const dispatcher = createHotkeyDispatcher({
    bindings: () => [binding({ action: 'runCommand', arguments: [command] })],
  })
  dispatcher.register({
    windowId: 'main',
    id: 'split',
    category: 'split',
    handlers: {
      runCommand: (args) => {
        received = args
      },
    },
  })
  dispatcher.handle(event('f2'), 'main', ['split'])
  expect(received).toEqual([command])
})
