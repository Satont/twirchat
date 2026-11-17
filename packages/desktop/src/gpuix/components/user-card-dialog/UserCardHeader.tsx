import { Icon, PlatformIcon } from '@gpuix/components/ui/Icon'
import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { Text } from '@gpuix/components/ui/Text'
import { hexMix } from '@gpuix/components/user-card/format'
import { useT } from '@gpuix/i18n'
import type { IconName } from '@gpuix/icons'
import type { LinearGradientBackground } from '@gpuix/react'
import { platformColor, withAlpha, type Theme } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import { memo } from 'react'

import { Badge } from './Badge'
import type { UserCardHeaderAccent, UserCardHeaderProps } from './types'
import { HeaderPill as HeaderPillUI } from './UserCardUI'
import { formatDisplayUsername, initials, mergeBadges } from './utils'

function headerGradient(
  theme: Theme,
  accent: UserCardHeaderAccent | undefined,
): LinearGradientBackground {
  const from = accent?.from ?? (theme.isLight ? theme.accent.primary : theme.accent.deep)
  const to = accent?.to ?? (theme.isLight ? theme.accent.primary : theme.accent.deep)
  return {
    type: 'linear-gradient',
    angle: 135,
    stops: [
      {
        color: theme.isLight
          ? hexMix(from, theme.dialog, accent ? 0.3 : 0.4)
          : hexMix(from, theme.dialog, accent ? 0.32 : 0.68),
        position: 0,
      },
      {
        color: theme.isLight
          ? hexMix(to, theme.dialog, accent ? 0.08 : 0.14)
          : hexMix(to, theme.dialog, accent ? 0.14 : 0.18),
        position: 1,
      },
    ],
  }
}

function AvatarFallback({
  name,
  size,
  color,
  background,
}: {
  name: string
  size: number
  color: string
  background: string
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontWeight: 800, fontSize: Math.round(size * 0.32), color }}>
        {initials(name)}
      </Text>
    </div>
  )
}

interface HeaderActionProps {
  icon: IconName
  label: string
  disabled: boolean
  onClick: () => void
  backgroundColor: string
  hoverBackgroundColor: string
  borderColor: string
  color: string
}

function HeaderAction({
  icon,
  label,
  disabled,
  onClick,
  backgroundColor,
  hoverBackgroundColor,
  borderColor,
  color,
}: HeaderActionProps) {
  return (
    <div
      role="button"
      tabIndex={disabled ? undefined : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: disabled ? 'default' : 'pointer',
        gap: 4,
        backgroundColor,
        borderColor,
        borderWidth: 1,
        borderRadius: 10,
        paddingLeft: 14,
        paddingRight: 14,
        paddingTop: 3,
        paddingBottom: 3,
        maxHeight: 40,
        opacity: disabled ? 0.7 : 1,
        hover: { backgroundColor: hoverBackgroundColor },
        color,
      }}
    >
      <Icon size={14} name={icon} color={color} />
      {label}
    </div>
  )
}

const UserCardBadges = memo(function UserCardBadges({
  badges,
  size = 20,
}: {
  badges: ReturnType<typeof mergeBadges>
  size?: number
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        alignItems: 'center',
        minWidth: 0,
      }}
    >
      {badges.map((badge, index) => (
        <Badge key={`${badge.type}:${badge.id}:${index}`} badge={badge} size={size} />
      ))}
    </div>
  )
})

export function UserCardHeader({
  target,
  hideAvatar,
  channelUrl,
  openingPublicChannel,
  openPublicChannel,
  onAvatarClick,
  effectiveAlias,
  accent,
  extraBadges,
  windows,
  standalone,
  openingWindow,
  openWindow,
}: UserCardHeaderProps) {
  const theme = useTheme()
  const { t } = useT()
  const titleHandle = target.username ?? target.platformUserId
  const userBadges = mergeBadges(target.badges, extraBadges)
  const headerText = theme.isLight ? theme.text : '#ffffff'
  const headerMuted = theme.isLight ? withAlpha(theme.text, 0.72) : 'rgba(255, 255, 255, 0.88)'
  const headerBorder = theme.isLight
    ? withAlpha(theme.accent.deep, 0.18)
    : withAlpha('#ffffff', 0.14)
  const headerButtonBg = theme.isLight ? withAlpha('#ffffff', 0.6) : withAlpha('#000000', 0.2)
  const headerButtonHover = theme.isLight ? withAlpha('#ffffff', 0.82) : withAlpha('#000000', 0.3)
  const avatarBorder = theme.isLight ? withAlpha('#ffffff', 0.85) : withAlpha('#ffffff', 0.6)
  const avatarBackground = theme.isLight ? withAlpha('#ffffff', 0.55) : withAlpha('#000000', 0.24)
  const avatarGlow = accent?.from ?? theme.accent.primary
  const showAvatar = !hideAvatar && Boolean(target.avatarUrl)

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 16,
        padding: 20,
        marginLeft: 16,
        marginRight: 16,
        marginTop: 16,
        marginBottom: 16,
        background: headerGradient(theme, accent),
        borderWidth: 1,
        borderColor: headerBorder,
        borderRadius: 16,
        boxShadow: {
          offsetX: 0,
          offsetY: 12,
          blurRadius: 30,
          spreadRadius: 0,
          color: theme.isLight ? withAlpha(theme.accent.deep, 0.16) : '#00000066',
        },
      }}
    >
      {/* Subtle background glows - reduced size and opacity */}
      <div
        style={{
          position: 'absolute',
          top: -60,
          right: 18,
          width: 180,
          height: 180,
          borderRadius: 90,
          backgroundColor: theme.isLight
            ? withAlpha(theme.accent.deep, 0.06)
            : withAlpha('#ffffff', 0.05),
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -70,
          left: 100,
          width: 160,
          height: 160,
          borderRadius: 80,
          backgroundColor: theme.isLight
            ? withAlpha(theme.accent.deep, 0.04)
            : withAlpha('#ffffff', 0.03),
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minWidth: 0,
          flexGrow: 1,
          flexBasis: 280,
        }}
      >
        <div
          testId="user-card-avatar"
          tabIndex={showAvatar ? 0 : undefined}
          onClick={onAvatarClick}
          onKeyDown={(event) => {
            if (event.key === 'enter' || event.key === 'space') {
              event.preventDefault()
              onAvatarClick()
            }
          }}
          style={{
            flexShrink: 0,
            width: 70,
            height: 70,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: avatarBorder,
            backgroundColor: avatarBackground,
            overflow: 'hidden',
            cursor: showAvatar ? 'pointer' : 'default',
            boxShadow: {
              offsetX: 0,
              offsetY: 0,
              blurRadius: 16,
              spreadRadius: 0,
              color: withAlpha(avatarGlow, 0.35),
            },
          }}
        >
          {showAvatar ? (
            <RemoteImage
              url={target.avatarUrl}
              thumbnailSize={140}
              objectFit="cover"
              style={{ width: 66, height: 66, borderRadius: 999 }}
              fallback={
                <AvatarFallback
                  name={target.displayName}
                  size={66}
                  color={headerText}
                  background={avatarBackground}
                />
              }
            />
          ) : (
            <AvatarFallback
              name={target.displayName}
              size={66}
              color={headerText}
              background={avatarBackground}
            />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'start',
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 4,
                alignItems: 'center',
                minWidth: 0,
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: headerText,
                  minWidth: 0,
                  flexShrink: 1,
                }}
              >
                {formatDisplayUsername(target.displayName)}
              </Text>
              <UserCardBadges badges={userBadges} size={18} />
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                fontSize: 12,
                color: headerMuted,
              }}
            >
              <div>@</div>
              <div>{titleHandle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                maxWidth: 75,
                minHeight: 20,
                paddingLeft: 7,
                paddingRight: 7,
                borderRadius: 999,
                backgroundColor: withAlpha(
                  platformColor(target.platform),
                  theme.isLight ? 0.12 : 0.2,
                ),
                borderWidth: 1,
                borderColor: withAlpha(platformColor(target.platform), 0.32),
              }}
            >
              <PlatformIcon
                platform={target.platform}
                size={11}
                color={theme.isLight ? theme.text : '#ffffff'}
              />
              <Text style={{ fontSize: 9, fontWeight: 700, color: headerText }}>
                {target.platform.toUpperCase()}
              </Text>
            </div>
            {effectiveAlias ? (
              <HeaderPillUI>{t('userCard.alias.pill', { alias: effectiveAlias })}</HeaderPillUI>
            ) : null}
          </div>
        </div>
      </div>
      {/* Compact actions stay inline with the user info instead of adding header height. */}
      {channelUrl || (windows && !standalone) ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {channelUrl ? (
            <HeaderAction
              icon="externalLink"
              label={openingPublicChannel ? t('userCard.opening') : t('userCard.openChannel')}
              disabled={openingPublicChannel}
              onClick={openPublicChannel}
              backgroundColor={headerButtonBg}
              hoverBackgroundColor={headerButtonHover}
              borderColor={headerBorder}
              color={theme.text2}
            />
          ) : null}
          {windows && !standalone ? (
            <HeaderAction
              icon="monitor"
              label={openingWindow ? t('userCard.opening') : t('userCard.openInWindow')}
              disabled={openingWindow}
              onClick={openWindow}
              backgroundColor={headerButtonBg}
              hoverBackgroundColor={headerButtonHover}
              borderColor={headerBorder}
              color={theme.text2}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
