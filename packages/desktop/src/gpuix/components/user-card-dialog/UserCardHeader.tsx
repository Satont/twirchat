import { Badge } from '@gpuix/components/ui/Badge'
import { PlatformIcon, Icon } from '@gpuix/components/ui/Icon'
import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { Text } from '@gpuix/components/ui/Text'
import { hexMix } from '@gpuix/components/user-card/format'
import { platformColor } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import type { Badge as BadgeData } from '@twirchat/shared/types'
import { initialsOf } from '@views/shared/utils/display-text'

import { GhostButton, HeaderPill as HeaderPillUI } from './UserCardUI'

interface UserCardHeaderProps {
  target: {
    platform: string
    platformUserId: string
    displayName: string
    username?: string
    avatarUrl?: string
    badges?: BadgeData[]
  }
  hideAvatar: boolean
  channelUrl: string | undefined
  openingPublicChannel: boolean
  openPublicChannel: () => void
  onAvatarClick: () => void
  effectiveAlias?: string
}

function initials(name: string): string {
  return initialsOf(name, 2)
}

function formatDisplayUsername(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function UserCardHeader({
  target,
  hideAvatar,
  channelUrl,
  openingPublicChannel,
  openPublicChannel,
  onAvatarClick,
  effectiveAlias,
}: UserCardHeaderProps) {
  const theme = useTheme()
  const titleHandle = target.username ?? target.platformUserId

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: 20,
        marginBottom: 18,
        background: {
          type: 'linear-gradient',
          angle: 135,
          stops: [
            {
              color: theme.isLight
                ? hexMix(platformColor(target.platform), theme.dialog, 0.22)
                : hexMix(platformColor(target.platform), '#101012', 0.72),
              position: 0,
            },
            { color: theme.dialog, position: 1 },
          ],
        },
        borderBottomWidth: 1,
        borderColor: theme.hairline,
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', gap: 12, paddingLeft: 14 }}>
        <div
          testId="user-card-avatar"
          tabIndex={!hideAvatar && target.avatarUrl ? 0 : undefined}
          onClick={onAvatarClick}
          onKeyDown={(event) => {
            if (event.key === 'enter' || event.key === 'space') {
              event.preventDefault()
              onAvatarClick()
            }
          }}
          style={{
            flexShrink: 0,
            cursor: !hideAvatar && target.avatarUrl ? 'pointer' : 'default',
          }}
        >
          {!hideAvatar && target.avatarUrl ? (
            <RemoteImage
              url={target.avatarUrl}
              avatarSize={72}
              objectFit="cover"
              style={{
                width: 72,
                height: 72,
                borderRadius: 999,
                backgroundColor: theme.fill,
              }}
            />
          ) : (
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 999,
                backgroundColor: hexMix(platformColor(target.platform), '#000', 0.5),
                borderWidth: 1,
                borderColor: theme.border,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontWeight: 800, fontSize: 24, color: theme.text }}>
                {initials(target.displayName)}
              </Text>
            </div>
          )}
        </div>

        <div>
          <div
            style={{
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 18,
                    fontWeight: 900,
                    color: theme.text,
                  }}
                >
                  {formatDisplayUsername(target.displayName)}
                  {target.badges && target.badges.length > 0 ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {target.badges.slice(0, 4).map((badge, index) => (
                        <div
                          key={`${badge.id}-${index}`}
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 3,
                            overflow: 'hidden',
                            flexShrink: 0,
                          }}
                        >
                          {badge.imageUrl ? (
                            <RemoteImage
                              url={badge.imageUrl}
                              style={{ width: 18, height: 18, objectFit: 'cover' }}
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
                                backgroundColor: theme.fill,
                                color: theme.text,
                              }}
                            >
                              {badge.text[0]?.toUpperCase() ?? '?'}
                            </div>
                          )}
                        </div>
                      ))}
                      {target.badges.length > 4 && (
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 3,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                            backgroundColor: theme.fill,
                            color: theme.text2,
                          }}
                        >
                          +{target.badges.length - 4}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    fontSize: 13,
                    color: theme.text2,
                  }}
                >
                  @{titleHandle}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                flexShrink: 0,
              }}
            >
              <Badge
                size="sm"
                backgroundColor={hexMix(platformColor(target.platform), '#000', 0.4)}
                color="#fff"
                style={{
                  gap: 4,
                  paddingLeft: 6,
                  paddingRight: 6,
                  paddingTop: 3,
                  paddingBottom: 3,
                  borderRadius: 999,
                }}
              >
                <PlatformIcon platform={target.platform} size={12} color="#fff" />
                {target.platform.toUpperCase()}
              </Badge>
            </div>
          </div>

          {effectiveAlias ? <HeaderPillUI accent>{`Alias: ${effectiveAlias}`}</HeaderPillUI> : null}
        </div>
      </div>
      <div>
        {channelUrl ? (
          <GhostButton
            disabled={openingPublicChannel}
            onClick={openPublicChannel}
            style={{
              backgroundColor: hexMix(platformColor(target.platform), '#000', 0.5),
              borderRadius: 16,
              paddingTop: 4,
              paddingBottom: 4,
              paddingLeft: 10,
              paddingRight: 10,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              {openingPublicChannel ? 'Opening…' : 'Open channel'}
              <Icon name="externalLink" size={12} color="#fff" />
            </div>
          </GhostButton>
        ) : null}
      </div>
    </div>
  )
}
