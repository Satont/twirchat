import { Icon, type IconName } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { withAlpha } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import type { ReactNode } from 'react'

import { accentGlow, accentGradient, userCardPanelColor, userCardWellColor } from './utils'

export function IconTile({
  icon,
  size = 30,
  tone = 'accent',
}: {
  icon: IconName
  size?: number
  tone?: 'accent' | 'neutral'
}) {
  const theme = useTheme()
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 9,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: tone === 'accent' ? accentGradient(theme) : theme.fill,
        boxShadow: tone === 'accent' ? accentGlow(theme) : undefined,
      }}
    >
      <Icon
        name={icon}
        size={Math.round(size * 0.48)}
        color={tone === 'accent' ? theme.accent.onDeep : theme.text2}
      />
    </div>
  )
}

export function SectionHeader({
  icon,
  title,
  hint,
  action,
  tone,
}: {
  icon: IconName
  title: string
  hint?: string
  action?: ReactNode
  tone?: 'accent' | 'neutral'
}) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
          flexGrow: 1,
        }}
      >
        <IconTile icon={icon} tone={tone} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>{title}</Text>
          {hint ? (
            <Text style={{ fontSize: 11, lineHeight: 16, color: theme.text2 }}>{hint}</Text>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  )
}

export function UserCardPanel({
  children,
  style,
}: {
  children: ReactNode
  style?: Record<string, unknown>
}) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: userCardPanelColor(theme),
        borderWidth: 1,
        borderColor: theme.hairline,
        borderRadius: 14,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function GhostButton({
  disabled,
  onClick,
  children,
  style,
  icon,
  justify = 'center',
  tone = 'default',
  active = false,
}: {
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  style?: Record<string, unknown>
  icon?: IconName
  tone?: 'default' | 'danger'
  active?: boolean
  justify?: 'center' | 'start'
}) {
  const theme = useTheme()
  const foreground =
    tone === 'danger' ? theme.dangerText : active ? theme.accent.primary : theme.text
  return (
    <div
      tabIndex={disabled ? undefined : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'enter' || event.key === 'space')) {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: justify,
        gap: 6,
        minHeight: 34,
        backgroundColor: active ? theme.accent.tint12 : 'transparent',
        borderWidth: 1,
        borderColor:
          tone === 'danger'
            ? withAlpha(theme.dangerText, 0.32)
            : active
              ? theme.accent.primary
              : theme.border,
        borderRadius: 10,
        paddingTop: 7,
        paddingBottom: 7,
        paddingLeft: 12,
        paddingRight: 12,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        hover: disabled
          ? {}
          : {
              backgroundColor:
                tone === 'danger'
                  ? withAlpha(theme.dangerText, 0.1)
                  : active
                    ? theme.accent.tint20
                    : theme.fillHover,
            },
        active: disabled ? {} : { opacity: 0.82 },
        focusVisible: {
          outlineWidth: 2,
          outlineColor: theme.accent.primary,
          outlineOffset: 2,
        },
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={foreground} /> : null}
      <Text style={{ fontSize: 12, fontWeight: 600, color: foreground }}>{children}</Text>
    </div>
  )
}

export function InlineButton({
  disabled,
  onClick,
  children,
  style,
  icon,
}: {
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  style?: Record<string, unknown>
  icon?: IconName
}) {
  const theme = useTheme()
  return (
    <div
      tabIndex={disabled ? undefined : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'enter' || event.key === 'space')) {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 34,
        background: accentGradient(theme),
        borderRadius: 10,
        paddingTop: 7,
        paddingBottom: 7,
        paddingLeft: 14,
        paddingRight: 14,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        boxShadow: accentGlow(theme),
        hover: disabled ? {} : { opacity: 0.92 },
        active: disabled ? {} : { opacity: 0.8 },
        focusVisible: {
          outlineWidth: 2,
          outlineColor: theme.accent.primary,
          outlineOffset: 2,
        },
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={theme.accent.onDeep} /> : null}
      <Text style={{ fontSize: 12, fontWeight: 600, color: theme.accent.onDeep }}>{children}</Text>
    </div>
  )
}

export function MetadataState({ error, children }: { error?: boolean; children: ReactNode }) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: error ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: 92,
        padding: 18,
        borderWidth: 1,
        borderColor: error ? withAlpha(theme.dangerText, 0.35) : theme.hairline,
        borderRadius: 12,
        backgroundColor: userCardWellColor(theme),
      }}
    >
      {children}
    </div>
  )
}

export function HeaderPill({ children }: { children: string }) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        minHeight: 24,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 999,
        backgroundColor: theme.isLight ? withAlpha('#ffffff', 0.55) : withAlpha('#000000', 0.28),
        borderWidth: 1,
        borderColor: theme.isLight ? withAlpha(theme.accent.deep, 0.2) : withAlpha('#ffffff', 0.18),
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: theme.isLight ? theme.accent.deep : '#ffffff',
        }}
      >
        {children}
      </Text>
    </div>
  )
}
