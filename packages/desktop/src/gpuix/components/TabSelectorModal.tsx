/**
 * Ctrl+K tab switcher — port of TabSelectorModal.vue: centered modal with a
 * fuzzy search input and keyboard-driven list.
 */

import { useMemo, useState } from 'react'

import { fuzzyFilter } from '../../views/main/utils/fuzzyFilter'
import { usePopupHotkeys } from '../hooks/use-popup-hotkeys'
import { useT } from '../i18n'
import { useTextInputFocusTracking } from '../state/focus'
import { platformColor } from '../theme'
import { useTheme } from '../theme-context'
import { Icon, PlatformIcon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'

export interface TabItem {
  id: string
  label: string
  platform?: string
  isLive?: boolean
}

export function TabSelectorModal({
  tabs,
  activeTabId,
  onSelect,
  onClose,
}: {
  tabs: TabItem[]
  activeTabId: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const theme = useTheme()
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const queryFocus = useTextInputFocusTracking()

  const filtered = useMemo(() => (query ? fuzzyFilter(tabs, query) : tabs), [tabs, query])
  const selected = Math.min(selectedIndex, Math.max(0, filtered.length - 1))

  const pick = (index: number) => {
    const item = filtered[index]
    if (!item) return
    onSelect(item.id)
    onClose()
  }

  const popupContextId = usePopupHotkeys('tab-selector', {
    accept: filtered[selected] ? () => pick(selected) : null,
    reject: onClose,
  })

  return (
    <Modal hotkeyContextId={popupContextId} width={400} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 420 }}>
        <div
          style={{
            padding: 12,
            borderBottomWidth: 1,
            borderColor: theme.border,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="search" size={14} color={theme.text2} />
          <input
            autoFocus
            value={query}
            placeholder={t('app.tabSelector.placeholder')}
            onChange={(event) => {
              setQuery(event.value ?? '')
              setSelectedIndex(0)
            }}
            {...queryFocus}
            onKeyDown={(event) => {
              if (event.key === 'down') {
                setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1))
              } else if (event.key === 'up') {
                setSelectedIndex((i) => Math.max(0, i - 1))
              } else if (event.key === 'escape') {
                onClose()
              }
            }}
            onSubmit={() => pick(selected)}
            theme={{ caret: theme.accent.primary }}
            style={{ flexGrow: 1, minWidth: 0, fontSize: 14, color: theme.text }}
          />
        </div>
        <div
          style={{
            overflowY: 'scroll',
            scrollbarColor: theme.scrollbar,
            scrollbarWidth: 4,
            padding: 4,
            flexShrink: 1,
          }}
        >
          {filtered.map((tab, index) => {
            const isActive = tab.id === activeTabId
            const isSelected = index === selected
            return (
              <div
                key={tab.id}
                onClick={() => pick(index)}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 10,
                  paddingRight: 10,
                  borderRadius: 6,
                  cursor: 'pointer',
                  backgroundColor: isSelected ? theme.accent.tint15 : undefined,
                }}
              >
                {tab.isLive ? (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: '#22c55e',
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                {tab.platform ? (
                  <PlatformIcon
                    platform={tab.platform}
                    size={12}
                    color={platformColor(tab.platform)}
                  />
                ) : (
                  <Icon name={tab.id === 'home' ? 'home' : 'chat'} size={12} color={theme.text2} />
                )}
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 700 : 400,
                    color: theme.text,
                    flexGrow: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                </Text>
              </div>
            )
          })}
          {filtered.length === 0 ? (
            <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
              <Text style={{ fontSize: 13, color: theme.text2 }}>{t('app.tabSelector.empty')}</Text>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
