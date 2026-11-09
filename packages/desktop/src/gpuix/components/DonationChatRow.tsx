import { DONATION_PROVIDER_LABELS, type DonationEvent } from '@twirchat/shared/donations'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'
import { memo } from 'react'

import { chunkGraphemes } from '../../views/shared/utils/display-text'
import { donationAmount } from '../chat-timeline'
import { withAlpha } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { formatMessageTime, timestampSize } from './ChatMessage'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

interface DonationChatRowProps {
  donation: DonationEvent
  fontSize?: number
  showTimestamp?: boolean
  chatTheme?: typeof DEFAULT_SETTINGS.chatTheme
}

const wrappingRow = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  minWidth: 0,
}

export const DonationChatRow = memo(function DonationChatRow({
  donation,
  fontSize = DEFAULT_SETTINGS.fontSize,
  showTimestamp,
  chatTheme = DEFAULT_SETTINGS.chatTheme,
}: DonationChatRowProps) {
  const theme = useTheme()
  const fontFamily = useFont()
  const compact = chatTheme === 'compact'
  const style = { fontSize, fontFamily, color: theme.text, lineHeight: Math.round(fontSize * 1.45) }
  const words = donation.message.match(/\S+ ?/g) ?? []
  let position = 0
  const body = words.flatMap((word) =>
    [...chunkGraphemes(word, 28)].map((part) => {
      const key = position
      position += part.length
      return (
        <text key={key} style={style}>
          {part}
        </text>
      )
    }),
  )

  return (
    <div
      testId={`donation-${donation.provider}-${donation.id.toWellFormed()}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        minWidth: 0,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: compact ? 4 : 7,
        paddingBottom: compact ? 4 : 7,
        borderLeftWidth: 2,
        borderColor: theme.accent.primary,
        backgroundColor: withAlpha(theme.accent.primary, 0.09),
        gap: 2,
      }}
    >
      <div style={{ ...wrappingRow, columnGap: 6 }}>
        {showTimestamp ? (
          <Text style={{ fontSize: timestampSize(fontSize), color: theme.text2 }}>
            {formatMessageTime(new Date(donation.timestamp))}
          </Text>
        ) : null}
        <Icon name="gift" size={Math.min(18, fontSize)} color={theme.accent.primary} />
        <Text
          style={{
            ...style,
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: 700,
          }}
        >
          {donation.username}
        </Text>
        <Text style={{ ...style, color: theme.accent.primary, fontWeight: 600 }}>
          {`donated ${donationAmount(donation)}`}
        </Text>
        <Text style={{ fontSize: timestampSize(fontSize), color: theme.text2 }}>
          {DONATION_PROVIDER_LABELS[donation.provider]}
        </Text>
      </div>
      {body.length > 0 ? <div style={wrappingRow}>{body}</div> : null}
    </div>
  )
})
