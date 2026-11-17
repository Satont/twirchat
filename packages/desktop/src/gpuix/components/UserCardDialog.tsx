import type { ModerationPlatform } from '@gpuix/backend/api'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { usePopupHotkeys, scrollPopupPage } from '@gpuix/hooks/use-popup-hotkeys'
import { useT } from '@gpuix/i18n'
import type { IconName } from '@gpuix/icons'
import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { showNotice } from '@gpuix/state/app'
import { useStore } from '@gpuix/state/create-store'
import { useDesktopWindows } from '@gpuix/state/desktop-windows'
import { streamerModeStore } from '@gpuix/state/streamer-mode'
import { useTheme } from '@gpuix/theme-context'
import { logger } from '@twirchat/shared/logger'
import type { Badge } from '@twirchat/shared/types'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { publicChannelURL } from '@views/main/utils/public-channel-url'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getBackendUrl } from '../../runtime-config'
import { Modal } from './ui/Modal'
import type { MetadataItem, UserCardTab } from './user-card-dialog'
import {
  UserCardHeader,
  UserCardTabs,
  UserCardProfileTab,
  userCardHeaderAccent,
  useUserCardAliasValue,
  useUserCardMetadata,
  useUserCardProfile,
  useUserCardPublicChannel,
  useRetainedBadges,
} from './user-card-dialog'
import { UserChatHistoryPanel } from './user-card-dialog/history-panel'
import { ProfilePictureMenu } from './user-card-dialog/ProfilePictureMenu'
import { UserCardActions, useUserCardModeration } from './user-card-dialog/UserCardActions'
import { UserNotes } from './user-card-dialog/UserNotes'
import { mergeBadges } from './user-card-dialog/utils'
import {
  accountAgeText,
  followAgeText,
  subAgeText,
  subscriptionDurationText,
} from './user-card/format'

const log = logger('user-card')

export const UserCardDialog = memo(function UserCardDialog({
  target,
  currentAlias,
  onClose,
  standalone = false,
}: {
  target: UserCardTarget
  currentAlias?: string
  onClose: () => void
  standalone?: boolean
}) {
  const theme = useTheme()
  const { t } = useT()
  const windows = useDesktopWindows()
  const renderer = useGpuixRequired()
  const scrollHeaderRef = useRef(false)
  const streamer = useStore(streamerModeStore)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => {
      scrollHeaderRef.current = window.innerHeight < 500
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const hideAvatar = streamer.effectiveEnabled && streamer.settings.hideUsercardAvatars
  const avatarKey = `${target.platform}:${target.platformUserId}`
  const [profileAvatar, setProfileAvatar] = useState<{ key: string; url?: string }>({
    key: avatarKey,
  })
  const avatarUrl =
    target.avatarUrl ?? (profileAvatar.key === avatarKey ? profileAvatar.url : undefined)
  const updateProfileAvatar = useCallback(
    (url?: string) => setProfileAvatar({ key: avatarKey, url }),
    [avatarKey],
  )
  const profileState = useUserCardProfile({
    target,
    hideAvatar,
    onAvatarChange: updateProfileAvatar,
  })
  const headerAccent = useMemo(
    () =>
      userCardHeaderAccent(
        profileState.profile?.color,
        target.color,
        profileState.cosmetics,
        profileState.paintsEnabled,
      ),
    [profileState.profile?.color, target.color, profileState.cosmetics, profileState.paintsEnabled],
  )
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const [localPinned, setLocalPinned] = useState(false)
  const nativeUserWindow = standalone && windows?.descriptor.kind === 'user'
  const pinned = nativeUserWindow ? windows.pinned : localPinned
  const togglePin = () => {
    if (nativeUserWindow) windows.setPinned(!pinned)
    else setLocalPinned(!pinned)
  }
  const historyViewport = useRef<PublicInstance | null>(null)
  const moderation = useUserCardModeration(target)

  const effectiveAlias = useUserCardAliasValue(target, currentAlias)

  const openPictureRef = useRef<() => void>(() => {})

  const openPicture = useCallback(() => {
    if (!hideAvatar && avatarUrl) {
      renderer.blur?.()
      setAvatarMenuOpen(true)
    }
  }, [hideAvatar, avatarUrl, renderer])
  useEffect(() => {
    if (hideAvatar) setAvatarMenuOpen(false)
  }, [hideAvatar])

  openPictureRef.current = openPicture

  const retainedBadges = useRetainedBadges(target.platform, target.platformUserId, target.channelId)

  const [userBadgeCatalog, setUserBadgeCatalog] = useState<Map<string, Badge>>(new Map())

  useEffect(() => {
    if (target.platform !== 'twitch' || !target.username) return
    const controller = new AbortController()
    const url = new URL(`${getBackendUrl()}/api/twitch/user-badges`)
    url.searchParams.set('broadcasterLogin', target.username)
    fetch(url.toString(), { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (controller.signal.aborted) return

        // Handle different possible API response structures
        // Primary: data.badges
        // Alternative: data.channelViewer?.earnedBadges (from Twitch Helix)
        // Alternative: data.data?.channelViewer?.earnedBadges
        let badgesData = data.badges
        if (!badgesData && data.channelViewer?.earnedBadges) {
          badgesData = data.channelViewer.earnedBadges
        } else if (!badgesData && data.data?.channelViewer?.earnedBadges) {
          badgesData = data.data.channelViewer.earnedBadges
        }

        if (!badgesData || typeof badgesData !== 'object') {
          log.warn('No badge data found in API response', { dataKeys: Object.keys(data) })
          return
        }

        const catalog = new Map<string, Badge>()
        for (const [key, imageUrl] of Object.entries(badgesData)) {
          if (typeof imageUrl !== 'string') continue
          const [setId, version] = key.split('/')
          const meta = data.badgeMetadata?.[key]
          const badge: Badge = {
            id: `twitch:${key}`,
            type: 'twitch',
            text: meta?.title ?? setId,
            ...(meta?.description ? { description: meta.description } : {}),
            imageUrl,
          }
          catalog.set(badge.id, badge)
          // Also index by setId/version for matching with retained badges
          catalog.set(`${setId}/${version}`, badge)
        }
        setUserBadgeCatalog(catalog)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        log.warn('Failed to fetch user badge catalog', { error: String(err) })
      })
    return () => {
      controller.abort()
    }
  }, [target.platform, target.username])

  const enrichedRetainedBadgesRef = useRef<ReturnType<typeof mergeBadges> | null>(null)

  // Enrich retainedBadges with catalog data (imageUrl, description)
  const enrichedRetainedBadges = useMemo(() => {
    const newBadges = retainedBadges.map((badge) => {
      const catalogBadge = userBadgeCatalog.get(badge.id)
      if (catalogBadge) {
        return {
          ...badge,
          imageUrl: badge.imageUrl ?? catalogBadge.imageUrl,
          description: badge.description ?? catalogBadge.description,
        }
      }
      return badge
    })

    // Only update ref if content actually changed (shallow compare)
    const prev = enrichedRetainedBadgesRef.current
    const changed =
      !prev ||
      prev.length !== newBadges.length ||
      newBadges.some(
        (b, i) =>
          prev[i]?.id !== b.id ||
          prev[i]?.imageUrl !== b.imageUrl ||
          prev[i]?.description !== b.description,
      )

    if (changed) {
      enrichedRetainedBadgesRef.current = newBadges
    }
    return enrichedRetainedBadgesRef.current
  }, [retainedBadges, userBadgeCatalog])

  // retainedBadges now contains badges from current channel + home (global)
  // Merge: enrichedRetainedBadges (all badges from current channel + global) + target.badges (fallback) + active cosmetics.
  // The 7TV inventory is user-card-only and is rendered in the profile tab, not next to the name.
  const extraBadgesRef = useRef<ReturnType<typeof mergeBadges> | undefined>(undefined)

  // Update extraBadgesRef when dependencies change - use useEffect for side effects
  useEffect(() => {
    const merged = mergeBadges(
      enrichedRetainedBadges ?? [],
      target.badges,
      profileState.badgesEnabled ? profileState.cosmetics?.badges : undefined,
    )

    // Only update ref if content actually changed
    const prev = extraBadgesRef.current
    const changed =
      !prev || prev.length !== merged.length || merged.some((b, i) => prev[i]?.id !== b.id)

    if (changed) {
      extraBadgesRef.current = merged
    }
  }, [
    enrichedRetainedBadges,
    target.badges,
    profileState.badgesEnabled,
    profileState.cosmetics?.badges,
  ])
  const channelUrl = target.username
    ? publicChannelURL(target.platform, target.username)
    : undefined

  const moderationPlatform: ModerationPlatform | undefined =
    target.platform === 'twitch' || target.platform === 'kick' ? target.platform : undefined

  const metadata = useUserCardMetadata({ target, moderationPlatform })
  const {
    isOpening: openingPublicChannel,
    openError: publicChannelError,
    openPublicChannel,
  } = useUserCardPublicChannel({ channelUrl })

  useEffect(() => {
    if (publicChannelError) showNotice('error', publicChannelError)
  }, [publicChannelError])

  const [tab, setTab] = useState<UserCardTab>('profile')

  const reloadMetadataAsync = metadata.reloadMetadata
  const reloadMetadata = useCallback(() => runUiTask(reloadMetadataAsync()), [reloadMetadataAsync])

  const metadataItemsRef = useRef<MetadataItem[]>([])

  const metadataItems = useMemo<MetadataItem[]>(() => {
    const newItems: MetadataItem[] = metadata.metadata
      ? [
          {
            label: t('userCard.metadata.accountAge'),
            value: accountAgeText(metadata.metadata),
            icon: 'calendar' satisfies IconName,
          },
          {
            label: t('userCard.metadata.followAge'),
            value: followAgeText(metadata.metadata),
            icon: 'users' satisfies IconName,
          },
          {
            label: t('userCard.metadata.subscriptionDuration'),
            value: subscriptionDurationText(metadata.metadata),
            icon: 'gift' satisfies IconName,
          },
          {
            label: t('userCard.metadata.subAge'),
            value: subAgeText(metadata.metadata),
            icon: 'clock' satisfies IconName,
          },
        ]
      : []

    // Only update ref if content actually changed
    const prev = metadataItemsRef.current
    const changed =
      !prev ||
      prev.length !== newItems.length ||
      newItems.some((item, i) => prev[i]?.label !== item.label || prev[i]?.value !== item.value)

    if (changed) {
      metadataItemsRef.current = newItems
    }
    return metadataItemsRef.current
  }, [metadata.metadata, t])

  const popupContextId = usePopupHotkeys('user-card', {
    delete: onClose,
    pin: togglePin,
    openProfilePictureMenu: !hideAvatar && avatarUrl ? openPicture : null,
    scrollPage:
      tab === 'history'
        ? ([direction]) => {
            if (direction) scrollPopupPage(renderer, historyViewport, direction)
          }
        : null,
    execModeratorAction: moderation.available
      ? ([argument]) => {
          setTab('actions')
          if (argument) return moderation.exec(argument)
        }
      : null,
  })

  const header = useMemo(
    () => (
      <UserCardHeader
        target={{
          platform: target.platform,
          platformUserId: target.platformUserId,
          displayName: target.displayName,
          username: target.username,
          avatarUrl,
          badges: target.badges,
        }}
        extraBadges={extraBadgesRef.current}
        hideAvatar={hideAvatar}
        channelUrl={channelUrl}
        openingPublicChannel={openingPublicChannel}
        openPublicChannel={() => runUiTask(openPublicChannel())}
        onAvatarClick={openPictureRef.current}
        effectiveAlias={effectiveAlias}
        accent={headerAccent}
      />
    ),
    [
      extraBadgesRef,
      target.platform,
      target.platformUserId,
      target.displayName,
      target.username,
      avatarUrl,
      target.badges,
      hideAvatar,
      channelUrl,
      openingPublicChannel,
      openPublicChannel,
      openPictureRef,
      effectiveAlias,
      headerAccent,
    ],
  )

  return (
    <Modal
      hotkeyContextId={popupContextId}
      width={800}
      onClose={onClose}
      embedded={standalone}
      closeOnOutsideClick={!pinned}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minHeight: 0,
        }}
      >
        {scrollHeaderRef.current ? null : header}

        <div
          tabIndex={-1}
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            minHeight: 0,
            overflowY: 'scroll',
            scrollbarColor: theme.scrollbar,
            scrollbarWidth: 1,
          }}
        >
          {scrollHeaderRef.current ? header : null}
          <div
            style={{
              paddingLeft: 16,
              paddingRight: 16,
              paddingBottom: 16,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <UserCardTabs tab={tab} setTab={setTab} />

            {/* Profile tab - always rendered, visibility controlled by CSS */}
            <div
              style={{
                display: tab === 'profile' ? 'flex' : 'none',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <UserCardProfileTab
                key={`${target.platform}:${target.platformUserId}`}
                target={target}
                hideAvatar={hideAvatar}
                profileState={profileState}
                supportedByCard={metadata.supportedByCard}
                metadataLoading={metadata.metadataLoading}
                metadataError={metadata.metadataError}
                metadata={metadataItems}
                reloadMetadata={reloadMetadata}
              />
            </div>

            {tab === 'actions' ? (
              <UserCardActions
                key={`${target.platform}:${target.platformUserId}`}
                target={target}
                moderation={moderation}
                avatarUrl={avatarUrl}
                hideAvatar={hideAvatar}
              />
            ) : null}
            {tab === 'notes' ? (
              <UserNotes
                key={`${target.platform}:${target.platformUserId}`}
                target={target}
                onClose={onClose}
              />
            ) : null}
            {tab === 'history' ? (
              <UserChatHistoryPanel
                onViewport={(viewport) => {
                  historyViewport.current = viewport
                }}
                platform={target.platform}
                platformUserId={target.platformUserId}
                channelId={
                  target.platform === 'youtube'
                    ? target.channelId
                    : (target.channelSlug ?? target.channelId)
                }
                username={target.username}
              />
            ) : null}
          </div>
        </div>
      </div>
      {avatarMenuOpen && !hideAvatar && avatarUrl ? (
        <ProfilePictureMenu url={avatarUrl} onClose={() => setAvatarMenuOpen(false)} />
      ) : null}
    </Modal>
  )
})
