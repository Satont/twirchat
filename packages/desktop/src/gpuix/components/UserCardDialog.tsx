import type { ModerationPlatform } from '@gpuix/backend/api'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { usePopupHotkeys, scrollPopupPage } from '@gpuix/hooks/use-popup-hotkeys'
import { useT } from '@gpuix/i18n'
import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { showNotice } from '@gpuix/state/app'
import { useStore } from '@gpuix/state/create-store'
import { useDesktopWindows } from '@gpuix/state/desktop-windows'
import { useTextInputFocusTracking } from '@gpuix/state/focus'
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
  UserCardAliasSection,
  UserCardTabs,
  UserCardProfileTab,
  userCardHeaderAccent,
  useUserCardAlias,
  useUserCardMetadata,
  useUserCardProfile,
  useUserCardPublicChannel,
  useRetainedBadges,
} from './user-card-dialog'
import { ProfilePictureMenu } from './user-card-dialog/ProfilePictureMenu'
import { UserCardActions, useUserCardModeration } from './user-card-dialog/UserCardActions'
import { UserChatHistoryPanel } from './user-card-dialog/UserChatHistoryPanel'
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

  // Initialize scrollHeaderRef once on mount - avoids useWindowSize re-renders on every resize
  useEffect(() => {
    const update = () => {
      scrollHeaderRef.current = typeof window !== 'undefined' && window.innerHeight < 500
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

  const [aliasFocused, setAliasFocused] = useState(false)
  const aliasFocus = useTextInputFocusTracking(setAliasFocused)

  // Track mounted state to avoid state updates after unmount
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const effectiveAlias = currentAlias ?? target.currentAlias
  const [openingWindow, setOpeningWindow] = useState(false)

  // Initialize refs before callbacks that use them
  const openPictureRef = useRef<() => void>(() => {})
  const openInWindowRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const openPicture = useCallback(() => {
    if (!hideAvatar && avatarUrl) {
      renderer.blur?.()
      setAvatarMenuOpen(true)
    }
  }, [hideAvatar, avatarUrl, renderer])
  useEffect(() => {
    if (hideAvatar) setAvatarMenuOpen(false)
  }, [hideAvatar])

  const openInWindow = useCallback(async () => {
    if (!windows) return
    setOpeningWindow(true)
    try {
      await windows.openUser({ ...target, currentAlias: effectiveAlias })
      if (mountedRef.current) onClose()
    } finally {
      if (mountedRef.current) setOpeningWindow(false)
    }
  }, [windows, target, effectiveAlias, onClose])

  openPictureRef.current = openPicture
  openInWindowRef.current = openInWindow

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
        const catalog = new Map<string, Badge>()
        for (const [key, imageUrl] of Object.entries(data.badges ?? {})) {
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
  const extraBadges = useMemo(
    () =>
      mergeBadges(
        enrichedRetainedBadges ?? [],
        target.badges,
        profileState.badgesEnabled ? profileState.cosmetics?.badges : undefined,
      ),
    [
      enrichedRetainedBadges,
      target.badges,
      profileState.badgesEnabled,
      profileState.cosmetics?.badges,
    ],
  )
  const channelUrl = target.username
    ? publicChannelURL(target.platform, target.username)
    : undefined

  const moderationPlatform: ModerationPlatform | undefined =
    target.platform === 'twitch' || target.platform === 'kick' ? target.platform : undefined

  const alias = useUserCardAlias({ target, currentAlias, onClose })
  const metadata = useUserCardMetadata({ target, moderationPlatform })
  const {
    isOpening: openingPublicChannel,
    openError: publicChannelError,
    openPublicChannel,
  } = useUserCardPublicChannel({ channelUrl })

  const [tab, setTab] = useState<UserCardTab>('profile')

  const reloadMetadataAsync = metadata.reloadMetadata
  const reloadMetadata = useCallback(() => runUiTask(reloadMetadataAsync()), [reloadMetadataAsync])

  const metadataItems = useMemo<MetadataItem[]>(
    () =>
      metadata.metadata
        ? [
            {
              label: t('userCard.metadata.accountAge'),
              value: accountAgeText(metadata.metadata),
              icon: 'calendar',
            },
            {
              label: t('userCard.metadata.followAge'),
              value: followAgeText(metadata.metadata),
              icon: 'users',
            },
            {
              label: t('userCard.metadata.subscriptionDuration'),
              value: subscriptionDurationText(metadata.metadata),
              icon: 'gift',
            },
            {
              label: t('userCard.metadata.subAge'),
              value: subAgeText(metadata.metadata),
              icon: 'clock',
            },
          ]
        : [],
    [metadata.metadata, t],
  )

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
        extraBadges={extraBadges}
        windows={windows}
        standalone={standalone}
        openingWindow={openingWindow}
        openWindow={() => runUiTask(openInWindowRef.current())}
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
      extraBadges,
      target.platform,
      target.platformUserId,
      target.displayName,
      target.username,
      avatarUrl,
      target.badges,
      windows,
      standalone,
      openingWindow,
      openInWindowRef,
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
            scrollbarWidth: 4,
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
            <UserCardAliasSection
              aliasValue={alias.aliasValue}
              setAliasValue={alias.setAliasValue}
              aliasFocused={aliasFocused}
              effectiveAlias={effectiveAlias}
              displayName={target.displayName}
              aliasFocus={aliasFocus}
              handleSaveAlias={alias.handleSaveAlias}
              handleRemoveAlias={alias.handleRemoveAlias}
              pinned={pinned}
              togglePin={togglePin}
              onClose={onClose}
              windows={windows}
              standalone={standalone}
              target={target}
              openingWindow={openingWindow}
              setOpeningWindow={setOpeningWindow}
              showNotice={showNotice}
              publicChannelError={publicChannelError}
              openPublicChannel={() => runUiTask(openPublicChannel())}
            />

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
              <UserNotes key={`${target.platform}:${target.platformUserId}`} target={target} />
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
