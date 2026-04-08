import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, type AppSettings } from '@twirchat/shared/types'
import { parseKeyCombo, pause, resume, useHotkeys } from '../src/views/main/composables/useHotkeys'

class MockHTMLElement {
  isContentEditable = false

  constructor(public tagName: string) {
    this.tagName = tagName.toUpperCase()
  }

  focus(): void {}
}

class MockKeyboardEvent {
  altKey: boolean
  bubbles: boolean
  ctrlKey: boolean
  defaultPrevented = false
  key: string
  shiftKey: boolean
  target: EventTarget | null = null

  constructor(
    public type: string,
    init: {
      altKey?: boolean
      bubbles?: boolean
      ctrlKey?: boolean
      key?: string
      shiftKey?: boolean
    } = {},
  ) {
    this.altKey = init.altKey ?? false
    this.bubbles = init.bubbles ?? false
    this.ctrlKey = init.ctrlKey ?? false
    this.key = init.key ?? ''
    this.shiftKey = init.shiftKey ?? false
  }

  preventDefault(): void {
    this.defaultPrevented = true
  }
}

type KeydownListener = (event: KeyboardEvent) => void

class MockWindow {
  private listeners = new Map<string, Set<KeydownListener>>()

  addEventListener(type: string, listener: KeydownListener): void {
    const listeners = this.listeners.get(type) ?? new Set<KeydownListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  dispatchEvent(event: MockKeyboardEvent): boolean {
    event.target = this as unknown as EventTarget
    const listeners = this.listeners.get(event.type)

    if (!listeners) {
      return !event.defaultPrevented
    }

    for (const listener of listeners) {
      listener(event as unknown as KeyboardEvent)
    }

    return !event.defaultPrevented
  }

  removeEventListener(type: string, listener: KeydownListener): void {
    this.listeners.get(type)?.delete(listener)
  }
}

const mockWindow = new MockWindow()
let activeElement: EventTarget | null = null

function makeSettings(hotkeys?: Partial<AppSettings['hotkeys']>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    hotkeys: {
      ...DEFAULT_SETTINGS.hotkeys,
      ...hotkeys,
    },
    overlay: {
      ...DEFAULT_SETTINGS.overlay,
    },
  }
}

function makeSettingsRef(hotkeys?: Partial<AppSettings['hotkeys']>): { value: AppSettings | null } {
  return {
    value: makeSettings(hotkeys),
  }
}

function dispatchKeydown(init: {
  altKey?: boolean
  ctrlKey?: boolean
  key: string
  shiftKey?: boolean
}): void {
  mockWindow.dispatchEvent(
    new KeyboardEvent('keydown', {
      ...init,
      bubbles: true,
    }),
  )
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: mockWindow,
  })

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get activeElement() {
        return activeElement
      },
    },
  })

  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: MockHTMLElement,
  })

  Object.defineProperty(globalThis, 'KeyboardEvent', {
    configurable: true,
    value: MockKeyboardEvent,
  })
})

beforeEach(() => {
  activeElement = null
  resume()
})

describe('useHotkeys', () => {
  test('handler fires when matching key combo is pressed', () => {
    const calls = { newTab: 0, nextTab: 0, prevTab: 0, tabSelector: 0 }

    useHotkeys(makeSettingsRef(), {
      newTab: () => {
        calls.newTab++
      },
      nextTab: () => {
        calls.nextTab++
      },
      prevTab: () => {
        calls.prevTab++
      },
      tabSelector: () => {
        calls.tabSelector++
      },
    })

    dispatchKeydown({ ctrlKey: true, key: 't' })

    expect(calls).toEqual({ newTab: 1, nextTab: 0, prevTab: 0, tabSelector: 0 })
  })

  test('handler does not fire when document.activeElement is an input', () => {
    const calls = { newTab: 0, nextTab: 0, prevTab: 0, tabSelector: 0 }
    activeElement = new MockHTMLElement('input') as unknown as EventTarget

    useHotkeys(makeSettingsRef(), {
      newTab: () => {
        calls.newTab++
      },
      nextTab: () => {
        calls.nextTab++
      },
      prevTab: () => {
        calls.prevTab++
      },
      tabSelector: () => {
        calls.tabSelector++
      },
    })

    dispatchKeydown({ ctrlKey: true, key: 't' })

    expect(calls.newTab).toBe(0)
  })

  test('handler does not fire when document.activeElement is a textarea', () => {
    const calls = { newTab: 0, nextTab: 0, prevTab: 0, tabSelector: 0 }
    activeElement = new MockHTMLElement('textarea') as unknown as EventTarget

    useHotkeys(makeSettingsRef(), {
      newTab: () => {
        calls.newTab++
      },
      nextTab: () => {
        calls.nextTab++
      },
      prevTab: () => {
        calls.prevTab++
      },
      tabSelector: () => {
        calls.tabSelector++
      },
    })

    dispatchKeydown({ ctrlKey: true, key: 't' })

    expect(calls.newTab).toBe(0)
  })

  test('handler does not fire when document.activeElement is content editable', () => {
    const calls = { newTab: 0, nextTab: 0, prevTab: 0, tabSelector: 0 }
    const editable = new MockHTMLElement('div')
    editable.isContentEditable = true
    activeElement = editable as unknown as EventTarget

    useHotkeys(makeSettingsRef(), {
      newTab: () => {
        calls.newTab++
      },
      nextTab: () => {
        calls.nextTab++
      },
      prevTab: () => {
        calls.prevTab++
      },
      tabSelector: () => {
        calls.tabSelector++
      },
    })

    dispatchKeydown({ ctrlKey: true, key: 't' })

    expect(calls.newTab).toBe(0)
  })

  test('handler does not fire after pause is called', () => {
    const calls = { newTab: 0, nextTab: 0, prevTab: 0, tabSelector: 0 }

    useHotkeys(makeSettingsRef(), {
      newTab: () => {
        calls.newTab++
      },
      nextTab: () => {
        calls.nextTab++
      },
      prevTab: () => {
        calls.prevTab++
      },
      tabSelector: () => {
        calls.tabSelector++
      },
    })

    pause()
    dispatchKeydown({ ctrlKey: true, key: 't' })

    expect(calls.newTab).toBe(0)
  })

  test('handler fires again after resume is called', () => {
    const calls = { newTab: 0, nextTab: 0, prevTab: 0, tabSelector: 0 }

    useHotkeys(makeSettingsRef(), {
      newTab: () => {
        calls.newTab++
      },
      nextTab: () => {
        calls.nextTab++
      },
      prevTab: () => {
        calls.prevTab++
      },
      tabSelector: () => {
        calls.tabSelector++
      },
    })

    pause()
    dispatchKeydown({ ctrlKey: true, key: 't' })
    resume()
    dispatchKeydown({ ctrlKey: true, key: 't' })

    expect(calls.newTab).toBe(1)
  })

  test('parseKeyCombo parses ctrl+t', () => {
    expect(parseKeyCombo('ctrl+t')).toEqual({
      altKey: false,
      ctrlKey: true,
      key: 't',
      shiftKey: false,
    })
  })

  test('parseKeyCombo parses ctrl+shift+tab', () => {
    expect(parseKeyCombo('ctrl+shift+tab')).toEqual({
      altKey: false,
      ctrlKey: true,
      key: 'Tab',
      shiftKey: true,
    })
  })

  test('Ctrl+K alias always fires tabSelector regardless of settings', () => {
    const calls = { newTab: 0, nextTab: 0, prevTab: 0, tabSelector: 0 }

    useHotkeys(
      makeSettingsRef({
        tabSelector: 'ctrl+l',
      }),
      {
        newTab: () => {
          calls.newTab++
        },
        nextTab: () => {
          calls.nextTab++
        },
        prevTab: () => {
          calls.prevTab++
        },
        tabSelector: () => {
          calls.tabSelector++
        },
      },
    )

    dispatchKeydown({ ctrlKey: true, key: 'k' })

    expect(calls.tabSelector).toBe(1)
  })
})
