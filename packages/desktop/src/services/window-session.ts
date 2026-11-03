import type { NativeWindowBounds } from '../gpuix/native-window'
import type { UserCardTarget } from '../views/main/utils/chatCommands'

export type DesktopWindowDescriptor = {
  id: string
  title: string
  bounds?: NativeWindowBounds
} & (
  | { kind: 'main' }
  | { kind: 'chat' | 'overlay'; tabId: string; clickThrough: boolean }
  | { kind: 'user'; target: UserCardTarget; pinned?: boolean }
)
export interface WindowSession {
  version: 1
  mainBounds?: NativeWindowBounds
  windows: DesktopWindowDescriptor[]
}
export const WINDOW_SESSION_KEY = 'desktop_windows_v1'
export const MAX_DESKTOP_WINDOWS = 24

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
export function validateWindowBounds(value: unknown): NativeWindowBounds | undefined {
  if (!isRecord(value)) return undefined
  const { x, y, width, height, mode } = value
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    Math.abs(x) > 1_000_000 ||
    Math.abs(y) > 1_000_000 ||
    width < 240 ||
    height < 160 ||
    width > 32768 ||
    height > 32768 ||
    (mode !== 'windowed' && mode !== 'maximized' && mode !== 'fullscreen')
  )
    return undefined
  return { x, y, width, height, mode }
}

/** Restore only known window kinds. Transient user cards never reopen on startup. */
export function validateWindowSession(value: unknown): WindowSession {
  if (!isRecord(value)) throw new Error('Invalid saved windows.')
  const input = value
  if (input.version !== 1 || !Array.isArray(input.windows))
    throw new Error('Invalid saved window session.')
  const windows: DesktopWindowDescriptor[] = []
  const ids = new Set<string>(['main'])
  for (const entry of input.windows.slice(0, MAX_DESKTOP_WINDOWS - 1)) {
    if (
      !isRecord(entry) ||
      (entry.kind !== 'chat' && entry.kind !== 'overlay') ||
      typeof entry.id !== 'string' ||
      !/^window:[a-z0-9-]{1,80}$/iu.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.title !== 'string' ||
      entry.title.length > 256 ||
      !('tabId' in entry) ||
      typeof entry.tabId !== 'string' ||
      !/^window:[a-z0-9-]{1,80}$/iu.test(entry.tabId) ||
      typeof entry.clickThrough !== 'boolean'
    )
      continue
    ids.add(entry.id)
    windows.push({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      tabId: entry.tabId,
      clickThrough: entry.clickThrough,
      bounds: validateWindowBounds(entry.bounds),
    })
  }
  return { version: 1, mainBounds: validateWindowBounds(input.mainBounds), windows }
}

export interface ManagedWindowHandle {
  isWindowOpen(): boolean
  getWindowBounds(): NativeWindowBounds | null
  closeWindow(): void
  dispose(): void
}

/** Owns close order and snapshots without depending on a native renderer in unit tests. */
export function createWindowSessionController(options: {
  save(session: WindowSession): Promise<void>
  onEmpty(): void
  onError(error: unknown): void
}) {
  const windows = new Map<
    string,
    { descriptor: DesktopWindowDescriptor; handle: ManagedWindowHandle }
  >()
  let mainBounds: NativeWindowBounds | undefined
  let shuttingDown = false
  let writes = Promise.resolve()
  let signature = ''
  const snapshot = (): WindowSession => {
    const restored: DesktopWindowDescriptor[] = []
    for (const { descriptor, handle } of windows.values()) {
      const bounds = validateWindowBounds(handle.getWindowBounds()) ?? descriptor.bounds
      if (descriptor.kind === 'main') mainBounds = bounds ?? mainBounds
      else if (descriptor.kind !== 'user') restored.push({ ...descriptor, bounds })
    }
    return { version: 1, mainBounds, windows: restored }
  }
  function persist(): Promise<void> {
    const session = snapshot()
    const next = JSON.stringify(session)
    if (next === signature) return writes
    signature = next
    const result = writes.then(() => options.save(session))
    writes = result.catch((error) => {
      signature = ''
      options.onError(error)
    })
    return result
  }
  function remove(id: string): void {
    const window = windows.get(id)
    if (!window) return
    if (window.descriptor.kind === 'main')
      mainBounds = validateWindowBounds(window.handle.getWindowBounds()) ?? mainBounds
    windows.delete(id)
    window.handle.dispose()
    if (!shuttingDown) void persist().catch(() => {})
    if (!windows.size) void writes.finally(options.onEmpty).catch(options.onError)
  }
  return {
    restore(session: WindowSession): void {
      mainBounds = session.mainBounds
    },
    add(descriptor: DesktopWindowDescriptor, handle: ManagedWindowHandle): void {
      if (shuttingDown) throw new Error('The application is closing.')
      if (windows.has(descriptor.id)) throw new Error('This window is already open.')
      if (windows.size >= MAX_DESKTOP_WINDOWS)
        throw new Error('Close a window before opening another.')
      windows.set(descriptor.id, { descriptor, handle })
    },
    entries: () => [...windows.values()],
    snapshot,
    persist,
    poll(): void {
      for (const [id, { handle }] of windows) if (!handle.isWindowOpen()) remove(id)
      if (!shuttingDown && windows.size) void persist().catch(() => {})
    },
    closed: remove,
    async close(id: string): Promise<void> {
      windows.get(id)?.handle.closeWindow()
    },
    async quit(): Promise<void> {
      if (shuttingDown) return
      shuttingDown = true
      // Remember the session before native close callbacks remove its windows.
      await persist().catch(() => {})
      for (const { handle } of windows.values()) handle.closeWindow()
    },
  }
}
