import { useMediaQuery } from '@desktop/gpuix/hooks/use-media'
import { BadgeTooltip } from '@gpuix/components/ui/BadgeTooltip'
import { Icon } from '@gpuix/components/ui/Icon'
import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { Text } from '@gpuix/components/ui/Text'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import {
  useUserCardProfile,
  type UserCardProfileState,
} from '@gpuix/hooks/user-card-dialog/use-user-card-profile'
import { useT } from '@gpuix/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import { withAlpha } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { initialsOf } from '@views/shared/utils/display-text'

import { ProfileDescription } from './ProfileDescription'
import type { ProfileEntry, UserProfileProps } from './types'
import { GhostButton, UserCardPanel } from './UserCardUI'
import { accentGradient, mergeBadges, userCardWellColor } from './utils'

function ProfileAvatarFallback({ name, size }: { name: string; size: number }) {
  const theme = useTheme()
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: accentGradient(theme),
      }}
    >
      <Text
        style={{
          fontSize: Math.round(size * 0.28),
          fontWeight: 800,
          color: theme.accent.onDeep,
        }}
      >
        {initialsOf(name, 2)}
      </Text>
    </div>
  )
}

function ProfileInfoRow({ entry, first }: { entry: ProfileEntry; first: boolean }) {
  const theme = useTheme()
  const isStringValue = typeof entry.value === 'string'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingTop: 9,
        paddingBottom: 9,
        paddingLeft: 12,
        paddingRight: 12,
        borderTopWidth: first ? 0 : 1,
        borderColor: theme.hairline,
      }}
    >
      <Icon name={entry.icon} size={14} color={theme.accent.primary} />
      <Text
        style={{ width: 104, flexShrink: 0, fontSize: 11, fontWeight: 600, color: theme.text2 }}
      >
        {entry.label}
      </Text>
      {entry.color ? (
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            flexShrink: 0,
            backgroundColor: entry.color,
            borderWidth: 1,
            borderColor: withAlpha('#ffffff', 0.25),
          }}
        />
      ) : null}
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        {isStringValue ? (
          <Text
            style={{
              fontSize: 12,
              lineHeight: 18,
              color: theme.text,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {entry.value}
          </Text>
        ) : (
          entry.value
        )}
      </div>
    </div>
  )
}

export function UserProfile({ target, hideAvatar = false, onAvatarChange }: UserProfileProps) {
  const state = useUserCardProfile({ target, hideAvatar, onAvatarChange })
  return <UserProfileView target={target} hideAvatar={hideAvatar} state={state} />
}

export function UserProfileView({
  target,
  hideAvatar,
  state,
}: {
  target: UserCardTarget
  hideAvatar: boolean
  state: UserCardProfileState
}) {
  const theme = useTheme()
  const { t, language } = useT()
  const {
    profile,
    cosmetics,
    paintImage,
    badgesEnabled,
    paintsEnabled,
    loading,
    error,
    copyText,
    copyAvatarUrl,
    openSevenTvProfile,
  } = state

  const avatarUrl = hideAvatar ? undefined : (profile?.avatarUrl ?? target.avatarUrl)
  const cosmeticBadges = mergeBadges(cosmetics?.badges, cosmetics?.inventoryBadges)
  const entries: ProfileEntry[] = []
  if (profile) {
    const streamStatus = profile.live
      ? true
      : profile.errors.some((item) => item.section === 'live')
        ? undefined
        : false

    const liveValue =
      streamStatus !== false ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            flexGrow: 1,
            minWidth: 0,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              lineHeight: 18,
              color: theme.text,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flexGrow: 1,
              minWidth: 0,
            }}
          >
            {profile.live?.title ?? ''}
          </Text>
          {profile.live?.viewers && (
            <Text
              style={{
                fontSize: 12,
                lineHeight: 18,
                color: theme.text,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {t('userCard.profile.viewers.other', { count: profile.live.viewers })}
            </Text>
          )}
        </div>
      ) : (
        t('userCard.profile.offline')
      )

    entries.push({
      icon: 'eye',
      label: t('userCard.profile.live'),
      value: liveValue,
      color: streamStatus === false ? 'red' : 'green',
    })

    if (profile.followers !== undefined)
      entries.push({
        icon: 'users',
        label: t('userCard.profile.followers'),
        value: profile.followers.toLocaleString(language),
      })
    if (profile.lastLive)
      entries.push({
        icon: 'calendar',
        label: t('userCard.profile.lastLive'),
        value: new Date(profile.lastLive).toLocaleString(language),
      })
    if (profile.pronouns)
      entries.push({
        icon: 'smile',
        label: t('userCard.profile.pronouns'),
        value: profile.pronouns,
      })
    const chatColor = profile.color
    if (chatColor)
      entries.push({
        icon: 'chat',
        label: t('userCard.profile.chatColor'),
        value: (
          <Tooltip delayDuration={200} style={{ width: 28, height: 28, flexShrink: 0 }}>
            <TooltipTrigger asChild>
              <div
                onClick={() => runUiTask(copyText(chatColor))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  cursor: 'pointer',
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 10,
                  backgroundColor: theme.fill,
                  hover: { backgroundColor: theme.fillHover },
                }}
              >
                <Icon name="copy" size={14} color={theme.text} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} style={{ padding: 6, borderRadius: 6 }}>
              <Text style={{ fontSize: 12, color: theme.text }}>
                {t('userCard.profile.copyColor')}
              </Text>
            </TooltipContent>
          </Tooltip>
        ),
        color: chatColor,
      })

    if (profile.broadcasterType)
      entries.push({
        icon: 'monitor',
        label: t('userCard.profile.broadcaster'),
        value: profile.broadcasterType,
      })
    if (profile.roles) {
      const roles = Object.entries(profile.roles)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name.toUpperCase())
        .join(', ')
      entries.push({
        icon: 'star',
        label: t('userCard.profile.roles'),
        value: roles || t('userCard.profile.noRole'),
      })
    }
  }

  // Render cosmetics section (7TV badges, paints, etc.)
  const isWideScreen = useMediaQuery('(min-width: 480px)')
  const cosmeticsSection =
    cosmetics?.sevenTvUserId && (badgesEnabled || paintsEnabled) ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginTop: 16,
          paddingTop: 14,
          borderTopWidth: 1,
          borderColor: theme.hairline,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: isWideScreen ? 'space-between' : 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              minWidth: 0,
            }}
          >
            {paintsEnabled && paintImage ? (
              <img
                src={paintImage.path}
                style={{ width: paintImage.width, height: paintImage.height }}
              />
            ) : null}
            {badgesEnabled
              ? cosmeticBadges.map((badge) => (
                  <BadgeTooltip key={`${badge.type}:${badge.id}`} badge={badge}>
                    {badge.imageUrl ? (
                      <RemoteImage
                        url={badge.imageUrl}
                        style={{ width: 24, height: 24, pointerEvents: 'none' }}
                      />
                    ) : (
                      <Text
                        style={{
                          color: theme.text,
                          fontSize: 12,
                          pointerEvents: 'none',
                          userSelect: 'none',
                        }}
                      >
                        {badge.text}
                      </Text>
                    )}
                  </BadgeTooltip>
                ))
              : null}
            <GhostButton icon="externalLink" onClick={() => runUiTask(openSevenTvProfile())}>
              {t('userCard.profile.openSevenTv')}
            </GhostButton>
          </div>
        </div>
      </div>
    ) : null

  return (
    <UserCardPanel>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <div
          style={{
            width: 112,
            height: 112,
            flexShrink: 0,
            borderRadius: 18,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: withAlpha(theme.accent.primary, 0.35),
            backgroundColor: theme.fill,
            boxShadow: {
              offsetX: 0,
              offsetY: 10,
              blurRadius: 24,
              spreadRadius: 0,
              color: withAlpha(theme.accent.primary, 0.2),
            },
          }}
        >
          {avatarUrl ? (
            <RemoteImage
              url={avatarUrl}
              thumbnailSize={224}
              objectFit="cover"
              style={{ width: 110, height: 110, borderRadius: 18 }}
              fallback={
                <ProfileAvatarFallback
                  name={profile?.displayName ?? target.displayName}
                  size={110}
                />
              }
            />
          ) : (
            <ProfileAvatarFallback name={profile?.displayName ?? target.displayName} size={110} />
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            flexGrow: 1,
            flexBasis: 280,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 0,
                paddingLeft: 4,
              }}
            >
              {loading ? (
                <>
                  <div
                    style={{
                      width: 160,
                      height: 20,
                      borderRadius: 4,
                      backgroundColor: withAlpha(theme.text2, 0.15),
                    }}
                  />
                  <div
                    style={{
                      width: 100,
                      height: 15,
                      borderRadius: 3,
                      backgroundColor: withAlpha(theme.text2, 0.1),
                    }}
                  />
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 16, fontWeight: 800, color: theme.text }}>
                    {profile?.displayName ?? target.displayName}
                  </Text>
                  {profile?.login ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        fontSize: 13,
                        color: theme.text2,
                      }}
                    >
                      <div>@</div>
                      <div>{profile?.login}</div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
            {avatarUrl ? (
              <GhostButton icon="copy" onClick={() => runUiTask(copyAvatarUrl())}>
                {t('userCard.profile.copyAvatar')}
              </GhostButton>
            ) : null}
          </div>

          {loading ? (
            <div
              style={{
                width: '100%',
                height: 40,
                borderRadius: 8,
                backgroundColor: withAlpha(theme.text2, 0.1),
              }}
            />
          ) : (
            <ProfileDescription description={profile?.description} />
          )}

          {loading ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                borderWidth: 1,
                borderColor: theme.hairline,
                borderRadius: 12,
                overflow: 'hidden',
                backgroundColor: userCardWellColor(theme),
              }}
            >
              {[
                { label: 'Live', hasColor: true },
                { label: 'Followers' },
                { label: 'Last live' },
                { label: 'Pronouns' },
                { label: 'Chat color', hasColor: true },
                { label: 'Broadcaster' },
                { label: 'Roles' },
              ].map((skeleton, index) => (
                <div
                  key={skeleton.label}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingTop: 9,
                    paddingBottom: 9,
                    paddingLeft: 12,
                    paddingRight: 12,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderColor: theme.hairline,
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      flexShrink: 0,
                      borderRadius: 3,
                      backgroundColor: withAlpha(theme.text2, 0.15),
                    }}
                  />
                  <div
                    style={{
                      width: 104,
                      flexShrink: 0,
                      height: 11,
                      borderRadius: 2,
                      backgroundColor: withAlpha(theme.text2, 0.15),
                    }}
                  />
                  {skeleton.hasColor ? (
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        flexShrink: 0,
                        backgroundColor: withAlpha(theme.text2, 0.15),
                        borderWidth: 1,
                        borderColor: withAlpha('#ffffff', 0.25),
                      }}
                    />
                  ) : null}
                  <div
                    style={{
                      flexGrow: 1,
                      minWidth: 0,
                      height: 12,
                      borderRadius: 2,
                      backgroundColor: withAlpha(theme.text2, 0.15),
                    }}
                  />
                </div>
              ))}
            </div>
          ) : error ? (
            <Text style={{ fontSize: 12, color: theme.dangerText }}>{error}</Text>
          ) : entries.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                borderWidth: 1,
                borderColor: theme.hairline,
                borderRadius: 12,
                overflow: 'hidden',
                backgroundColor: userCardWellColor(theme),
              }}
            >
              {entries.map((entry, index) => (
                <ProfileInfoRow key={entry.label} entry={entry} first={index === 0} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {profile?.nameHistory?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name="clock" size={14} color={theme.accent.primary} />
            <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text2 }}>
              {t('userCard.profile.nameHistory')}
            </Text>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              padding: 10,
              borderWidth: 1,
              borderColor: theme.hairline,
              borderRadius: 10,
              backgroundColor: userCardWellColor(theme),
            }}
          >
            {profile.nameHistory.map((entry, index) => {
              const firstSeen = entry.firstSeen
                ? new Date(entry.firstSeen).toLocaleDateString(language)
                : '?'
              const lastSeen = entry.lastSeen
                ? new Date(entry.lastSeen).toLocaleDateString(language)
                : '?'
              return (
                <div
                  key={`${entry.login}-${index}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    gap: 8,
                    borderBottomWidth: 1,
                    borderColor: theme.border,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      fontSize: 18,
                      fontWeight: 600,
                      color: theme.text,
                      paddingBottom: 4,
                    }}
                  >
                    {entry.login}:
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', fontSize: 18, color: theme.text2 }}>
                      {firstSeen}
                    </div>
                    <div style={{ fontSize: 18, color: theme.text2 }}>-</div>
                    <div style={{ display: 'flex', fontSize: 18, color: theme.text2 }}>
                      {lastSeen}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                backgroundColor: withAlpha(theme.text2, 0.15),
              }}
            />
            <div
              style={{
                width: 120,
                height: 16,
                borderRadius: 3,
                backgroundColor: withAlpha(theme.text2, 0.15),
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              padding: 10,
              borderWidth: 1,
              borderColor: theme.hairline,
              borderRadius: 10,
              backgroundColor: userCardWellColor(theme),
            }}
          >
            {[0, 1, 2, 3].map((_, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 100,
                    height: 20,
                    borderRadius: 3,
                    backgroundColor: withAlpha(theme.text2, 0.15),
                  }}
                />
                <div
                  style={{
                    width: 140,
                    height: 20,
                    borderRadius: 3,
                    backgroundColor: withAlpha(theme.text2, 0.1),
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {cosmeticsSection}
    </UserCardPanel>
  )
}
