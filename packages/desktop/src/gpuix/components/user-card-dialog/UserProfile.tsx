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
      <Text style={{ flexGrow: 1, minWidth: 0, fontSize: 12, lineHeight: 18, color: theme.text }}>
        {entry.value}
      </Text>
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
  const STREAM_NAME_MAX_LENGHT = 15
  if (profile) {
    const labelStream =
      `${profile.live?.title ? (profile.live?.title.length >= STREAM_NAME_MAX_LENGHT ? profile.live?.title.slice(STREAM_NAME_MAX_LENGHT) + '...' : profile.live?.title) : ''}${' '.repeat(2)}` +
      `${profile.live?.viewers ? t('userCard.profile.viewers.other', { count: profile.live?.viewers }) : ''}${' '.repeat(2)}`

    const streamStatus = profile.live
      ? true
      : profile.errors.some((item) => item.section === 'live')
        ? undefined
        : false

    entries.push({
      icon: 'eye',
      label: t('userCard.profile.live'),
      value: streamStatus !== false ? labelStream : t('userCard.profile.offline'),
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
          <GhostButton
            style={{ maxWidth: 150 }}
            icon="copy"
            onClick={() => runUiTask(copyText(chatColor))}
          >
            {t('userCard.profile.copyColor')}
          </GhostButton>
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
            </div>
            {avatarUrl ? (
              <GhostButton icon="copy" onClick={() => runUiTask(copyAvatarUrl())}>
                {t('userCard.profile.copyAvatar')}
              </GhostButton>
            ) : null}
          </div>

          <ProfileDescription description={profile?.description} />

          {loading ? (
            <Text style={{ fontSize: 12, color: theme.text2 }}>
              {t('userCard.profile.loading')}
            </Text>
          ) : null}
          {error ? <Text style={{ fontSize: 12, color: theme.dangerText }}>{error}</Text> : null}

          {entries.length > 0 ? (
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
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      fontSize: 18,
                      fontWeight: 600,
                      color: theme.text,
                    }}
                  >
                    {entry.login}
                  </div>
                  <Text style={{ fontSize: 18, color: theme.text2 }}>
                    {`${firstSeen} – ${lastSeen}`}
                  </Text>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {cosmetics?.sevenTvUserId && (badgesEnabled || paintsEnabled) ? (
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
              justifyContent: 'space-between',
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
              {paintsEnabled && cosmetics.paint ? (
                <Text style={{ color: theme.text2, fontSize: 12 }}>
                  {t('userCard.profile.paint', { name: cosmetics.paint.name })}
                </Text>
              ) : null}
            </div>
            <GhostButton icon="externalLink" onClick={() => runUiTask(openSevenTvProfile())}>
              {t('userCard.profile.openSevenTv')}
            </GhostButton>
          </div>
        </div>
      ) : cosmetics?.lookupStatus === 'unavailable' ? (
        <Text style={{ fontSize: 12, color: theme.text2, marginTop: 12 }}>
          {t('userCard.profile.cosmeticsUnavailable')}
        </Text>
      ) : null}
    </UserCardPanel>
  )
}
