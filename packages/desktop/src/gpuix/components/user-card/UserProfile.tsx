import type { UserProfileSnapshot } from '@twirchat/shared/user-profile'
import { useEffect, useState } from 'react'

import type { UserCosmetics } from '../../../services/cosmetics'
import type { UserCardTarget } from '../../../views/main/utils/chatCommands'
import { useBackend } from '../../backend/context'
import { runUiTask } from '../../hooks/run-ui-task'
import { useTheme } from '../../theme-context'
import { ActionButton } from '../ui/Form'
import { RemoteImage } from '../ui/RemoteImage'
import { Text } from '../ui/Text'

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
    const requests = [
      backend.api.getUserCosmetics({ platform, platformUserId, username }).then(async (value) => {
        if (!active) return
        setCosmetics(value)
        if (value?.paint) {
          const image = await backend.api.getPaintNameImage({
            name: displayName,
            paint: value.paint,
            fontSize: 18,
          })
          if (active) setPaintImage(image)
        }
      }),
    ]
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
  }, [backend, platform, platformUserId, username, channelSlug, displayName])
  useEffect(() => {
    onAvatarChange?.(hideAvatar ? undefined : profile?.avatarUrl)
  }, [profile?.avatarUrl, hideAvatar, onAvatarChange])
  const entries: [string, string | undefined][] = profile
    ? [
        [
          'Live',
          profile.live
            ? `${profile.live.title} · ${profile.live.category} · ${profile.live.viewers} viewers`
            : profile.errors.some((item) => item.section === 'live')
              ? undefined
              : 'Offline',
        ],
        ['Followers', profile.followers?.toLocaleString()],
        [
          'Latest archived stream',
          profile.lastLive ? new Date(profile.lastLive).toLocaleString() : undefined,
        ],
        ['Pronouns', profile.pronouns],
        ['Chat color', profile.color || undefined],
        ['Broadcaster', profile.broadcasterType || undefined],
        [
          'Channel roles',
          profile.roles
            ? Object.entries(profile.roles)
                .filter(([, enabled]) => enabled)
                .map(([name]) => name)
                .join(', ') || 'No confirmed channel role'
            : undefined,
        ],
      ]
    : []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
      {loading ? <Text style={{ fontSize: 12, color: theme.text2 }}>Loading profile…</Text> : null}
      {error ? <Text style={{ fontSize: 12, color: theme.dangerText }}>{error}</Text> : null}
      {!hideAvatar && profile?.avatarUrl ? (
        <ActionButton
          onClick={() =>
            void backend.api
              .copyText({ text: profile.avatarUrl! })
              .catch((cause: unknown) => setError(String(cause)))
          }
        >
          Copy profile avatar URL
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
            Name history · logs.zonian.dev (observed names)
          </Text>
          {profile.nameHistory.map((entry, index) => (
            <Text key={index} style={{ color: theme.text, fontSize: 12 }}>
              {`${entry.login} · ${entry.firstSeen ? new Date(entry.firstSeen).toLocaleDateString() : '?'} – ${entry.lastSeen ? new Date(entry.lastSeen).toLocaleDateString() : '?'}`}
            </Text>
          ))}
        </>
      ) : null}
      {cosmetics?.sevenTvUserId ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {paintImage ? (
              <img
                src={paintImage.path}
                style={{ width: paintImage.width, height: paintImage.height }}
              />
            ) : null}
            {cosmetics.badges.map((badge) =>
              badge.imageUrl ? (
                <RemoteImage
                  key={badge.id}
                  url={badge.imageUrl}
                  style={{ width: 24, height: 24 }}
                />
              ) : (
                <Text key={badge.id} style={{ color: theme.text, fontSize: 12 }}>
                  {badge.text}
                </Text>
              ),
            )}
          </div>
          {cosmetics.paint ? (
            <Text style={{ color: theme.text2, fontSize: 12 }}>
              7TV paint: {cosmetics.paint.name}
            </Text>
          ) : null}
          <ActionButton
            onClick={() =>
              void backend.api
                .openExternalUrl({ url: `https://7tv.app/users/${cosmetics.sevenTvUserId}` })
                .catch((cause: unknown) => setError(String(cause)))
            }
          >
            Open 7TV profile
          </ActionButton>
        </>
      ) : cosmetics?.lookupStatus === 'unavailable' ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>7TV cosmetics are unavailable.</Text>
      ) : null}
      {profile?.errors.map((item) => (
        <Text key={item.section} style={{ fontSize: 11, color: theme.text2 }}>
          {item.section}: {item.message}
        </Text>
      ))}
    </div>
  )
}
