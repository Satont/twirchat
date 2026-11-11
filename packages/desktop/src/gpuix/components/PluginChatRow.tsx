import { DEFAULT_SETTINGS, type TimestampFormat } from '@twirchat/shared/types'
import { memo, type ReactNode } from 'react'

import { chunkGraphemes, sanitizeDisplayText } from '../../views/shared/utils/display-text'
import { buildMessageParts } from '../../views/shared/utils/messageParts'
import type { PluginChannelMessage } from '../../watched-channels/plugin-channels'
import { readableOn } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { formatMessageTime, timestampColumnWidth, timestampSize } from '../timestamp-format'
import { EmoteArtwork } from './ui/EmoteArtwork'

interface PluginChatRowProps {
  message: PluginChannelMessage
  source?: string
  fontSize?: number
  showTimestamp?: boolean
  timestampFormat?: TimestampFormat
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
  timestampFormat,
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
  const parts = buildMessageParts({ text: message.text, emotes: message.emotes ?? [] }, 'all')
  const runs: ReactNode[] = []
  const emoteHeight = Math.round(fontSize * 2)
  for (const [index, part] of parts.entries()) {
    const emote = part.emote
    if (emote) {
      const width = Math.max(1, Math.round(emoteHeight * Math.min(3, emote.aspectRatio ?? 1)))
      const marginRight = /^\s/u.test(parts[index + 1]?.content ?? '') ? 4 : 0
      runs.push(
        <div key={runs.length} style={{ marginRight, flexShrink: 0 }}>
          <EmoteArtwork
            url={emote.imageUrl}
            width={width}
            height={emoteHeight}
            fallback={<text style={style}>{sanitizeDisplayText(part.alias ?? emote.name)}</text>}
          />
        </div>,
      )
      continue
    }

    const words = sanitizeDisplayText(part.content ?? '').match(/\S+ ?/g) ?? []
    for (const word of words) {
      const chunks =
        word.length > MAX_WORD_GRAPHEMES ? chunkGraphemes(word, MAX_WORD_GRAPHEMES) : [word]
      for (const chunk of chunks) {
        runs.push(
          <text key={runs.length} style={style}>
            {chunk}
          </text>,
        )
      }
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
          width: timestampColumnWidth(fontSize, timestampFormat ?? 'HH:MM:SS'),
          textAlign: 'right',
          marginRight: 6,
        }),
      }}
    >
      {formatMessageTime(new Date(message.timestamp), timestampFormat)}
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
