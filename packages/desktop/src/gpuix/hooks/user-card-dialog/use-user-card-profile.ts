import type { UserCosmetics } from '@desktop/services/cosmetics'
import { useBackend } from '@gpuix/backend/context'
import { errorText } from '@gpuix/components/user-card/format'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { useStoreSelector } from '@gpuix/state/create-store'
import { emotePreferencesStore } from '@gpuix/state/emote-preferences'
import type { UserProfileSnapshot } from '@twirchat/shared/user-profile'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useCallback, useEffect, useState } from 'react'

interface PaintImage {
  path: string
  width: number
  height: number
}

interface UseUserCardProfileOptions {
  target: UserCardTarget
  hideAvatar: boolean
  onAvatarChange?: (url?: string) => void
}

export function useUserCardProfile({
  target,
  hideAvatar,
  onAvatarChange,
}: UseUserCardProfileOptions) {
  const backend = useBackend()
  const badgesEnabled = useStoreSelector(emotePreferencesStore, (state) => state.value.badges)
  const paintsEnabled = useStoreSelector(emotePreferencesStore, (state) => state.value.paints)
  const communityBadges = useStoreSelector(
    emotePreferencesStore,
    (state) => state.value.communityBadges,
  )
  const [profile, setProfile] = useState<UserProfileSnapshot | null>(null)
  const [cosmetics, setCosmetics] = useState<UserCosmetics | null>(null)
  const [paintImage, setPaintImage] = useState<PaintImage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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

  const copyAvatarUrl = useCallback(async (): Promise<void> => {
    const url = profile?.avatarUrl
    if (!url) return
    try {
      await backend.api.copyText({ text: url })
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [backend, profile?.avatarUrl])

  const openSevenTvProfile = useCallback(async (): Promise<void> => {
    const sevenTvUserId = cosmetics?.sevenTvUserId
    if (!sevenTvUserId) return
    try {
      await backend.api.openExternalUrl({ url: `https://7tv.app/users/${sevenTvUserId}` })
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [backend, cosmetics?.sevenTvUserId])

  return {
    profile,
    cosmetics,
    paintImage,
    badgesEnabled,
    paintsEnabled,
    loading,
    error,
    copyAvatarUrl,
    openSevenTvProfile,
  }
}

export type UserCardProfileState = ReturnType<typeof useUserCardProfile>
