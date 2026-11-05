import { memo, type ReactNode } from 'react'

import { chunkGraphemes, sanitizeDisplayText } from '../../views/shared/utils/display-text'
import type { PluginChannelMessage } from '../../watched-channels/plugin-channels'
import { readableOn } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { formatMessageTime } from './ChatMessage'
import { Text } from './ui/Text'

interface PluginChatRowProps {
  message: PluginChannelMessage
  source?: string
  fontSize?: number
  showTimestamp?: boolean
}

const MAX_WORD_GRAPHEMES = 28

export const PluginChatRow = memo(function PluginChatRow({
  message,
  source,
  fontSize = 13,
  showTimestamp,
}: PluginChatRowProps) {
  const theme = useTheme()
  const fontFamily = useFont()
  const isMessage = message.kind === 'message'
  const color = isMessage ? message.author.color : undefined
  const textColor = isMessage ? theme.text : theme.text2
  const rowStyle = { paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3 }
  const testId = `plugin-chat-message-${message.id.toWellFormed()}`

  if (!color && !source && !showTimestamp) {
    const text = isMessage ? `${message.author.name}: ${message.text}` : message.text
    return (
      <div testId={testId} style={rowStyle}>
        <Text style={{ fontSize, color: textColor }}>{sanitizeDisplayText(text)}</Text>
      </div>
    )
  }

  const timestamp = showTimestamp ? formatMessageTime(new Date(message.timestamp)) : ''
  const label = source ? sanitizeDisplayText(source) : ''
  const prefix = [timestamp, label].filter(Boolean).join(' · ')
  const name = isMessage ? sanitizeDisplayText(message.author.name) : ''
  const style = { fontSize, fontFamily, color: textColor }
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

  return (
    <div
      testId={testId}
      style={{
        ...rowStyle,
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        minWidth: 0,
      }}
    >
      {prefix ? <text style={{ ...style, color: theme.text2 }}>{`${prefix} `}</text> : null}
      {isMessage ? (
        <text style={{ ...style, color: color ? readableOn(color, theme.bg) : textColor }}>
          {`${name}: `}
        </text>
      ) : null}
      {runs}
    </div>
  )
})
