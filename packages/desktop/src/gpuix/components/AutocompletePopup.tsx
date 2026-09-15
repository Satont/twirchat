/**
 * Autocomplete popup — port of AutocompletePopup.vue onto a GPUIX anchored
 * overlay (paints above the virtual list, unlike an absolute div).
 */

import { useTheme } from '../theme-context'
import { Text } from './ui/Text'
import { RemoteImage } from './ui/RemoteImage'
import type { AutocompleteSuggestion } from '../hooks/use-autocomplete'

export function AutocompletePopup({
  suggestions,
  selectedIndex,
  mode,
  onSelect,
}: {
  suggestions: AutocompleteSuggestion[]
  selectedIndex: number
  mode: 'mention' | 'emote' | 'command' | null
  onSelect: (index: number) => void
}) {
  const theme = useTheme()
  if (!mode || suggestions.length === 0) return null

  return (
    <anchored
      deferred
      side="top"
      align="start"
      gap={6}
      style={{
        minWidth: 200,
        maxWidth: 340,
        maxHeight: 240,
        overflowY: 'scroll',
        backgroundColor: theme.surface2,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        boxShadow: { offsetX: 0, offsetY: 4, blurRadius: 16, spreadRadius: 0, color: '#00000066' },
      }}
    >
      {suggestions.map((suggestion, i) => (
        <div
          key={
            suggestion.type === 'mention'
              ? `${suggestion.label}:${suggestion.insertLabel}`
              : suggestion.type === 'command'
                ? `${suggestion.label}:${suggestion.insertText}`
                : suggestion.label
          }
          onClick={() => onSelect(i)}
          style={{
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
            backgroundColor: i === selectedIndex ? 'rgba(167, 139, 250, 0.15)' : undefined,
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
              <Text style={{ fontSize: 14, color: theme.text, flexShrink: 0 }}>
                {suggestion.label}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.text2,
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
              <RemoteImage
                url={suggestion.imageUrl}
                objectFit="contain"
                style={{ width: 24, height: 24, flexShrink: 0 }}
              />
              <Text style={{ fontSize: 14, color: theme.text }}>{suggestion.label}</Text>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>
                {suggestion.label}
              </Text>
              <Text style={{ fontSize: 12, color: theme.text2 }}>{suggestion.description}</Text>
            </>
          )}
        </div>
      ))}
    </anchored>
  )
}
