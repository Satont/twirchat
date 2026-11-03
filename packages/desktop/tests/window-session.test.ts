import { describe, expect, test } from 'bun:test'

import type { NativeWindowBounds } from '../src/gpuix/native-window'
import {
  createWindowSessionController,
  MAX_DESKTOP_WINDOWS,
  validateWindowBounds,
  validateWindowSession,
  type DesktopWindowDescriptor,
  type ManagedWindowHandle,
  type WindowSession,
} from '../src/services/window-session'
import { literal } from './fixture-values'

const bounds = (width = 680): NativeWindowBounds => ({
  x: -100,
  y: 40,
  width,
  height: 820,
  mode: 'windowed',
})
const chat = (id = 'child'): DesktopWindowDescriptor => ({
  id: `window:${id}`,
  kind: 'chat',
  title: id,
  tabId: `window:tab-${id}`,
  clickThrough: false,
  bounds: bounds(),
})
function fixture(save: (session: WindowSession) => Promise<void> = async () => {}) {
  let emptied = 0
  const errors: unknown[] = []
  const controller = createWindowSessionController({
    save,
    onEmpty: () => {
      emptied++
    },
    onError: (error) => {
      errors.push(error)
    },
  })
  function handle(initial = bounds()): ManagedWindowHandle & {
    open: boolean
    closes: number
    disposed: number
    geometry: ReturnType<typeof bounds>
  } {
    return {
      open: true,
      closes: 0,
      disposed: 0,
      geometry: initial,
      isWindowOpen() {
        return this.open
      },
      getWindowBounds() {
        return this.geometry
      },
      closeWindow() {
        this.closes++
        this.open = false
      },
      dispose() {
        this.disposed++
      },
    }
  }
  return {
    controller,
    handle,
    errors,
    get emptied() {
      return emptied
    },
  }
}

describe('saved desktop window validation', () => {
  test('rejects malformed geometry and copies only known finite bounds', () => {
    expect(validateWindowBounds(bounds())).toEqual(bounds())
    for (const value of [
      null,
      {},
      { ...bounds(), x: Infinity },
      { ...bounds(), width: 239 },
      { ...bounds(), height: 159 },
      { ...bounds(), y: -1_000_001 },
      { ...bounds(), width: 32769 },
      { ...bounds(), mode: 'invalid' },
    ])
      expect(validateWindowBounds(value)).toBeUndefined()
    expect(validateWindowBounds({ ...bounds(), token: 'secret' })).not.toHaveProperty('token')
  })
  test('restores only supported persisted kinds, removes duplicates and enforces the limit', () => {
    const input = {
      version: 1,
      mainBounds: bounds(),
      windows: [
        chat(),
        chat(),
        { ...chat('overlay'), kind: 'overlay', clickThrough: true },
        { ...chat('user'), kind: 'user' },
        { ...chat('main'), kind: 'main' },
        { ...chat('bad'), id: '../bad' },
        { ...chat('bad-tab'), tabId: 'https://evil.test' },
        { ...chat('bad-title'), title: 'x'.repeat(257) },
        { ...chat('bad-click'), clickThrough: 'true' },
      ],
    }
    const value = validateWindowSession(input)
    expect(value.mainBounds).toEqual(bounds())
    expect(value.windows.map((window) => window.id)).toEqual(['window:child', 'window:overlay'])
    expect(
      validateWindowSession({
        version: 1,
        windows: Array.from({ length: 100 }, (_, index) => chat(`limit-${index}`)),
      }).windows,
    ).toHaveLength(MAX_DESKTOP_WINDOWS - 1)
    expect(() => validateWindowSession({ version: 2, windows: [] })).toThrow()
    expect(() => validateWindowSession(null)).toThrow()
  })
})

describe('window session lifecycle', () => {
  test('closing main keeps its child alive and each root is disposed exactly once', async () => {
    const f = fixture()
    const main = f.handle(),
      child = f.handle()
    f.controller.add({ id: 'main', kind: 'main', title: 'Main' }, main)
    f.controller.add(chat(), child)
    await f.controller.close('main')
    f.controller.poll()
    f.controller.closed('main')
    expect(main.closes).toBe(1)
    expect(main.disposed).toBe(1)
    expect(child.open).toBe(true)
    expect(child.disposed).toBe(0)
    expect(f.emptied).toBe(0)
    await f.controller.close('window:child')
    f.controller.poll()
    f.controller.closed('window:child')
    await f.controller.persist()
    await Promise.resolve()
    expect(child.disposed).toBe(1)
    expect(f.emptied).toBe(1)
  })
  test('quit persists open descriptors and latest bounds before any native close', async () => {
    const saved: WindowSession[] = [],
      order: string[] = []
    const f = fixture(async (session) => {
      saved.push(structuredClone(session))
      order.push('save')
    })
    const main = f.handle(),
      child = f.handle()
    f.controller.add({ id: 'main', kind: 'main', title: 'Main' }, main)
    f.controller.add(chat(), child)
    const nativeClose = child.closeWindow.bind(child)
    child.closeWindow = () => {
      order.push('close')
      nativeClose()
      f.controller.closed('window:child')
    }
    main.geometry = bounds(1111)
    child.geometry = bounds(777)
    await f.controller.quit()
    await f.controller.quit()
    f.controller.poll()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.mainBounds?.width).toBe(1111)
    expect(saved[0]?.windows[0]?.bounds?.width).toBe(777)
    expect(saved[0]?.windows[0]?.id).toBe('window:child')
    expect(order).toEqual(['save', 'close'])
    expect(main.closes).toBe(1)
    expect(child.closes).toBe(1)
    expect(() => f.controller.add(chat('late'), f.handle())).toThrow('closing')
  })
  test('snapshots latest geometry while excluding transient user windows', () => {
    const f = fixture(),
      main = f.handle(),
      child = f.handle()
    f.controller.restore({ version: 1, mainBounds: bounds(900), windows: [] })
    f.controller.add({ id: 'main', kind: 'main', title: 'Main' }, main)
    f.controller.add(chat(), child)
    f.controller.add(
      {
        id: 'user',
        kind: 'user',
        title: 'User',
        target: {
          platform: 'twitch',
          platformUserId: 'viewer',
          username: 'viewer',
          displayName: 'Viewer',
        },
      },
      f.handle(),
    )
    main.geometry = bounds(1200)
    child.geometry = bounds(800)
    const snapshot = f.controller.snapshot()
    child.geometry.width = 1000
    expect(snapshot.mainBounds?.width).toBe(1200)
    expect(snapshot.windows).toHaveLength(1)
    expect(snapshot.windows[0]?.bounds?.width).toBe(800)
    expect(f.controller.snapshot().windows[0]?.bounds?.width).toBe(1000)
  })
  test('enforces duplicate IDs and open window bound before adding handles', () => {
    const f = fixture()
    f.controller.add(chat(), f.handle())
    expect(() => f.controller.add(chat(), f.handle())).toThrow('already open')
    for (let index = 1; index < MAX_DESKTOP_WINDOWS; index++)
      f.controller.add(chat(`window-${index}`), f.handle())
    expect(() => f.controller.add(chat('overflow'), f.handle())).toThrow('Close a window')
    expect(f.controller.entries()).toHaveLength(MAX_DESKTOP_WINDOWS)
  })
  test('serializes failed and pending writes, retries without overwriting newer geometry', async () => {
    const written: number[] = []
    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    let attempts = 0
    const f = fixture(async (session) => {
      const width = session.windows[0]?.bounds?.width
      if (width === undefined) throw new Error('Expected saved window bounds.')
      if (++attempts === 1) {
        await gate
        throw new Error('disk failure')
      }
      written.push(width)
    })
    const child = f.handle()
    f.controller.add(chat(), child)
    const first = f.controller.persist()
    await Promise.resolve()
    child.geometry = bounds(900)
    const second = f.controller.persist()
    release()
    await expect(first).rejects.toThrow('disk failure')
    await second
    expect(f.errors).toHaveLength(1)
    expect(written).toEqual([900])
    child.geometry = bounds(1000)
    await f.controller.persist()
    expect(written).toEqual([900, 1000])
    await f.controller.persist()
    expect(written).toEqual([900, 1000])
  })
})

test('a failed save of an unchanged snapshot can be explicitly retried', async () => {
  let attempts = 0
  const f = fixture(async () => {
    if (++attempts === 1) throw new Error('disk unavailable')
  })
  f.controller.add(chat(), f.handle())
  await expect(f.controller.persist()).rejects.toThrow('disk unavailable')
  await f.controller.persist()
  expect(attempts).toBe(2)
  expect(f.errors).toHaveLength(1)
  await f.controller.persist()
  expect(attempts).toBe(2)
})

test('persisted bounds reject coercible numbers and unknown display modes', () => {
  for (const value of [
    null,
    [],
    { ...bounds(), x: '0' },
    { ...bounds(), width: NaN },
    { ...bounds(), y: Infinity },
    { ...bounds(), mode: 'floating' },
  ]) {
    expect(validateWindowBounds(value)).toBeUndefined()
  }
  for (const mode of literal(['windowed', 'maximized', 'fullscreen'])) {
    expect(validateWindowBounds({ ...bounds(), mode })?.mode).toBe(mode)
  }
})
