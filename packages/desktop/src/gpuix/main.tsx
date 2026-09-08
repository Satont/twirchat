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
import { loadInitialData, wireBackendToStores } from './state/app'
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
