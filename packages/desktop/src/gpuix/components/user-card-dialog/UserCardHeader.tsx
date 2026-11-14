import { PlatformIcon } from '@gpuix/components/ui/Icon'
import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { Text } from '@gpuix/components/ui/Text'
import { hexMix } from '@gpuix/components/user-card/format'
import { useT } from '@gpuix/i18n'
import type { LinearGradientBackground } from '@gpuix/react'
import { platformColor, withAlpha, type Theme } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'

import type { UserCardHeaderAccent, UserCardHeaderProps } from './types'
import { GhostButton, HeaderPill as HeaderPillUI } from './UserCardUI'
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
      {/* GPUI clips overflow to a rectangle, so keep the glows clear of the rounded corners. */}
      <div
        style={{
          position: 'absolute',
          top: -76,
          right: 24,
          width: 230,
          height: 230,
          borderRadius: 115,
          backgroundColor: theme.isLight
            ? withAlpha(theme.accent.deep, 0.09)
            : withAlpha('#ffffff', 0.08),
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -96,
          left: 140,
          width: 220,
          height: 220,
          borderRadius: 110,
          backgroundColor: theme.isLight
            ? withAlpha(theme.accent.deep, 0.06)
            : withAlpha('#ffffff', 0.05),
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          minWidth: 0,
          flexGrow: 1,
          flexBasis: 320,
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
            width: 78,
            height: 78,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: avatarBorder,
            backgroundColor: avatarBackground,
            overflow: 'hidden',
            cursor: showAvatar ? 'pointer' : 'default',
            boxShadow: {
              offsetX: 0,
              offsetY: 0,
              blurRadius: 20,
              spreadRadius: 1,
              color: withAlpha(avatarGlow, 0.45),
            },
          }}
        >
          {showAvatar ? (
            <RemoteImage
              url={target.avatarUrl}
              thumbnailSize={156}
              objectFit="cover"
              style={{ width: 74, height: 74, borderRadius: 999 }}
              fallback={
                <AvatarFallback
                  name={target.displayName}
                  size={74}
                  color={headerText}
                  background={avatarBackground}
                />
              }
            />
          ) : (
            <AvatarFallback
              name={target.displayName}
              size={74}
              color={headerText}
              background={avatarBackground}
            />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
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
                  fontSize: 20,
                  fontWeight: 800,
                  color: headerText,
                  minWidth: 0,
                  flexShrink: 1,
                }}
              >
                {formatDisplayUsername(target.displayName)}
              </Text>
              {userBadges.map((badge, index) => (
                <div
                  key={`${badge.type}:${badge.id}:${index}`}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 5,
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  {badge.imageUrl ? (
                    <RemoteImage
                      url={badge.imageUrl}
                      objectFit="cover"
                      style={{ width: 18, height: 18 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        backgroundColor: withAlpha('#000000', 0.2),
                        color: headerText,
                      }}
                    >
                      {badge.text[0]?.toUpperCase() ?? '?'}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                fontSize: 13,
                color: headerMuted,
              }}
            >
              <div>@</div>
              <div>{titleHandle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                maxWidth: 80,
                minHeight: 22,
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: 999,
                backgroundColor: withAlpha(
                  platformColor(target.platform),
                  theme.isLight ? 0.14 : 0.24,
                ),
                borderWidth: 1,
                borderColor: withAlpha(platformColor(target.platform), 0.36),
              }}
            >
              <PlatformIcon
                platform={target.platform}
                size={12}
                color={theme.isLight ? theme.text : '#ffffff'}
              />
              <Text style={{ fontSize: 10, fontWeight: 700, color: headerText }}>
                {target.platform.toUpperCase()}
              </Text>
            </div>
            {effectiveAlias ? (
              <HeaderPillUI>{t('userCard.alias.pill', { alias: effectiveAlias })}</HeaderPillUI>
            ) : null}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'start',
              flexDirection: 'row',
              flexWrap: 'wrap',
              marginTop: 10,
              gap: 4,
              alignItems: 'center',
            }}
          ></div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {channelUrl ? (
            <GhostButton
              disabled={openingPublicChannel}
              onClick={openPublicChannel}
              icon="externalLink"
              justify="start"
              style={{
                width: '100%',
                backgroundColor: headerButtonBg,
                borderColor: headerBorder,
                borderRadius: 10,
                paddingLeft: 14,
                paddingRight: 14,
                hover: { backgroundColor: headerButtonHover },
              }}
            >
              {openingPublicChannel ? t('userCard.opening') : t('userCard.openChannel')}
            </GhostButton>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {windows && !standalone ? (
            <GhostButton
              disabled={openingWindow}
              onClick={openWindow}
              icon="externalLink"
              style={{
                backgroundColor: headerButtonBg,
                borderColor: headerBorder,
                borderRadius: 10,
                paddingLeft: 14,
                paddingRight: 14,
                hover: { backgroundColor: headerButtonHover },
              }}
            >
              {openingWindow ? t('userCard.opening') : t('userCard.openInWindow')}
            </GhostButton>
          ) : null}
        </div>
      </div>
    </div>
  )
}
