import type { TimestampFormat } from '@twirchat/shared/types'

import { useTheme } from '../../theme-context'
import { timestampColumnWidth, timestampSize } from '../../timestamp-format'
import { Text } from './Text'

/**
 * Leading time label for event rows. In the compact layout it reserves the same
 * column as message timestamps, so events line up with the chat they describe.
 */
export function EventTimestamp({
  time,
  fontSize,
  format,
  compact,
  testId,
}: {
  time: string
  fontSize: number
  format?: TimestampFormat
  compact: boolean
  testId?: string
}) {
  const theme = useTheme()
  const width = compact ? timestampColumnWidth(fontSize, format ?? 'HH:MM:SS') : undefined
  return (
    <Text
      testId={testId}
      style={{
        color: theme.text2,
        fontSize: timestampSize(fontSize),
        whiteSpace: 'nowrap',
        flexShrink: 0,
        marginRight: 6,
        ...(width === undefined ? {} : { width, textAlign: 'right' }),
      }}
    >
      {time}
    </Text>
  )
}
