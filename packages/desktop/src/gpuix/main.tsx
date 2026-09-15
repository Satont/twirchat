/**
 * TwirChat — GPUIX desktop entry point.
 *
 * One Bun process hosts everything: the in-process backend (stores, platform
 * adapters, backend WS, overlay server) and the React UI rendered natively
 * by GPUI. Run with `bun --hot` so saving a file remounts React on the same
 * window while the backend (pinned on globalThis) keeps its connections.
 */

import { render, TooltipProvider } from '@gpuix/react'

import { getDesktopBackend } from './backend/server'
import { BackendContext } from './backend/context'
import { activeWatchedTabStore, loadInitialData, wireBackendToStores } from './state/app'
import { initCaches } from './state/caches'
import { handleGlobalKeyDown } from './state/hotkeys'
import { App } from './components/App'

const backend = getDesktopBackend()

// Session caches (avatars, mention colors) resolve through the backend bridge.
initCaches({
  resolveAvatar: (params) => backend.api.resolveAvatar(params),
  getUsernameColor: (params) => backend.api.getUsernameColor(params),
})

// Wiring must survive `bun --hot`: the entry re-runs on every save, but the
// backend singleton and its event subscriptions must be created only once.
const g = globalThis as { __twirchatGpuixWired?: boolean }
if (!g.__twirchatGpuixWired) {
  g.__twirchatGpuixWired = true
  wireBackendToStores(backend)
  void loadInitialData(backend)
}

render(
  <BackendContext.Provider value={backend}>
    <TooltipProvider delayDuration={300}>
      <App />
    </TooltipProvider>
  </BackendContext.Provider>,
  {
    title: 'TwirChat',
    width: 1200,
    height: 800,
    titlebarTransparent: process.platform === 'darwin',
    trafficLightX: 16,
    trafficLightY: 17,
    appName: 'TwirChat',
    // Agent-driven runs (screenshots, automation) must not steal focus.
    focus: process.env.GPUIX_BACKGROUND !== '1',
    onKeyDown(event) {
      handleGlobalKeyDown(event)
    },
  },
)

// Dev-only debug actions driven through POST :45824/dev/hook.
;(
  globalThis as { __twirchatDevHook?: (action: string, payload?: unknown) => Promise<unknown> }
).__twirchatDevHook = async (action, payload) => {
  const p = (payload ?? {}) as { tabId?: string; panelId?: string; direction?: string }
  const { layoutStore, splitPanel } = await import('./state/layout')
  if (action === 'dump-layout') {
    const tabId = p.tabId ?? activeWatchedTabStore.get()
    return layoutStore.get().get(tabId) ?? null
  }
  if (action === 'split') {
    const tabId = p.tabId ?? activeWatchedTabStore.get()
    const layout = layoutStore.get().get(tabId)?.layout
    if (!layout) return { error: 'no layout' }
    const firstPanel = findFirstPanel(layout.root)
    if (!firstPanel) return { error: 'no panel' }
    await splitPanel(
      backend,
      tabId,
      firstPanel.id,
      (p.direction as 'horizontal' | 'vertical') ?? 'vertical',
    )
    return layoutStore.get().get(tabId) ?? null
  }
  return { error: `unknown action: ${action}` }
}

function findFirstPanel(node: import('@twirchat/shared/types').LayoutNode): { id: string } | null {
  if (node.type === 'panel') return node
  for (const child of node.children) {
    const found = findFirstPanel(child)
    if (found) return found
  }
  return null
}
