/**
 * Autocomplete popup — port of AutocompletePopup.vue onto a GPUIX anchored
 * overlay (paints above the virtual list, unlike an absolute div).
 */

import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { useCallback, useEffect, useRef } from 'react'

import type { BotCommandSource, ParsedToken } from '../../views/main/utils/autocompleteUtils'
import type { AutocompleteSuggestion } from '../hooks/use-autocomplete'
import { nativeWindow } from '../native-window'
import { useTheme } from '../theme-context'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

const BOT_SOURCE_LABELS: Record<BotCommandSource, string> = {
  twir: 'Twir',
  jeetbot: 'jeetbot',
  fossabot: 'Fossabot',
  nightbot: 'Nightbot',
  potat: 'PotatBotat',
  supibot: 'Supibot',
}

function suggestionKey(suggestion: AutocompleteSuggestion): string {
  if (suggestion.type === 'mention') return `${suggestion.label}:${suggestion.insertLabel}`
  if (suggestion.type === 'command')
    return `${suggestion.label}:${suggestion.insertText}:${suggestion.source ?? ''}`
  if (suggestion.type === 'argument') return `${suggestion.label}:${suggestion.insertText}`
  return suggestion.label
}

export function AutocompletePopup({
  suggestions,
  selectedIndex,
  mode,
  onSelect,
  anchorId,
  anchorWidth,
}: {
  suggestions: AutocompleteSuggestion[]
  selectedIndex: number
  mode: ParsedToken['mode']
  onSelect: (index: number) => void
  anchorId: number | null
  anchorWidth: number
}) {
  const theme = useTheme()
  const renderer = nativeWindow(useGpuixRequired())
  const rows = useRef(new Map<number, PublicInstance>())
  const revealPending = useRef(false)
  const revealSelected = useCallback(
    () => rows.current.get(selectedIndex)?.scrollIntoView?.(),
    [selectedIndex],
  )
  // Suggestions are rebuilt on unrelated renders; only real changes may move the user's scroll.
  const contentKey = suggestions.map(suggestionKey).join('\n')
  useEffect(() => {
    revealPending.current = true
    revealSelected()
  }, [revealSelected, contentKey])
  const revealAfterLayout = useCallback(() => {
    if (!revealPending.current) return
    revealPending.current = false
    revealSelected()
  }, [revealSelected])

  if (!mode || suggestions.length === 0) return null
  const windowBounds = renderer.getWindowBounds()
  const anchor = anchorId === null ? null : renderer.getPaintedElementBounds(anchorId)
  const windowWidth = windowBounds?.width ?? anchorWidth
  const width = Math.max(1, Math.min(340, anchor?.width ?? anchorWidth, windowWidth - 16))
  const rowHeight = mode === 'emote' ? 36 : 32
  const desiredHeight = 10 + suggestions.length * rowHeight + (suggestions.length - 1) * 2
  const above = anchor ? Math.max(0, anchor.y - 14) : 240
  const below =
    anchor && windowBounds ? Math.max(0, windowBounds.height - anchor.y - anchor.height - 14) : 0
  const side = above >= Math.min(desiredHeight, 96) || above >= below ? 'top' : 'bottom'
  const height = Math.min(240, desiredHeight, side === 'top' ? above : below)

  return (
    <anchored
      deferred
      testId="autocomplete-popup"
      side={side}
      align="start"
      gap={6}
      style={{
        width,
        minWidth: 0,
        backgroundColor: theme.surface2,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        boxShadow: { offsetX: 0, offsetY: 4, blurRadius: 16, spreadRadius: 0, color: '#00000066' },
      }}
    >
      <div
        testId="autocomplete-viewport"
        onLayout={revealAfterLayout}
        style={{
          width: '100%',
          height: Math.max(1, height - 2),
          minHeight: 0,
          minWidth: 0,
          overflowY: 'scroll',
          overflowX: 'hidden',
          scrollbarColor: theme.scrollbar,
          scrollbarWidth: 4,
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {suggestions.map((suggestion, i) => (
          <div
            key={suggestionKey(suggestion)}
            ref={(element) => {
              if (element) rows.current.set(i, element)
              else rows.current.delete(i)
            }}
            testId={i === selectedIndex ? 'autocomplete-selected' : `autocomplete-option-${i}`}
            onClick={() => onSelect(i)}
            style={{
              width: '100%',
              minWidth: 0,
              height: rowHeight,
              flexShrink: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingTop: 6,
              paddingBottom: 6,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: 4,
              cursor: 'pointer',
              backgroundColor: i === selectedIndex ? theme.accent.tint15 : undefined,
              hover: { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
            }}
          >
            {suggestion.type === 'mention' ? (
              <>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: suggestion.color || '#8b8b99',
                    flexShrink: 0,
                  }}
                />
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.text,
                    minWidth: 0,
                    maxWidth: '55%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {suggestion.label}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: theme.text2,
                    flexGrow: 1,
                    flexBasis: 0,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {suggestion.insertLabel !== suggestion.label
                    ? `→ ${suggestion.insertLabel}`
                    : (suggestion.description ?? '')}
                </Text>
              </>
            ) : suggestion.type === 'emote' ? (
              <>
                {suggestion.emoji ? (
                  <Text style={{ width: 24, fontSize: 20, color: theme.text }}>
                    {suggestion.emoji}
                  </Text>
                ) : (
                  <RemoteImage
                    url={suggestion.imageUrl}
                    objectFit="contain"
                    style={{ width: 24, height: 24, flexShrink: 0 }}
                  />
                )}
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.text,
                    flexGrow: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {suggestion.label}
                </Text>
              </>
            ) : (
              <>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: theme.text,
                    minWidth: 0,
                    maxWidth: '55%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {suggestion.label}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: theme.text2,
                    flexGrow: 1,
                    flexBasis: 0,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {suggestion.description}
                </Text>
                {suggestion.type === 'command' && suggestion.source ? (
                  <Text
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      fontWeight: 600,
                      color: theme.text2,
                      paddingLeft: 4,
                      paddingRight: 4,
                      borderRadius: 3,
                      borderWidth: 1,
                      borderColor: theme.border,
                    }}
                  >
                    {BOT_SOURCE_LABELS[suggestion.source]}
                  </Text>
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>
    </anchored>
  )
}
