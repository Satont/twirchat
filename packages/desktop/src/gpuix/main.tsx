/**
 * TwirChat — GPUIX desktop entry point.
 *
 * One Bun process hosts everything: the in-process backend (stores, platform
 * adapters, backend WS, overlay server) and the React UI rendered natively
 * by GPUI. Run with `bun --hot` so saving a file remounts React on the same
 * window while the backend (pinned on globalThis) keeps its connections.
 */

import './native-bootstrap'
import { z } from 'zod'

import { APP_ENV } from '../build-info'
import { getDbPath, setRuntimeConfig } from '../runtime-config'
import { exitAfterFlushingDiagnosticLogs } from '../services/diagnostic-logging'
import { assertGuiQaEnvironment } from '../services/gui-qa'
import { establishLinuxSingleInstance } from '../services/linux-single-instance'
import { getDesktopBackend } from './backend/server'
import { App } from './components/App'
import { ChatWindow } from './components/ChatWindow'
import { t } from './i18n'
import { loadActionBindings } from './state/action-bindings'
import { wireProviderChannelFocus } from './state/active-pane'
import {
  activeWatchedTabStore,
  loadInitialData,
  wireBackendToStores,
  showNotice,
} from './state/app'
import { initAvatarCache } from './state/caches'
import { wireChannelState } from './state/channel-state'
import { loadChatPausePreferences } from './state/chat-pause'
import { chatRulesPreferences } from './state/chat-rules'
import { initCosmeticCaches } from './state/cosmetics'
import { loadEmotePreferences } from './state/emote-preferences'
import {
  notificationPreferences,
  wireHighlightNotifications,
} from './state/highlight-notifications'
import { loadMessageSimilaritySettings } from './state/message-similarity'
import { loadStreamerMode, wireStreamerMode } from './state/streamer-mode'
import { wireTabUnread } from './state/tab-unread'
import { loadTranslationSettings, wireAutoTranslations } from './state/translation'
import { wireTwitchActivities } from './state/twitch-activities'
import { wireTwitchAutoMod } from './state/twitch-automod'
import { wireActiveWatchedChannels } from './state/watched-subscriptions'
import { windowPresentationPreferences } from './state/window-presentation'
import { mountDesktopWindows } from './window-manager'

if (process.env.TWIRCHAT_GUI_QA === '1') assertGuiQaEnvironment()
else if (process.platform === 'linux' && process.env.GPUIX_BACKGROUND === '1') {
  throw new Error('Background GUI tests require the isolated qa:gui launcher.')
}
setRuntimeConfig({ nodeEnv: APP_ENV })
const instance = await establishLinuxSingleInstance(getDbPath())
if (instance.kind === 'forwarded') process.exit(0)
const backend = getDesktopBackend()
initCosmeticCaches(backend.api)
void Promise.all([
  loadEmotePreferences(backend.api),
  loadActionBindings(backend.api),
  windowPresentationPreferences.load(backend.api),
  loadMessageSimilaritySettings(backend),
  loadChatPausePreferences(backend.api),
  loadStreamerMode(backend),
  chatRulesPreferences.load(backend.api),
  notificationPreferences.load(backend.api),
  loadTranslationSettings(backend),
]).catch((error) =>
  showNotice('error', t('notices.startup.preferencesFailed', { error: String(error) })),
)

initAvatarCache((params) => backend.api.resolveAvatar(params))

// Wiring must survive `bun --hot`: the entry re-runs on every save, but the
// backend singleton and its event subscriptions must be created only once.
declare global {
  var __twirchatGpuixWired: boolean | undefined
  var __twirchatTabUnreadWired: boolean | undefined
  var __twirchatChannelStateWired: boolean | undefined
  var __twirchatActivitiesWired: boolean | undefined
  var __twirchatHighlightNotificationsWired: boolean | undefined
  var __twirchatTranslationsWired: boolean | undefined
  var __twirchatProviderFocusWired: boolean | undefined
  var __twirchatStreamerModeWired: boolean | undefined
  var __twirchatWatchedSubscriptionsWired: boolean | undefined
}
const g = globalThis

if (!g.__twirchatGpuixWired) {
  g.__twirchatGpuixWired = true
  wireBackendToStores(backend)
  void loadInitialData(backend).catch((error) =>
    showNotice('error', t('notices.startup.chatStateFailed', { error: String(error) })),
  )
}
if (!g.__twirchatTabUnreadWired) {
  g.__twirchatTabUnreadWired = true
  wireTabUnread(backend)
}
if (!g.__twirchatChannelStateWired) {
  g.__twirchatChannelStateWired = true
  wireChannelState(backend)
}
if (!g.__twirchatActivitiesWired) {
  g.__twirchatActivitiesWired = true
  wireTwitchActivities(backend)
  wireTwitchAutoMod(backend.events)
}
if (!g.__twirchatHighlightNotificationsWired) {
  g.__twirchatHighlightNotificationsWired = true
  wireHighlightNotifications(backend)
}
if (!g.__twirchatTranslationsWired) {
  g.__twirchatTranslationsWired = true
  wireAutoTranslations(backend)
}
if (!g.__twirchatProviderFocusWired) {
  g.__twirchatProviderFocusWired = true
  wireProviderChannelFocus(backend)
}
if (!g.__twirchatStreamerModeWired) {
  g.__twirchatStreamerModeWired = true
  wireStreamerMode(backend)
}
if (!g.__twirchatWatchedSubscriptionsWired) {
  g.__twirchatWatchedSubscriptionsWired = true
  wireActiveWatchedChannels(backend)
}

async function shutdownDesktop(): Promise<void> {
  const stopActivation = instance.kind === 'primary' ? instance.stopActivation() : undefined
  await Promise.allSettled([stopActivation, backend.shutdownPlugins?.()])
  backend.dispose?.()
}

const windows = mountDesktopWindows(
  backend,
  (descriptor) => {
    if (descriptor.kind === 'main') return <App />
    return <ChatWindow descriptor={descriptor} />
  },
  () => {
    void shutdownDesktop().then(exitAfterFlushingDiagnosticLogs, exitAfterFlushingDiagnosticLogs)
  },
)

if (instance.kind === 'primary') instance.bindActivation(() => windows.activate())

// Dev-only debug actions driven through POST :55824/dev/hook by default.
const debugPayloadSchema = z.object({
  tabId: z.string().optional(),
  panelId: z.string().optional(),
  direction: z.enum(['horizontal', 'vertical']).optional(),
})
globalThis.__twirchatDevHook = async (action, payload) => {
  const p = debugPayloadSchema.parse(payload ?? {})
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
    await splitPanel(backend, tabId, firstPanel.id, p.direction ?? 'vertical')
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
