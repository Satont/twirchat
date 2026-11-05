import { DEFAULT_SETTINGS } from '@twirchat/shared/types'
import { memo, type ReactNode } from 'react'

import { chunkGraphemes, sanitizeDisplayText } from '../../views/shared/utils/display-text'
import type { PluginChannelMessage } from '../../watched-channels/plugin-channels'
import { readableOn } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { formatMessageTime, timestampSize } from './ChatMessage'

interface PluginChatRowProps {
  message: PluginChannelMessage
  source?: string
  fontSize?: number
  showTimestamp?: boolean
  chatTheme?: typeof DEFAULT_SETTINGS.chatTheme
}

const MAX_WORD_GRAPHEMES = 28
const wrappingRow = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  rowGap: 2,
  minWidth: 0,
}

export const PluginChatRow = memo(function PluginChatRow({
  message,
  source,
  fontSize = DEFAULT_SETTINGS.fontSize,
  showTimestamp,
  chatTheme = DEFAULT_SETTINGS.chatTheme,
}: PluginChatRowProps) {
  const theme = useTheme()
  const fontFamily = useFont()
  const compact = chatTheme === 'compact'
  const isMessage = message.kind === 'message'
  const color = isMessage ? message.author.color : undefined
  const textColor = isMessage ? theme.text : theme.text2
  const insetX = compact ? 12 : 14
  const insetY = compact ? 4 : 7
  const rowStyle = {
    width: '100%',
    paddingLeft: insetX,
    paddingRight: insetX,
    paddingTop: insetY,
    paddingBottom: insetY,
    borderBottomWidth: 1,
    borderColor: theme.divider,
  }
  const testId = `plugin-chat-message-${message.id.toWellFormed()}`
  const style = { fontSize, fontFamily, color: textColor, lineHeight: Math.round(fontSize * 1.45) }
  const text = sanitizeDisplayText(message.text).trimStart()
  const words = text.match(/\S+ ?/g) ?? []
  const runs: ReactNode[] = []
  let position = 0
  for (const word of words) {
    const parts =
      word.length > MAX_WORD_GRAPHEMES ? chunkGraphemes(word, MAX_WORD_GRAPHEMES) : [word]
    for (const part of parts) {
      runs.push(
        <text key={position} style={style}>
          {part}
        </text>,
      )
      position += part.length
    }
  }

  const metaStyle = { fontFamily, fontSize: timestampSize(fontSize), color: theme.text2 }
  const time = showTimestamp ? (
    <text
      style={{
        ...metaStyle,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...(compact && {
          width: Math.ceil(metaStyle.fontSize * 4.6),
          textAlign: 'right',
          marginRight: 6,
        }),
      }}
    >
      {formatMessageTime(new Date(message.timestamp))}
    </text>
  ) : null
  const label = source ? (
    <text
      style={{
        ...metaStyle,
        maxWidth: '30%',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        marginRight: compact ? 6 : undefined,
      }}
    >
      {sanitizeDisplayText(source)}
    </text>
  ) : null
  const author = isMessage ? (
    <text
      style={{ ...style, color: color ? readableOn(color, theme.bg) : textColor, fontWeight: 700 }}
    >
      {sanitizeDisplayText(message.author.name)}
    </text>
  ) : null

  if (compact) {
    return (
      <div testId={testId} style={{ ...rowStyle, ...wrappingRow }}>
        {time}
        {label}
        {author}
        {isMessage ? <text style={style}>{': '}</text> : null}
        {runs}
      </div>
    )
  }

  return (
    <div testId={testId} style={{ ...rowStyle, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {author || time || label ? (
        <div style={{ ...wrappingRow, columnGap: 5 }}>
          {author}
          {time}
          {label}
        </div>
      ) : null}
      <div style={wrappingRow}>{runs}</div>
    </div>
  )
})
