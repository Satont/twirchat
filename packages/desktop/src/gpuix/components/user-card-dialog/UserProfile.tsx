import { BadgeTooltip } from '@gpuix/components/ui/BadgeTooltip'
import { Icon, type IconName } from '@gpuix/components/ui/Icon'
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

import type { ProfileEntry, UserProfileProps } from './types'
import { GhostButton, UserCardPanel } from './UserCardUI'
import { accentGradient, userCardWellColor } from './utils'

function pushEntry(
  entries: ProfileEntry[],
  icon: IconName,
  label: string,
  value: string | undefined,
  color?: string,
): void {
  if (value !== undefined) entries.push({ icon, label, value, color })
}

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
  const { t, tPlural, language } = useT()
  const {
    profile,
    cosmetics,
    paintImage,
    badgesEnabled,
    paintsEnabled,
    loading,
    error,
    copyAvatarUrl,
    openSevenTvProfile,
  } = state

  const avatarUrl = hideAvatar ? undefined : profile?.avatarUrl
  const entries: ProfileEntry[] = []
  if (profile) {
    pushEntry(
      entries,
      'eye',
      t('userCard.profile.live'),
      profile.live
        ? t('userCard.profile.liveValue', {
            title: profile.live.title,
            category: profile.live.category,
            viewers: tPlural('userCard.profile.viewers', profile.live.viewers),
          })
        : profile.errors.some((item) => item.section === 'live')
          ? undefined
          : t('userCard.profile.offline'),
    )
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
    if (profile.color)
      entries.push({
        icon: 'chat',
        label: t('userCard.profile.chatColor'),
        value: profile.color,
        color: profile.color,
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
        .map(([name]) => name)
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: 800, color: theme.text }}>
                {profile?.displayName ?? target.displayName}
              </Text>
              {profile?.login ? (
                <Text style={{ fontSize: 12, color: theme.text2 }}>@{profile.login}</Text>
              ) : null}
            </div>
            {avatarUrl ? (
              <GhostButton icon="copy" onClick={() => runUiTask(copyAvatarUrl())}>
                {t('userCard.profile.copyAvatar')}
              </GhostButton>
            ) : null}
          </div>

          {profile?.description ? (
            <Text style={{ fontSize: 13, lineHeight: 19, color: theme.text }}>
              {profile.description}
            </Text>
          ) : null}

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
            <Text style={{ fontSize: 11, fontWeight: 700, color: theme.text2 }}>
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
                  <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>
                    {entry.login}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.text2 }}>
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
                ? cosmetics.badges.map((badge) => (
                    <BadgeTooltip key={badge.id} badge={badge}>
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

      {profile?.errors.map((item) => (
        <Text key={item.section} style={{ fontSize: 10, color: theme.text2, marginTop: 6 }}>
          {item.section}: {item.message}
        </Text>
      ))}
    </UserCardPanel>
  )
}
