import type { ReactNode } from 'react'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple'
type BadgeSize = 'sm' | 'md'
type BadgeStyle = Record<string, unknown>

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  size?: BadgeSize
  style?: BadgeStyle
  testId?: string
  /** Custom background color (overrides variant) */
  backgroundColor?: string
  /** Custom text color (overrides variant) */
  color?: string
}

const variants: Record<BadgeVariant, { backgroundColor: string; color: string }> = {
  default: {
    backgroundColor: 'transparent',
    color: '#C4C4CC',
  },
  success: {
    backgroundColor: '#163A2A',
    color: '#4ADE80',
  },
  warning: {
    backgroundColor: '#422F16',
    color: '#FBBF24',
  },
  danger: {
    backgroundColor: '#421F25',
    color: '#F87171',
  },
  info: {
    backgroundColor: '#192F48',
    color: '#60A5FA',
  },
  purple: {
    backgroundColor: '#30204A',
    color: '#C4A5FF',
  },
}

const sizes: Record<BadgeSize, BadgeStyle> = {
  sm: {
    paddingTop: 2,
    paddingBottom: 2,
    paddingLeft: 3,
    paddingRight: 3,
    fontSize: 10,
  },
  md: {
    paddingTop: 1,
    paddingBottom: 2,
    paddingLeft: 6,
    paddingRight: 6,
    fontSize: 16,
  },
}

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  style,
  testId,
  backgroundColor,
  color,
}: BadgeProps) {
  const variantColors = variants[variant]
  return (
    <div
      testId={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        fontFamily: 'inherit',
        fontWeight: 500,
        backgroundColor: backgroundColor ?? variantColors.backgroundColor,
        color: color ?? variantColors.color,
        ...sizes[size],
        ...style,
      }}
    >
      {children}
    </div>
  )
}
