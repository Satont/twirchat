import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import type { EmoteCatalogEntry, EmoteSource } from '@twirchat/shared/protocol'
import type { Platform } from '@twirchat/shared/types'
/**
 * Emote picker — port of EmotePicker.vue onto GPUIX: native search input +
 * a <virtual-list> of heading / 7-cell grid rows inside an anchored overlay.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { groupEmoteCatalog } from '../../views/main/utils/emote-catalog'
import { fuzzyFilter } from '../../views/main/utils/fuzzyFilter'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import {
  focusPopupSearch,
  popupTabIndex,
  scrollPopupPage,
  usePopupHotkeys,
} from '../hooks/use-popup-hotkeys'
import { nativeWindow } from '../native-window'
import { emoteStore, loadEmotes } from '../state/app'
import { useStore } from '../state/create-store'
import { emotePreferencesStore, loadEmotePreferences } from '../state/emote-preferences'
import { useTextInputFocusTracking } from '../state/focus'
import { useOverlayClose } from '../state/overlays'
import { useTheme } from '../theme-context'
import { EmoteTooltip } from './ui/EmoteTooltip'
import { ActionButton } from './ui/Form'
import { Icon } from './ui/Icon'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

type PickerSource = EmoteSource | 'favorites'

const ITEMS_PER_ROW = 7
const CELL_WIDTH = 41

type PickerRow =
  | { kind: 'heading'; source: PickerSource; label: string }
  | { kind: 'emotes'; source: PickerSource; entries: EmoteCatalogEntry[] }

const EMPTY_EMOTES: EmoteCatalogEntry[] = []

export function EmotePicker({
  platform,
  channelId,
  useSessionCache,
  onSelect,
  onClose,
}: {
  platform: Platform
  channelId: string
  useSessionCache: boolean
  onSelect: (alias: string) => void
  onClose: () => void
}) {
  const theme = useTheme()
  const backend = useBackend()
  const emotes = useStore(emoteStore)
  const preferences = useStore(emotePreferencesStore)
  const renderer = useGpuixRequired()
  const searchRef = useRef<PublicInstance | null>(null)
  const listRef = useRef<PublicInstance | null>(null)
  const [selectedSource, setSelectedSource] = useState<PickerSource | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchFocus = useTextInputFocusTracking()

  const cacheKey = `${platform}:${channelId}`
  const allEmotes = emotes.get(cacheKey) ?? EMPTY_EMOTES
  const isLoading = allEmotes.length === 0 && !emotes.has(cacheKey)

  useEffect(() => {
    runUiTask(loadEmotes(backend, platform, channelId, useSessionCache))
    runUiTask(loadEmotePreferences(backend.api))
  }, [backend, platform, channelId, useSessionCache])

  const groups = useMemo(() => {
    const grouped: Array<{ source: PickerSource; label: string; entries: EmoteCatalogEntry[] }> =
      groupEmoteCatalog(allEmotes, searchQuery)
    const favorites = fuzzyFilter(
      preferences.value.favorites.map((entry) => ({ label: entry.alias, entry })),
      searchQuery,
    ).map(({ entry }) => entry)
    if (favorites.length)
      grouped.unshift({ source: 'favorites', label: 'Favorites', entries: favorites })
    return grouped
  }, [allEmotes, searchQuery, preferences.value.favorites])
  const activeSource = groups.some((group) => group.source === selectedSource)
    ? selectedSource
    : groups[0]?.source
  const activeIndex = Math.max(
    0,
    groups.findIndex((group) => group.source === activeSource),
  )
  const pickerRows = useMemo((): PickerRow[] => {
    const rows: PickerRow[] = []
    for (const group of groups.filter((group) => group.source === activeSource)) {
      rows.push({ kind: 'heading', source: group.source, label: group.label })
      for (let index = 0; index < group.entries.length; index += ITEMS_PER_ROW) {
        rows.push({
          kind: 'emotes',
          source: group.source,
          entries: group.entries.slice(index, index + ITEMS_PER_ROW),
        })
      }
    }
    return rows
  }, [groups, activeSource])
  useEffect(() => {
    if (listRef.current) renderer.scrollToItem?.(listRef.current.id, 0)
  }, [renderer, activeSource, searchQuery])
  const popupContextId = usePopupHotkeys('emotes', {
    delete: onClose,
    search: () => focusPopupSearch(nativeWindow(renderer), searchRef),
    openTab: groups.length
      ? ([target]) => {
          const index = popupTabIndex(activeIndex, target!, groups.length)
          if (index !== null) setSelectedSource(groups[index]!.source)
        }
      : null,
    scrollPage: pickerRows.length
      ? ([direction]) => scrollPopupPage(renderer, listRef, direction!)
      : null,
  })

  useOverlayClose(true, onClose, popupContextId)

  return (
    <anchored deferred side="top" align="end" gap={8}>
      {/* <anchored> supports only click/hover/fileDrop events, so
          onMouseDownOutside must live on the content div. */}
      <div
        onMouseDownOutside={onClose}
        style={{
          width: 300,
          backgroundColor: theme.surface2,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: {
            offsetX: 0,
            offsetY: 8,
            blurRadius: 32,
            spreadRadius: 0,
            color: '#00000066',
          },
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingTop: 10,
            paddingBottom: 10,
            paddingLeft: 12,
            paddingRight: 12,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Icon name="search" size={13} color={theme.text2} />
          <input
            ref={searchRef}
            testId="emote-popup-search"
            autoFocus
            value={searchQuery}
            placeholder="Search emotes…"
            onChange={(event) => setSearchQuery(event.value ?? '')}
            {...searchFocus}
            onKeyDown={(event) => {
              // The window-level ESC handler skips while a text editor is
              // focused, so the picker closes itself here.
              if (event.key === 'escape') onClose()
            }}
            theme={{ caret: theme.accent.primary }}
            style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: theme.text }}
          />
        </div>

        {groups.length > 1 ? (
          <div
            testId="emote-popup-tabs"
            style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 8 }}
          >
            {groups.map((group) => (
              <ActionButton
                key={group.source}
                testId={`emote-popup-tab-${group.source}`}
                primary={group.source === activeSource}
                onClick={() => setSelectedSource(group.source)}
              >
                {group.label}
              </ActionButton>
            ))}
          </div>
        ) : null}
        {isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 32,
            }}
          >
            <Text style={{ fontSize: 13, color: theme.text2 }}>Loading…</Text>
          </div>
        ) : pickerRows.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 32,
            }}
          >
            <Text style={{ fontSize: 13, color: theme.text2 }}>
              {searchQuery.trim() ? 'No emotes found' : 'No emotes for this channel yet'}
            </Text>
          </div>
        ) : (
          <virtual-list
            ref={listRef}
            testId="emote-popup-list"
            estimatedItemHeight={44}
            style={{ height: 340, scrollbarColor: theme.scrollbar, scrollbarWidth: 4 }}
          >
            {pickerRows.map((row, index) =>
              row.kind === 'heading' ? (
                <div
                  key={`h-${row.source}-${index}`}
                  style={{ paddingTop: 10, paddingBottom: 4, paddingLeft: 10, paddingRight: 10 }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: theme.text2,
                    }}
                  >
                    {row.label.toUpperCase()}
                  </Text>
                </div>
              ) : (
                <div
                  key={`r-${row.source}-${index}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    paddingLeft: 6,
                    paddingRight: 6,
                    paddingTop: 2,
                    paddingBottom: 2,
                    gap: 2,
                  }}
                >
                  {row.entries.map((emote) => (
                    <div
                      key={`${emote.source}:${emote.id}:${emote.alias}`}
                      style={{
                        width: CELL_WIDTH,
                        height: CELL_WIDTH,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        borderRadius: 6,
                        hover: { backgroundColor: 'rgba(255, 255, 255, 0.09)' },
                      }}
                    >
                      <EmoteTooltip
                        theme={theme}
                        emote={{ ...emote, name: emote.alias, positions: [] }}
                      >
                        <div
                          onClick={() => onSelect(emote.alias)}
                          style={{
                            width: CELL_WIDTH,
                            height: CELL_WIDTH,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <RemoteImage
                            url={emote.imageUrl}
                            objectFit="contain"
                            style={{ width: 32, height: 32, pointerEvents: 'none' }}
                          />
                        </div>
                      </EmoteTooltip>
                    </div>
                  ))}
                </div>
              ),
            )}
          </virtual-list>
        )}
      </div>
    </anchored>
  )
}
