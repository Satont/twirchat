/**
 * Emote picker — port of EmotePicker.vue onto GPUIX: native search input +
 * a <virtual-list> of heading / 7-cell grid rows inside an anchored overlay.
 */

import { useEffect, useMemo, useState } from 'react'
import type { EmoteCatalogEntry, EmoteSource } from '@twirchat/shared/protocol'

import { useBackend } from '../backend/context'
import { emoteStore, loadEmotes } from '../state/app'
import { trackTextInputFocus } from '../state/focus'
import { useStore } from '../state/create-store'
import { useTheme } from '../theme-context'
import { groupEmoteCatalog } from '../../views/main/utils/emote-catalog'
import { Icon } from './ui/Icon'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

const ITEMS_PER_ROW = 7
const CELL_WIDTH = 41

type PickerRow =
  | { kind: 'heading'; source: EmoteSource; label: string }
  | { kind: 'emotes'; source: EmoteSource; entries: EmoteCatalogEntry[] }

export function EmotePicker({
  platform,
  channelId,
  useSessionCache,
  onSelect,
  onClose,
}: {
  platform: string
  channelId: string
  useSessionCache: boolean
  onSelect: (alias: string) => void
  onClose: () => void
}) {
  const theme = useTheme()
  const backend = useBackend()
  const emotes = useStore(emoteStore)
  const [searchQuery, setSearchQuery] = useState('')

  const cacheKey = `${platform}:${channelId}`
  const allEmotes = emotes.get(cacheKey) ?? []
  const isLoading = allEmotes.length === 0 && !emotes.has(cacheKey)

  useEffect(() => {
    void loadEmotes(backend, platform, channelId, useSessionCache)
  }, [backend, platform, channelId, useSessionCache])

  const pickerRows = useMemo((): PickerRow[] => {
    const groups = groupEmoteCatalog(allEmotes, searchQuery)
    const rows: PickerRow[] = []
    for (const group of groups) {
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
  }, [allEmotes, searchQuery])

  return (
    <anchored
      deferred
      side="top"
      align="end"
      gap={8}
      onMouseDownOutside={onClose}
      style={{
        width: 300,
        backgroundColor: theme.surface2,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 32, spreadRadius: 0, color: '#00000066' },
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
          autoFocus
          value={searchQuery}
          placeholder="Search emotes…"
          onChange={(event) => setSearchQuery(event.value ?? '')}
          onFocus={() => trackTextInputFocus(true)}
          onBlur={() => trackTextInputFocus(false)}
          theme={{ caret: '#a78bfa' }}
          style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: theme.text }}
        />
      </div>

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
          <Text style={{ fontSize: 13, color: theme.text2 }}>No emotes found</Text>
        </div>
      ) : (
        <virtual-list estimatedItemHeight={44} style={{ height: 340 }}>
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
                    key={`${emote.source}:${emote.id}`}
                    onClick={() => onSelect(emote.alias)}
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
                    <RemoteImage
                      url={emote.imageUrl}
                      objectFit="contain"
                      style={{ width: 32, height: 32, pointerEvents: 'none' }}
                    />
                  </div>
                ))}
              </div>
            ),
          )}
        </virtual-list>
      )}
    </anchored>
  )
}
