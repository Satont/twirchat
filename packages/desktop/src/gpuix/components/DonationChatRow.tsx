import { DONATION_PROVIDER_LABELS, type DonationEvent } from '@twirchat/shared/donations'
import { DEFAULT_SETTINGS, type TimestampFormat } from '@twirchat/shared/types'
import { memo } from 'react'

import { chunkGraphemes } from '../../views/shared/utils/display-text'
import { donationAmount } from '../chat-timeline'
import { readableOn } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { formatMessageTime, timestampSize } from '../timestamp-format'
import { DONATION_BRAND_ACCENTS, DonationBrandMark } from './DonationBrandMark'
import { Text } from './ui/Text'

interface DonationChatRowProps {
  donation: DonationEvent
  fontSize?: number
  showTimestamp?: boolean
  timestampFormat?: TimestampFormat
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
  timestampFormat,
  chatTheme = DEFAULT_SETTINGS.chatTheme,
}: DonationChatRowProps) {
  const theme = useTheme()
  const fontFamily = useFont()
  const compact = chatTheme === 'compact'
  const amountColor = readableOn(DONATION_BRAND_ACCENTS[donation.provider], theme.surface)
  const provider = DONATION_PROVIDER_LABELS[donation.provider]
  const source = showTimestamp
    ? `${provider} · ${formatMessageTime(new Date(donation.timestamp), timestampFormat)}`
    : provider
  const style = {
    fontSize,
    fontFamily,
    color: theme.text2,
    lineHeight: Math.round(fontSize * 1.45),
  }
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
        flexDirection: 'row',
        alignItems: 'flex-start',
        width: '100%',
        minWidth: 0,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: compact ? 5 : 8,
        paddingBottom: compact ? 5 : 8,
        borderTopWidth: 1,
        borderColor: theme.divider,
        backgroundColor: theme.surface,
        gap: 8,
      }}
    >
      <DonationBrandMark provider={donation.provider} size={compact ? 22 : 26} />
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: 2 }}>
        <div
          style={{
            ...wrappingRow,
            justifyContent: 'space-between',
            columnGap: 12,
            rowGap: 2,
          }}
        >
          <div style={{ ...wrappingRow, columnGap: 6, maxWidth: '100%' }}>
            <Text
              style={{
                ...style,
                color: theme.text,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: 700,
              }}
            >
              {donation.username}
            </Text>
            <Text style={{ ...style, color: amountColor, fontWeight: 650 }}>
              {`donated ${donationAmount(donation)}`}
            </Text>
          </div>
          <Text style={{ fontSize: timestampSize(fontSize), color: theme.text2 }}>{source}</Text>
        </div>
        {body.length > 0 ? <div style={wrappingRow}>{body}</div> : null}
      </div>
    </div>
  )
})
