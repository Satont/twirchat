import { useGpuixRequired, useWindowSize, type PublicInstance } from '@gpuix/react'
import type { EmoteCatalogEntry, EmoteSource } from '@twirchat/shared/protocol'
import type { Platform } from '@twirchat/shared/types'
/**
 * Emote picker — port of EmotePicker.vue onto GPUIX: native search input +
 * a <virtual-list> of heading and grid rows inside an anchored overlay.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  filterEmoteEntries,
  groupEmoteCatalog,
  applyLiveEmoteLocks,
} from '../../views/main/utils/emote-catalog'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import {
  focusPopupSearch,
  popupTabIndex,
  scrollPopupPage,
  usePopupHotkeys,
} from '../hooks/use-popup-hotkeys'
import { useT } from '../i18n'
import { nativeWindow } from '../native-window'
import { emoteStore, loadEmotes, showNotice } from '../state/app'
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

const POPUP_WIDTH = 300
const POPUP_MARGIN = 8
const POPUP_BORDER = 1
const COMPOSER_CLEARANCE = 48
const CELL_WIDTH = 38
const GRID_PADDING = 6
const GRID_GAP = 2
const SCROLLBAR_WIDTH = 4
const ROW_HEIGHT = CELL_WIDTH + 4

type PickerRow =
  | { kind: 'heading'; source: PickerSource; label: string }
  | { kind: 'emotes'; source: PickerSource; entries: EmoteCatalogEntry[] }

const EMPTY_EMOTES: EmoteCatalogEntry[] = []

type Translate = ReturnType<typeof useT>['t']

function emoteGroupLabel(source: PickerSource, fallback: string, t: Translate): string {
  switch (source) {
    case 'favorites':
      return t('composer.emotes.favorites')
    case 'channel':
      return t('composer.emotes.channel')
    case 'global':
      return t('composer.emotes.global')
    case 'collectibles':
      return t('composer.emotes.collectibles')
    case 'personal':
      return t('composer.emotes.personal')
    default:
      return fallback
  }
}

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
  const { t } = useT()
  const backend = useBackend()
  const emotes = useStore(emoteStore)
  const preferences = useStore(emotePreferencesStore)
  const renderer = useGpuixRequired()
  const windowSize = useWindowSize()
  const searchRef = useRef<PublicInstance | null>(null)
  const listRef = useRef<PublicInstance | null>(null)
  const [selectedSource, setSelectedSource] = useState<PickerSource | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchFocus = useTextInputFocusTracking()

  const cacheKey = `${platform}:${channelId}`
  const allEmotes = emotes.get(cacheKey) ?? EMPTY_EMOTES
  const isLoading = allEmotes.length === 0 && !emotes.has(cacheKey)
  const popupWidth = Math.max(1, Math.min(POPUP_WIDTH, windowSize.width - 2 * POPUP_MARGIN))
  const gridWidth = popupWidth - 2 * (POPUP_BORDER + GRID_PADDING) - SCROLLBAR_WIDTH
  const itemsPerRow = Math.max(1, Math.floor((gridWidth + GRID_GAP) / (CELL_WIDTH + GRID_GAP)))
  const query = searchQuery.trim()

  useEffect(() => {
    runUiTask(loadEmotes(backend, platform, channelId, useSessionCache))
    runUiTask(loadEmotePreferences(backend.api))
  }, [backend, platform, channelId, useSessionCache])

  const groups = useMemo(() => {
    const grouped: Array<{ source: PickerSource; label: string; entries: EmoteCatalogEntry[] }> =
      groupEmoteCatalog(allEmotes)
    const favorites = applyLiveEmoteLocks(preferences.value.favorites, allEmotes)
    if (favorites.length) grouped.unshift({ source: 'favorites', label: '', entries: favorites })
    return grouped
  }, [allEmotes, preferences.value.favorites])
  const results = useMemo(
    () =>
      query
        ? groups.map((group) => ({ ...group, entries: filterEmoteEntries(group.entries, query) }))
        : groups,
    [groups, query],
  )
  const firstMatch = results.find((group) => group.entries.length > 0)
  const activeGroup =
    results.find((group) => group.source === selectedSource) ??
    (query ? firstMatch : undefined) ??
    results[0]
  const activeSource = activeGroup?.source
  const activeIndex = results.findIndex((group) => group === activeGroup)
  const pickerRows = useMemo((): PickerRow[] => {
    if (!activeGroup?.entries.length) return []
    const { source, label, entries } = activeGroup
    const rows: PickerRow[] = [{ kind: 'heading', source, label }]
    for (let index = 0; index < entries.length; index += itemsPerRow) {
      rows.push({ kind: 'emotes', source, entries: entries.slice(index, index + itemsPerRow) })
    }
    return rows
  }, [activeGroup, itemsPerRow])
  useEffect(() => {
    if (listRef.current) renderer.scrollToItem?.(listRef.current.id, 0)
  }, [renderer, activeSource, query, itemsPerRow])
  const popupContextId = usePopupHotkeys('emotes', {
    delete: onClose,
    search: () => focusPopupSearch(nativeWindow(renderer), searchRef),
    openTab: ([target]) => {
      if (target === undefined) return
      const index = popupTabIndex(activeIndex, target, groups.length)
      const group = index === null ? undefined : groups[index]
      if (group) setSelectedSource(group.source)
    },
    scrollPage: pickerRows.length
      ? ([direction]) => {
          if (direction !== undefined) scrollPopupPage(renderer, listRef, direction)
        }
      : null,
  })

  useOverlayClose(true, onClose, popupContextId)

  return (
    <anchored
      deferred
      side="top"
      align="end"
      gap={POPUP_MARGIN}
      fit="snap"
      snapMargin={POPUP_MARGIN}
    >
      {/* <anchored> supports only click/hover/fileDrop events, so
          onMouseDownOutside must live on the content div. */}
      <div
        testId="emote-popup"
        onMouseDownOutside={onClose}
        style={{
          width: popupWidth,
          maxHeight: Math.max(1, windowSize.height - COMPOSER_CLEARANCE),
          overflow: 'hidden',
          backgroundColor: theme.surface2,
          borderWidth: POPUP_BORDER,
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
            flexShrink: 0,
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
            placeholder={t('composer.emotes.search')}
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

        <div
          testId="emote-popup-tabs"
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexShrink: 0,
            flexWrap: 'wrap',
            gap: 4,
            padding: 8,
          }}
        >
          {groups.map((group) => (
            <ActionButton
              key={group.source}
              testId={`emote-popup-tab-${group.source}`}
              primary={group.source === activeSource}
              onClick={() => setSelectedSource(group.source)}
            >
              {emoteGroupLabel(group.source, group.label, t)}
            </ActionButton>
          ))}
        </div>
        {isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 12,
            }}
          >
            <Text style={{ fontSize: 13, color: theme.text2 }}>{t('common.loading')}</Text>
          </div>
        ) : pickerRows.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 12,
            }}
          >
            <Text style={{ fontSize: 13, color: theme.text2 }}>
              {query
                ? firstMatch
                  ? t('composer.emotes.noMatches')
                  : t('composer.emotes.notFound')
                : t('composer.emotes.emptyTab')}
            </Text>
          </div>
        ) : (
          <virtual-list
            ref={listRef}
            testId="emote-popup-list"
            estimatedItemHeight={ROW_HEIGHT}
            style={{
              height: 340,
              flexShrink: 1,
              minHeight: 0,
              scrollbarColor: theme.scrollbar,
              scrollbarWidth: SCROLLBAR_WIDTH,
            }}
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
                    {emoteGroupLabel(row.source, row.label, t).toUpperCase()}
                  </Text>
                </div>
              ) : (
                <div
                  key={`r-${row.source}-${index}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    paddingLeft: GRID_PADDING,
                    paddingRight: GRID_PADDING,
                    paddingTop: 2,
                    paddingBottom: 2,
                    gap: GRID_GAP,
                  }}
                >
                  {row.entries.map((emote) => {
                    const locked = emote.locked === true
                    return (
                      <div
                        key={`${emote.source}:${emote.id}:${emote.alias}`}
                        style={{
                          width: CELL_WIDTH,
                          height: CELL_WIDTH,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: locked ? 'default' : 'pointer',
                          borderRadius: 6,
                          ...(locked
                            ? {}
                            : { hover: { backgroundColor: 'rgba(255, 255, 255, 0.09)' } }),
                        }}
                      >
                        <EmoteTooltip
                          theme={theme}
                          emote={emote}
                          alias={emote.alias}
                          catalog={allEmotes}
                        >
                          <div
                            testId={`emote-popup-item-${emote.alias}`}
                            onClick={() => {
                              if (locked) {
                                showNotice('info', t('composer.emotes.locked'), 4000)
                                return
                              }
                              onSelect(emote.alias)
                            }}
                            style={{
                              position: 'relative',
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
                              style={{
                                width: 32,
                                height: 32,
                                pointerEvents: 'none',
                                opacity: locked ? 0.45 : 1,
                              }}
                            />
                            {locked ? (
                              <div
                                testId={`emote-popup-locked-${emote.alias}`}
                                style={{
                                  position: 'absolute',
                                  right: -1,
                                  bottom: -1,
                                  width: 14,
                                  height: 14,
                                  borderRadius: 7,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  backgroundColor: theme.surface2,
                                  borderWidth: 1,
                                  borderColor: theme.border,
                                }}
                              >
                                <Icon name="lock" size={8} color={theme.text2} />
                              </div>
                            ) : null}
                          </div>
                        </EmoteTooltip>
                      </div>
                    )
                  })}
                </div>
              ),
            )}
          </virtual-list>
        )}
      </div>
    </anchored>
  )
}
