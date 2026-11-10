import { useMemo } from 'react'

import { highlightParts } from '../../settings-highlight'
import { useTheme } from '../../theme-context'
import { Text } from './Text'

type TextStyle = Record<string, unknown>

export function HighlightText({
  text,
  query,
  style,
  containerStyle,
  testId,
}: {
  text: string
  query: string
  style?: TextStyle
  containerStyle?: TextStyle
  testId?: string
}) {
  const theme = useTheme()
  const parts = useMemo(() => highlightParts(text, query), [text, query])
  if (!parts.some((part) => part.highlighted)) {
    return (
      <Text style={{ ...containerStyle, ...style }} testId={testId}>
        {text}
      </Text>
    )
  }
  return (
    <div
      testId={testId}
      style={{
        display: 'flex',
        flexDirection: 'row',
        ...containerStyle,
      }}
    >
      {parts.map((part, index) => (
        <Text key={index} style={part.highlighted ? { ...style, color: theme.link } : style}>
          {part.text}
        </Text>
      ))}
    </div>
  )
}
