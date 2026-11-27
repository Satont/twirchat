import type { ModerationPlatform } from '@gpuix/backend/api'
import type { UserAlias } from '@gpuix/backend/api'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { usePopupHotkeys, scrollPopupPage } from '@gpuix/hooks/use-popup-hotkeys'
import { useT } from '@gpuix/i18n'
import { useGpuixRequired, useWindowSize, motion, type PublicInstance } from '@gpuix/react'
import { aliasesStore } from '@gpuix/state/app'
import { useStore, useStoreSelector } from '@gpuix/state/create-store'
import { useDesktopWindows } from '@gpuix/state/desktop-windows'
import { streamerModeStore } from '@gpuix/state/streamer-mode'
import { useTheme } from '@gpuix/theme-context'
import { logger } from '@twirchat/shared/logger'
import type { Badge } from '@twirchat/shared/types'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { publicChannelURL } from '@views/main/utils/public-channel-url'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getBackendUrl } from '../../runtime-config'
import { ActionToastProvider } from './action-toast'
import { Modal } from './ui/Modal'
import type { MetadataItem, UserCardTab } from './user-card-dialog'
import {
  UserCardHeader,
  UserCardTabs,
  UserCardProfileTab,
  userCardHeaderAccent,
  useUserCardMetadata,
  useUserCardProfile,
  useUserCardPublicChannel,
  useRetainedBadges,
} from './user-card-dialog'
import { UserCardActions, useUserCardModeration } from './user-card-dialog/actions'
import { UserChatHistoryPanel } from './user-card-dialog/history-panel/UserChatHistoryPanel'
import { UserNotes } from './user-card-dialog/UserNotes'
import { mergeBadges } from './user-card-dialog/utils'
import {
  accountAgeText,
  followAgeText,
  subAgeText,
  subscriptionDurationText,
} from './user-card/format'

const log = logger('user-card')

export function UserCardDialog({
  target,
  currentAlias,
  onClose,
  onOpenWhispers,
  standalone = false,
}: {
  target: UserCardTarget
  currentAlias?: string
  onClose: () => void
  onOpenWhispers?: (target: UserCardTarget) => void
  standalone?: boolean
}) {
  const theme = useTheme()
  const { t } = useT()
  const windows = useDesktopWindows()
  const renderer = useGpuixRequired()
  const windowSize = useWindowSize()
  const streamer = useStore(streamerModeStore)
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
  const [localPinned, setLocalPinned] = useState(false)
  const nativeUserWindow = standalone && windows?.descriptor.kind === 'user'
  const pinned = nativeUserWindow ? windows.pinned : localPinned
  const togglePin = () => {
    if (nativeUserWindow) windows.setPinned(!pinned)
    else setLocalPinned(!pinned)
  }
  const historyViewport = useRef<PublicInstance | null>(null)
  const moderation = useUserCardModeration(target)

  // Get alias from store - this will update when alias is changed in Notes tab
  const storeAlias = useStoreSelector(aliasesStore, (store) => {
    const alias = store.find(
      (a: UserAlias) =>
        a.platform === target.platform && a.platformUserId === target.platformUserId,
    )
    return alias?.alias
  })
  const effectiveAlias = currentAlias ?? storeAlias ?? target.currentAlias

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

  // Enrich retainedBadges with catalog data (imageUrl, description)
  const enrichedRetainedBadges = useMemo(() => {
    return retainedBadges.map((badge) => {
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
  }, [retainedBadges, userBadgeCatalog])

  const extraBadges = useMemo(
    () =>
      mergeBadges(
        enrichedRetainedBadges,
        target.badges,
        profileState.badgesEnabled ? profileState.cosmetics?.badges : undefined,
        profileState.badgesEnabled ? profileState.cosmetics?.inventoryBadges : undefined,
      ),
    [
      enrichedRetainedBadges,
      target.badges,
      profileState.badgesEnabled,
      profileState.cosmetics?.badges,
      profileState.cosmetics?.inventoryBadges,
    ],
  )
  const channelUrl = target.username
    ? publicChannelURL(target.platform, target.username)
    : undefined

  const moderationPlatform: ModerationPlatform | undefined =
    target.platform === 'twitch' || target.platform === 'kick' ? target.platform : undefined

  const metadata = useUserCardMetadata({ target, moderationPlatform })
  const publicChannel = useUserCardPublicChannel({ channelUrl })

  const [tab, setTab] = useState<UserCardTab>('profile')

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
        hideAvatar={hideAvatar}
        bannerUrl={profileState.profile?.bannerUrl}
        channelUrl={channelUrl}
        openingPublicChannel={publicChannel.isOpening}
        openPublicChannel={() => runUiTask(publicChannel.openPublicChannel())}
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
      hideAvatar,
      profileState.profile?.bannerUrl,
      channelUrl,
      publicChannel,
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
        {windowSize.height < 500 ? null : header}

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
          {windowSize.height < 500 ? header : null}
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

            <ActionToastProvider>
              <motion.div
                key={tab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
              >
                {tab === 'actions' ? (
                  <UserCardActions
                    key={`${target.platform}:${target.platformUserId}`}
                    target={target}
                    moderation={moderation}
                    avatarUrl={avatarUrl}
                    hideAvatar={hideAvatar}
                    onOpenWhispers={onOpenWhispers}
                  />
                ) : null}
                {tab === 'notes' ? (
                  <UserNotes
                    key={`${target.platform}:${target.platformUserId}`}
                    target={target}
                    currentAlias={currentAlias}
                    onClose={onClose}
                  />
                ) : null}
                {tab === 'profile' ? (
                  <UserCardProfileTab
                    key={`${target.platform}:${target.platformUserId}`}
                    target={target}
                    hideAvatar={hideAvatar}
                    profileState={profileState}
                    supportedByCard={metadata.supportedByCard}
                    metadataLoading={metadata.metadataLoading}
                    metadataError={metadata.metadataError}
                    metadata={metadataItems}
                    reloadMetadata={metadata.reloadMetadata}
                  />
                ) : null}
                {tab === 'history' ? (
                  <UserChatHistoryPanel
                    onViewport={(viewport: PublicInstance | null) => {
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
              </motion.div>
            </ActionToastProvider>
          </div>
        </div>
      </div>
    </Modal>
  )
}
