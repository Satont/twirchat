import { useGpuixRequired } from '@gpuix/react'
import { useEffect, useState } from 'react'

import type { DesktopWindowDescriptor } from '../../services/window-session'
import { useBackend } from '../backend/context'
import { registerBundledFonts } from '../fonts'
import { parseHotkeyChoice } from '../hotkey-bindings'
import { useHotkeyContext, useHotkeyRoute } from '../state/action-bindings'
import { getActivePane } from '../state/active-pane'
import { settingsStore, showNotice } from '../state/app'
import { registerChatWindowNavigator, setChatWindowReading } from '../state/chat-windows'
import { useStore } from '../state/create-store'
import { useDesktopWindows } from '../state/desktop-windows'
import { registerHotkeyActions } from '../state/hotkeys'
import { allPanels, layoutStore, splitPanel, reopenClosedSplit } from '../state/layout'
import { messageSimilarityPreferences } from '../state/message-similarity'
import { saveStreamerMode } from '../state/streamer-mode'
import { changeWindowPresentation } from '../state/window-presentation'
import { useWindowScope } from '../state/window-scope'
import { withAlpha } from '../theme'
import { resolveTheme, resolveFont, ThemeContext, FontContext } from '../theme-context'
import { ChatNotice, UpdateToast } from './App'
import { SavedAccounts } from './SavedAccounts'
import { SearchAllChatsDialog } from './SearchAllChatsDialog'
import { SettingsPanel } from './SettingsPanel'
import { ActionButton } from './ui/Form'
import { Modal } from './ui/Modal'
import { UserCardDialog } from './UserCardDialog'
import { WatchedView } from './WatchedView'

export function ChatWindow({
  descriptor,
}: {
  descriptor: Exclude<DesktopWindowDescriptor, { kind: 'main' }>
}) {
  const backend = useBackend()
  const scope = useWindowScope()
  const windows = useDesktopWindows()
  const settings = useStore(settingsStore)
  const theme = resolveTheme(settings)
  const [page, setPage] = useState<'chat' | 'settings' | 'accounts'>('chat')
  const [search, setSearch] = useState(false)
  useEffect(() => registerChatWindowNavigator(scope, () => setPage('chat')), [scope])
  useEffect(() => {
    setChatWindowReading(scope, page === 'chat')
  }, [scope, page])
  registerBundledFonts(useGpuixRequired())
  const tabId = 'tabId' in descriptor ? descriptor.tabId : undefined
  useEffect(
    () =>
      registerHotkeyActions(
        {
          openAddChannel: () => {
            const panel = allPanels(
              tabId ? (layoutStore.get().get(tabId)?.layout ?? null) : null,
            )[0]
            if (tabId && panel)
              void splitPanel(backend, tabId, panel.id, 'vertical', scope).catch((error) =>
                showNotice('error', String(error)),
              )
          },
          openTabSelector: () => setPage('chat'),
          openAllChatSearch: () => setSearch(true),
          isChatActive: () => page === 'chat',
        },
        scope,
      ),
    [backend, scope, tabId, page],
  )
  useHotkeyContext({
    id: 'window',
    category: 'window',
    handlers: {
      quit: windows ? () => windows.quit() : null,
      toggleLocalR9K: async () => {
        await messageSimilarityPreferences.load(backend.api)
        const value = messageSimilarityPreferences.store.get().value
        await messageSimilarityPreferences.save(backend.api, {
          ...value,
          hideSimilar: !value.hideSimilar,
        })
      },
      setStreamerMode: ([mode]) =>
        saveStreamerMode(
          backend,
          parseHotkeyChoice(mode ?? 'toggle', ['on', 'off', 'auto', 'toggle']),
        ),
      openSettings: () => setPage('settings'),
      openAccountSelector: () => setPage('accounts'),
      reopenSplit: tabId ? () => reopenClosedSplit(backend, { scope, tabId }) : null,
      newSplit: tabId
        ? async () => {
            const layout = layoutStore.get().get(tabId)?.layout
            const active = getActivePane(scope)
            const panel =
              allPanels(layout ?? null).find(
                (panel) => `${tabId}:${panel.id}` === active?.paneId,
              ) ?? allPanels(layout ?? null)[0]
            if (panel) await splitPanel(backend, tabId, panel.id, 'vertical', scope)
          }
        : null,
      popup:
        tabId && windows
          ? ([kind]) =>
              windows.openChat(
                tabId,
                kind === 'split' ? getActivePane(scope)?.paneId.slice(tabId.length + 1) : undefined,
              )
          : null,
      zoom: ([argument]) => changeWindowPresentation(backend.api, scope, 'zoom', argument),
    },
  })
  useHotkeyRoute(['window'])
  return (
    <ThemeContext.Provider value={theme}>
      <FontContext.Provider value={resolveFont(settings)}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: theme.bg,
            selectionColor: withAlpha(theme.accent.primary, 0.35),
            position: 'relative',
          }}
        >
          {page !== 'chat' ? (
            <div style={{ padding: 8 }}>
              <ActionButton onClick={() => setPage('chat')}>Back to chat</ActionButton>
            </div>
          ) : null}
          {page === 'settings' ? (
            <SettingsPanel />
          ) : descriptor.kind === 'user' ? (
            <UserCardDialog
              target={descriptor.target}
              standalone
              onClose={() => void windows?.close()}
            />
          ) : (
            <WatchedView tabId={descriptor.tabId} onGoToPlatforms={() => setPage('accounts')} />
          )}
          {search ? <SearchAllChatsDialog onClose={() => setSearch(false)} /> : null}
          {page === 'accounts' ? (
            <Modal width={620} onClose={() => setPage('chat')}>
              <SavedAccounts />
            </Modal>
          ) : null}
          <ChatNotice />
          <UpdateToast />
        </div>
      </FontContext.Provider>
    </ThemeContext.Provider>
  )
}
