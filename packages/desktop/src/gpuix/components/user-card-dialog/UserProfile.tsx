import type { UserCosmetics } from '@desktop/services/cosmetics'
import { useBackend } from '@gpuix/backend/context'
import { BadgeTooltip } from '@gpuix/components/ui/BadgeTooltip'
import { ActionButton } from '@gpuix/components/ui/Form'
import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { Text } from '@gpuix/components/ui/Text'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { useT } from '@gpuix/i18n'
import { useStoreSelector } from '@gpuix/state/create-store'
import { emotePreferencesStore } from '@gpuix/state/emote-preferences'
import { useTheme } from '@gpuix/theme-context'
import type { UserProfileSnapshot } from '@twirchat/shared/user-profile'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useEffect, useState } from 'react'

export function UserProfile({
  target,
  hideAvatar = false,
  onAvatarChange,
}: {
  target: UserCardTarget
  hideAvatar?: boolean
  onAvatarChange?: (url?: string) => void
}) {
  const backend = useBackend()
  const theme = useTheme()
  const { t, tPlural, language } = useT()
  const badgesEnabled = useStoreSelector(emotePreferencesStore, (state) => state.value.badges)
  const paintsEnabled = useStoreSelector(emotePreferencesStore, (state) => state.value.paints)
  const communityBadges = useStoreSelector(
    emotePreferencesStore,
    (state) => state.value.communityBadges,
  )
  const [profile, setProfile] = useState<UserProfileSnapshot | null>(null)
  const [cosmetics, setCosmetics] = useState<UserCosmetics | null>(null)
  const [paintImage, setPaintImage] = useState<{
    path: string
    width: number
    height: number
  } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const { platform, platformUserId, username, channelSlug, displayName } = target
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setProfile(null)
    setCosmetics(null)
    setPaintImage(null)
    const requests: Promise<void>[] = []
    if (badgesEnabled || paintsEnabled)
      requests.push(
        backend.api
          .getUserCosmetics({
            platform,
            platformUserId,
            username,
            preferences: { badges: badgesEnabled, paints: paintsEnabled, communityBadges },
          })
          .then(async (value) => {
            if (!active) return
            setCosmetics(value)
            if (paintsEnabled && value?.paint) {
              const image = await backend.api.getPaintNameImage({
                name: displayName,
                paint: value.paint,
                fontSize: 18,
              })
              if (active) setPaintImage(image)
            }
          }),
      )
    if (platform === 'twitch')
      requests.push(
        backend.api
          .getUserProfile({ platform, platformUserId, username, channelSlug })
          .then((value) => {
            if (active) setProfile(value)
          }),
      )
    runUiTask(
      Promise.allSettled(requests).then((results) => {
        if (!active) return
        setError(
          results
            .filter((result) => result.status === 'rejected')
            .map((result) => String(result.reason))
            .join('\n'),
        )
        setLoading(false)
      }),
    )
    return () => {
      active = false
    }
  }, [
    backend,
    platform,
    platformUserId,
    username,
    channelSlug,
    displayName,
    badgesEnabled,
    paintsEnabled,
    communityBadges,
  ])
  useEffect(() => {
    onAvatarChange?.(hideAvatar ? undefined : profile?.avatarUrl)
  }, [profile?.avatarUrl, hideAvatar, onAvatarChange])
  const entries: [string, string | undefined][] = profile
    ? [
        [
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
        ],
        [t('userCard.profile.followers'), profile.followers?.toLocaleString(language)],
        [
          t('userCard.profile.lastLive'),
          profile.lastLive ? new Date(profile.lastLive).toLocaleString(language) : undefined,
        ],
        [t('userCard.profile.pronouns'), profile.pronouns],
        [t('userCard.profile.chatColor'), profile.color || undefined],
        [t('userCard.profile.broadcaster'), profile.broadcasterType || undefined],
        [
          t('userCard.profile.roles'),
          profile.roles
            ? Object.entries(profile.roles)
                .filter(([, enabled]) => enabled)
                .map(([name]) => name)
                .join(', ') || t('userCard.profile.noRole')
            : undefined,
        ],
      ]
    : []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
      {loading ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>{t('userCard.profile.loading')}</Text>
      ) : null}
      {error ? <Text style={{ fontSize: 12, color: theme.dangerText }}>{error}</Text> : null}
      {!hideAvatar && profile?.avatarUrl ? (
        <ActionButton
          onClick={() =>
            void backend.api
              .copyText({ text: profile.avatarUrl! })
              .catch((cause: unknown) => setError(String(cause)))
          }
        >
          {t('userCard.profile.copyAvatar')}
        </ActionButton>
      ) : null}
      {profile?.description ? (
        <Text style={{ color: theme.text, fontSize: 13 }}>{profile.description}</Text>
      ) : null}
      {entries
        .filter(([, value]) => value !== undefined)
        .map(([label, value]) => (
          <Text key={label} style={{ fontSize: 13, color: theme.text }}>
            {`${label}: ${value}`}
          </Text>
        ))}
      {profile?.nameHistory?.length ? (
        <>
          <Text style={{ color: theme.text2, fontSize: 12 }}>
            {t('userCard.profile.nameHistory')}
          </Text>
          {profile.nameHistory.map((entry, index) => (
            <Text key={index} style={{ color: theme.text, fontSize: 12 }}>
              {`${entry.login} · ${entry.firstSeen ? new Date(entry.firstSeen).toLocaleDateString(language) : '?'} – ${entry.lastSeen ? new Date(entry.lastSeen).toLocaleDateString(language) : '?'}`}
            </Text>
          ))}
        </>
      ) : null}
      {cosmetics?.sevenTvUserId && (badgesEnabled || paintsEnabled) ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
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
          </div>
          {paintsEnabled && cosmetics.paint ? (
            <Text style={{ color: theme.text2, fontSize: 12 }}>
              {t('userCard.profile.paint', { name: cosmetics.paint.name })}
            </Text>
          ) : null}
          <ActionButton
            onClick={() =>
              void backend.api
                .openExternalUrl({ url: `https://7tv.app/users/${cosmetics.sevenTvUserId}` })
                .catch((cause: unknown) => setError(String(cause)))
            }
          >
            {t('userCard.profile.openSevenTv')}
          </ActionButton>
        </>
      ) : cosmetics?.lookupStatus === 'unavailable' ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          {t('userCard.profile.cosmeticsUnavailable')}
        </Text>
      ) : null}
      {profile?.errors.map((item) => (
        <Text key={item.section} style={{ fontSize: 11, color: theme.text2 }}>
          {item.section}: {item.message}
        </Text>
      ))}
    </div>
  )
}
