import {
  collectGarbageWhenIdle,
  createRenderer,
  createRoot,
  flushSync,
  startFrameLoop,
  TooltipProvider,
  type Root,
  type FrameLoop,
} from '@gpuix/react'
import type { ReactNode } from 'react'

import { registerWindowsNotificationHandler } from '../services/system-integration'
import {
  createWindowSessionController,
  MAX_DESKTOP_WINDOWS,
  validateWindowSession,
  WINDOW_SESSION_KEY,
  type DesktopWindowDescriptor,
  type WindowSession,
} from '../services/window-session'
import { BackendContext } from './backend/context'
import type { DesktopBackend } from './backend/server'
import { registerBundledFonts } from './fonts'
import { initializeManagedRenderer } from './managed-renderer'
import { nativeWindow, type NativeWindowOptions, type NativeWindowControls } from './native-window'
import { observeNativeHotkeyPlan } from './state/action-bindings'
import { clearWindowActivePane } from './state/active-pane'
import { showNotice } from './state/app'
import { chatRulesPreferences, chatRulesStore } from './state/chat-rules'
import { registerChatWindow, registerChatWindowManager } from './state/chat-windows'
import { DesktopWindowsContext, type DesktopWindows } from './state/desktop-windows'
import { notificationPreferences } from './state/highlight-notifications'
import { handleGlobalKeyDown } from './state/hotkeys'
import {
  cloneLayoutForWindow,
  saveLayoutNow,
  layoutStore,
  cleanupWindowLayoutFocus,
} from './state/layout'
import { createSystemTray } from './state/system-tray'
import { updateWindowActivity, clearWindowActivity } from './state/window-activity'
import { WindowScaleProvider } from './state/window-scale'
import { WindowScopeContext } from './state/window-scope'
import { registerWindowVisibility, updateWindowVisibility } from './state/window-visibility'

type Renderer = ReturnType<typeof createRenderer> & NativeWindowControls
interface MountedWindow {
  descriptor: DesktopWindowDescriptor
  renderer: Renderer
  root: Root
  loop?: FrameLoop
  wasActive?: boolean
  stopChatRegistration?: () => void
  stopHotkeyPlan?: () => void
  stopVisibility?: () => void
}
export type WindowContentFactory = (descriptor: DesktopWindowDescriptor) => ReactNode
const WINDOW_MANAGER_VERSION = 8

interface WindowUiRuntime {
  createRoot(renderer: Renderer, id: string): Root
  render(root: Root, backend: DesktopBackend, context: DesktopWindows, content: ReactNode): void
  startLoop(renderer: Renderer, onTerminated: () => void): FrameLoop
  observeHotkeys(renderer: Renderer, id: string): () => void
}

// A retained native controller must receive the current React module graph on every reload.
const currentUiRuntime: WindowUiRuntime = {
  createRoot(renderer, id) {
    return createRoot(renderer, {
      onKeyDown: (event) => {
        updateWindowActivity(id, renderer.isWindowActive(), event.modifiers)
        handleGlobalKeyDown(event, id)
      },
      onKeyUp: (event) => updateWindowActivity(id, renderer.isWindowActive(), event.modifiers),
      onUncaughtError: (error) => {
        console.error(`[windows] React render failed in ${id}:`, error)
        showNotice('error', `Window error: ${String(error)}`)
      },
    })
  },
  render(root, backend, context, content) {
    flushSync(() =>
      root.render(
        <BackendContext.Provider value={backend}>
          <WindowScopeContext.Provider value={context.descriptor.id}>
            <DesktopWindowsContext.Provider value={context}>
              <WindowScaleProvider>
                <TooltipProvider delayDuration={300}>{content}</TooltipProvider>
              </WindowScaleProvider>
            </DesktopWindowsContext.Provider>
          </WindowScopeContext.Provider>
        </BackendContext.Provider>,
      ),
    )
  },
  startLoop: (renderer, onTerminated) => startFrameLoop(renderer, { onTerminated }),
  observeHotkeys: (renderer, id) =>
    observeNativeHotkeyPlan(id, (plan) => renderer.setHotkeyPlan(JSON.stringify(plan))),
}

/** Each window owns its React root, native editor, event route and lifetime. */
export class DesktopWindowManager {
  readonly runtimeVersion = WINDOW_MANAGER_VERSION
  private readonly mounted = new Map<string, MountedWindow>()
  private readonly session
  private readonly poller: ReturnType<typeof setInterval>
  private stopIdleGc?: () => void
  private factory: WindowContentFactory
  private pendingActivation = false
  private ready = false
  private started = false
  private opening = 0
  private quitting = false
  private readonly cleanupTasks = new Set<Promise<void>>()
  private nextSessionPoll = 0
  private readonly stopRegistry: () => void
  private readonly tray: ReturnType<typeof createSystemTray>
  private readonly stopWindowsNotifications: () => void

  constructor(
    private readonly backend: DesktopBackend,
    factory: WindowContentFactory,
    private readonly onEmpty: () => void,
    private uiRuntime: WindowUiRuntime = currentUiRuntime,
  ) {
    this.factory = factory
    this.stopRegistry = registerChatWindowManager()
    this.tray = createSystemTray({
      windows: () =>
        [...this.mounted.values()].map(({ descriptor, renderer }) => ({
          id: descriptor.id,
          isOpen: () => renderer.isWindowOpen(),
          configure: (enabled, notifications) => renderer.configureTray(enabled, notifications),
          takeEvents: () => renderer.takeTrayEvents(),
          activate: () => renderer.activateWindow(),
        })),
      notificationsEnabled: () => {
        const preferences = notificationPreferences.store.get().value
        return preferences.enabled && preferences.mentionsEnabled
      },
      toggleNotifications: async () => {
        const preferences = notificationPreferences.store.get().value
        const enabled = !(preferences.enabled && preferences.mentionsEnabled)
        await notificationPreferences.save(backend.api, {
          ...preferences,
          enabled: enabled || preferences.enabled,
          mentionsEnabled: enabled,
        })
      },
      quit: () => this.quit(),
      failed: (error) => showNotice('error', `System tray is unavailable: ${String(error)}`),
    })
    this.stopWindowsNotifications =
      process.platform === 'win32'
        ? registerWindowsNotificationHandler(async ({ title, body }) => {
            const windows = [...this.mounted.values()]
            windows.sort(
              (left, right) =>
                Number(right.descriptor.kind === 'main') - Number(left.descriptor.kind === 'main'),
            )
            for (const window of windows) {
              if (!window.renderer.isWindowOpen()) continue
              // Only one native window owns the application tray.
              // eslint-disable-next-line no-await-in-loop
              if (await window.renderer.notifyFromTray(title, body)) return
            }
            throw new Error('The Windows notification tray is unavailable.')
          })
        : () => {}
    this.session = createWindowSessionController({
      save: (session) =>
        backend.api.setUiState({ key: WINDOW_SESSION_KEY, value: JSON.stringify(session) }),
      onEmpty: () => {
        this.quitting = true
        this.stopWindowsNotifications()
        clearInterval(this.poller)
        this.stopIdleGc?.()
        this.stopIdleGc = undefined
        this.stopRegistry()
        void Promise.allSettled(this.cleanupTasks)
          .then(() => this.flushLayouts())
          .catch((error) => console.error('[windows] final save:', error))
          .finally(this.onEmpty)
      },
      onError: (error) => showNotice('error', `Could not save windows: ${String(error)}`),
    })
    this.poller = setInterval(() => {
      for (const window of this.mounted.values()) {
        const active = window.renderer.isWindowActive()
        updateWindowActivity(window.descriptor.id, active)
        updateWindowVisibility(window.descriptor.id, window.renderer.getWindowVisibility())
        if (active) window.wasActive = true
        else if (window.wasActive && window.descriptor.kind === 'user' && !window.descriptor.pinned)
          window.renderer.closeWindow()
      }
      this.tray.refresh().catch((error) => console.error('[tray]', error))
      if (Date.now() >= this.nextSessionPoll) {
        this.nextSessionPoll = Date.now() + 500
        this.session.poll()
      }
    }, 100)
    this.poller.unref()
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    let saved: WindowSession = { version: 1, windows: [] }
    try {
      const raw = await this.backend.api.getUiState({ key: WINDOW_SESSION_KEY })
      if (raw) saved = { mainBounds: undefined, ...validateWindowSession(JSON.parse(raw)) }
    } catch (error) {
      showNotice('error', `Could not restore windows: ${String(error)}`)
    }
    this.session.restore(saved)
    await this.open({ id: 'main', kind: 'main', title: 'TwirChat', bounds: saved.mainBounds })
    this.ready = true
    if (this.pendingActivation) this.activate()
    // Serial creation bounds GPU allocations and avoids simultaneous AppKit startup.
    for (const descriptor of saved.windows) {
      try {
        await this.open(descriptor)
      } catch (error) {
        showNotice('error', `Could not restore ${descriptor.title}: ${String(error)}`)
      }
    }
    await this.session.persist().catch(() => {})
    if (this.mounted.size) this.stopIdleGc = collectGarbageWhenIdle()
  }

  activate(): boolean {
    if (this.quitting) return false
    if (!this.ready) {
      this.pendingActivation = true
      return true
    }
    this.pendingActivation = false
    const main = this.mounted.get('main')
    const target = main?.renderer.isWindowOpen()
      ? main
      : [...this.mounted.values()].find((window) => window.renderer.isWindowOpen())
    if (!target) return false
    target.renderer.activateWindow()
    return true
  }

  remount(factory: WindowContentFactory, runtime: WindowUiRuntime = this.uiRuntime): void {
    this.factory = factory
    for (const window of this.mounted.values()) {
      window.loop?.stop()
      window.stopHotkeyPlan?.()
      window.root.unmount()
    }
    this.uiRuntime = runtime
    for (const window of this.mounted.values()) {
      window.root = this.uiRuntime.createRoot(window.renderer, window.descriptor.id)
      this.render(window)
      window.stopHotkeyPlan = this.uiRuntime.observeHotkeys(window.renderer, window.descriptor.id)
      window.loop = this.uiRuntime.startLoop(window.renderer, () =>
        this.session.closed(window.descriptor.id),
      )
    }
  }

  private render(window: MountedWindow): void {
    const descriptor = window.descriptor
    const context: DesktopWindows = {
      descriptor,
      pinned: descriptor.kind === 'user' && descriptor.pinned === true,
      setPinned: (pinned) => {
        if (descriptor.kind !== 'user') return
        descriptor.pinned = pinned
        setTimeout(() => {
          if (this.mounted.has(descriptor.id)) this.render(window)
        }, 0)
      },
      openChat: (tabId, panelId, overlay) => this.openChat(tabId, panelId, overlay),
      openUser: (target) => this.openUser(target),
      close: () => this.close(descriptor.id),
      quit: () => this.quit(),
      toggleOverlayInertia: (target) => this.toggleOverlayInertia(descriptor.id, target),
    }
    this.uiRuntime.render(window.root, this.backend, context, this.factory(descriptor))
  }

  private async open(descriptor: DesktopWindowDescriptor): Promise<string> {
    if (this.mounted.size + this.opening >= MAX_DESKTOP_WINDOWS)
      throw new Error('Close a window before opening another.')
    this.opening++
    let renderer: Renderer | undefined
    let window: MountedWindow | undefined
    try {
      const native = nativeWindow(createRenderer())
      const cleanupMethods = new Set([
        'applyBatch',
        'destroyElement',
        'removeChild',
        'setRoot',
        'setWindowKeyEvents',
        'setWindowSelectionChange',
      ])
      // Keep the renderer identity: GPUIX event dispatch keys its registry by
      // this exact object. A Proxy would paint correctly but lose all input.
      renderer = native
      for (const property of cleanupMethods) {
        const value = Reflect.get(native, property, native)
        if (typeof value !== 'function') continue
        Object.defineProperty(native, property, {
          configurable: true,
          value: (...args: unknown[]) => {
            if (!native.isWindowOpen()) return property === 'applyBatch' ? [] : undefined
            return value.apply(native, args)
          },
        })
      }
      const bounds = descriptor.bounds
      const options: NativeWindowOptions = {
        title: descriptor.title,
        appName: 'TwirChat',
        appId:
          process.env.TWIRCHAT_GUI_QA === '1' ? process.env.TWIRCHAT_QA_APP_ID : 'dev.twirchat.app',
        width:
          bounds?.width ??
          (descriptor.kind === 'main' ? 1200 : descriptor.kind === 'user' ? 820 : 600),
        height: bounds?.height ?? (descriptor.kind === 'main' ? 800 : 720),
        minWidth: 320,
        minHeight: 240,
        kind: descriptor.kind === 'overlay' || descriptor.kind === 'user' ? 'floating' : 'normal',
        focus: process.env.GPUIX_BACKGROUND !== '1',
        ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
      }
      initializeManagedRenderer(renderer, options)
      registerBundledFonts(renderer)
      window = { descriptor, renderer, root: this.uiRuntime.createRoot(renderer, descriptor.id) }
      window.stopVisibility = registerWindowVisibility(descriptor.id, () =>
        native.getWindowVisibility(),
      )
      if (descriptor.kind === 'main' || 'tabId' in descriptor)
        window.stopChatRegistration = registerChatWindow(descriptor.id, {
          ...('tabId' in descriptor ? { tabId: descriptor.tabId } : {}),
          reading: true,
          activate: () => renderer!.activateWindow(),
        })
      this.mounted.set(descriptor.id, window)
      this.session.add(descriptor, {
        isWindowOpen: () => renderer!.isWindowOpen(),
        getWindowBounds: () => renderer!.getWindowBounds(),
        closeWindow: () => renderer!.closeWindow(),
        dispose: () => {
          window!.loop?.stop()
          window!.stopHotkeyPlan?.()
          try {
            window!.root.unmount()
          } catch (error) {
            console.error('[windows] unmount:', error)
          }
          this.mounted.delete(descriptor.id)
          window!.stopChatRegistration?.()
          window!.stopVisibility?.()
          clearWindowActivePane(descriptor.id)
          cleanupWindowLayoutFocus(descriptor.id)
          clearWindowActivity(descriptor.id)
          if (!this.quitting && 'tabId' in descriptor) {
            const cleanup = this.session
              .persist()
              .then(() => this.cleanupLayout(descriptor.tabId))
              .catch((error) => {
                showNotice('error', `Could not remove closed window data: ${String(error)}`)
              })
              .finally(() => this.cleanupTasks.delete(cleanup))
            this.cleanupTasks.add(cleanup)
          }
        },
      })
      window.loop = this.uiRuntime.startLoop(renderer, () => this.session.closed(descriptor.id))
      window.stopHotkeyPlan = this.uiRuntime.observeHotkeys(renderer, descriptor.id)
      this.render(window)
      if (bounds?.mode && bounds.mode !== 'windowed')
        await renderer.setWindowBounds({ mode: bounds.mode })
      if (descriptor.kind === 'overlay' && descriptor.clickThrough) {
        if (!renderer.getWindowCapabilities().clickThrough) {
          descriptor.clickThrough = false
          showNotice('error', 'This compositor does not support overlay click-through.')
        } else await renderer.setClickThrough(true)
      }
      return descriptor.id
    } catch (error) {
      if (window) this.session.closed(descriptor.id)
      renderer?.closeWindow()
      throw error
    } finally {
      this.opening--
    }
  }

  async openChat(sourceTabId: string, sourcePanelId?: string, overlay = false): Promise<string> {
    if (this.mounted.size + this.opening >= MAX_DESKTOP_WINDOWS)
      throw new Error('Close a window before opening another.')
    const { tabId } = await cloneLayoutForWindow(this.backend, sourceTabId, sourcePanelId)
    let id: string
    try {
      id = await this.open({
        id: `window:${crypto.randomUUID()}`,
        kind: overlay ? 'overlay' : 'chat',
        title: overlay ? 'TwirChat overlay' : 'TwirChat chat',
        tabId,
        clickThrough: false,
      })
    } catch (error) {
      await this.backend.api.removeWatchedChannelsLayout({ tabId }).catch(() => {})
      throw error
    }
    await this.session.persist().catch(() => {})
    return id
  }

  async openUser(
    target: import('../views/main/utils/chatCommands').UserCardTarget,
  ): Promise<string> {
    return this.open({
      id: `window:${crypto.randomUUID()}`,
      kind: 'user',
      title: `TwirChat — ${target.username ?? target.platformUserId}`,
      target: structuredClone(target),
    })
  }

  async close(id: string): Promise<void> {
    const descriptor = this.mounted.get(id)?.descriptor
    if (descriptor && 'tabId' in descriptor) await saveLayoutNow(this.backend, descriptor.tabId)
    await this.session.close(id)
  }

  async quit(): Promise<void> {
    await this.flushLayouts()
    this.quitting = true
    await this.tray.stop()
    await this.session.quit()
  }

  private async flushLayouts(): Promise<void> {
    await Promise.all(
      [...layoutStore.get()]
        .filter(([, state]) => state.layout)
        .map(([tabId]) => saveLayoutNow(this.backend, tabId)),
    )
  }

  private async cleanupLayout(tabId: string): Promise<void> {
    await saveLayoutNow(this.backend, tabId)
    await this.backend.api.removeWatchedChannelsLayout({ tabId })
    layoutStore.modify((entries) => {
      const next = new Map(entries)
      next.delete(tabId)
      return next
    })
    const rules = chatRulesStore.get().value
    const paneFilters = Object.fromEntries(
      Object.entries(rules.paneFilters).filter(([key]) => !key.startsWith(`${tabId}:`)),
    )
    if (Object.keys(paneFilters).length !== Object.keys(rules.paneFilters).length)
      await chatRulesPreferences.save(this.backend.api, { ...rules, paneFilters })
  }

  async toggleOverlayInertia(id: string, target: 'this' | 'thisOrAll' | 'all'): Promise<void> {
    const own = this.mounted.get(id)
    const targets =
      target === 'this' || (target === 'thisOrAll' && own?.descriptor.kind === 'overlay')
        ? own?.descriptor.kind === 'overlay'
          ? [own]
          : []
        : [...this.mounted.values()].filter((window) => window.descriptor.kind === 'overlay')
    if (!targets.length) throw new Error('There is no overlay window to change.')
    const enabled = !targets.every(
      ({ descriptor }) => 'clickThrough' in descriptor && descriptor.clickThrough,
    )
    const unsupported = targets.find(
      ({ renderer }) => !renderer.getWindowCapabilities().clickThrough,
    )
    if (unsupported) throw new Error('This compositor does not support overlay click-through.')
    const changed: MountedWindow[] = []
    try {
      for (const window of targets) {
        await window.renderer.setClickThrough(enabled)
        changed.push(window)
      }
    } catch (error) {
      await Promise.allSettled(
        changed.map((window) =>
          window.renderer.setClickThrough(
            'clickThrough' in window.descriptor && window.descriptor.clickThrough,
          ),
        ),
      )
      throw error
    }
    for (const window of targets)
      if ('clickThrough' in window.descriptor) window.descriptor.clickThrough = enabled
    await this.session.persist()
  }
}

export function mountDesktopWindows(
  backend: DesktopBackend,
  factory: WindowContentFactory,
  onEmpty: () => void,
): DesktopWindowManager {
  const global = globalThis
  if (global.__twirchatWindows) {
    if (global.__twirchatWindows.runtimeVersion !== WINDOW_MANAGER_VERSION)
      throw new Error('Restart TwirChat once to apply the hot-reload runtime upgrade.')
    global.__twirchatWindows.remount(factory, currentUiRuntime)
  } else {
    const manager = new DesktopWindowManager(backend, factory, onEmpty)
    global.__twirchatWindows = manager
    void manager.start().catch((error) => {
      console.error('[windows] startup:', error)
      onEmpty()
    })
  }
  return global.__twirchatWindows
}

declare global {
  var __twirchatWindows: DesktopWindowManager | undefined
}
