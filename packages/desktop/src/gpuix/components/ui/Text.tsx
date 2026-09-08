import type { ReactNode } from 'react'
import { useFont } from '../../theme-context'

type TextStyle = Record<string, unknown>

/**
 * `<text>` with the app's font family applied automatically.
 * GPUI does not inherit `color`, so callers still pass one explicitly.
 */
export function Text({
  style,
  children,
  onClick,
  testId,
}: {
  style?: TextStyle
  children?: ReactNode
  onClick?: () => void
  testId?: string
}) {
  const family = useFont()
  const merged = family ? { fontFamily: family, ...style } : style
  return (
    <text testId={testId} onClick={onClick} style={merged}>
      {children}
    </text>
  )
}
