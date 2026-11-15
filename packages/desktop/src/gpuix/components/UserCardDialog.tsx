import type { ModerationPlatform } from '@gpuix/backend/api'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { usePopupHotkeys, scrollPopupPage } from '@gpuix/hooks/use-popup-hotkeys'
import { useT } from '@gpuix/i18n'
import { useGpuixRequired, motion, type PublicInstance } from '@gpuix/react'
import { showNotice, homeMessagesStore, watchedMessagesStore } from '@gpuix/state/app'
import { useStore } from '@gpuix/state/create-store'
import { useDesktopWindows } from '@gpuix/state/desktop-windows'
import { useTextInputFocusTracking } from '@gpuix/state/focus'
import { streamerModeStore } from '@gpuix/state/streamer-mode'
import { useTheme } from '@gpuix/theme-context'
import { logger } from '@twirchat/shared/logger'
import type { Badge, NormalizedChatMessage } from '@twirchat/shared/types'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { publicChannelURL } from '@views/main/utils/public-channel-url'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
} from './user-card-dialog'
import { ProfilePictureMenu } from './user-card-dialog/ProfilePictureMenu'
import { UserCardActions, useUserCardModeration } from './user-card-dialog/UserCardActions'
import { UserChatHistoryPanel } from './user-card-dialog/UserChatHistoryPanel'
import { UserNotes } from './user-card-dialog/UserNotes'
import { collectUserBadges, mergeBadges } from './user-card-dialog/utils'
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
  const headerAccent = userCardHeaderAccent(
    profileState.profile?.color,
    target.color,
    profileState.cosmetics,
    profileState.paintsEnabled,
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

  const openPicture = () => {
    if (!hideAvatar && avatarUrl) {
      renderer.blur?.()
      setAvatarMenuOpen(true)
    }
  }
  useEffect(() => {
    if (hideAvatar) setAvatarMenuOpen(false)
  }, [hideAvatar])

  const [openingWindow, setOpeningWindow] = useState(false)
  const openInWindow = async () => {
    if (!windows) return
    setOpeningWindow(true)
    try {
      await windows.openUser(target)
      onClose()
    } catch (e) {
      console.log(e)
    } finally {
      setOpeningWindow(false)
    }
  }

  const effectiveAlias = currentAlias ?? target.currentAlias
  /**
   * Twitch only reports chat badges with messages, so collect every badge the
   * user displayed in the retained buffers. This also fills in platform badges
   * when the card is opened from chatters, search, or history.
   */
  const retainedBadges = useMemo(() => {
    const newestFirst: NormalizedChatMessage[] = []
    // Collect from current channel's messages (if available) for channel-specific badges
    const currentChannelMessages = target.channelId
      ? (watchedMessagesStore.get().get(target.channelId) ?? [])
      : []
    for (let index = currentChannelMessages.length - 1; index >= 0; index -= 1) {
      const message = currentChannelMessages[index]
      if (message) newestFirst.push(message)
    }
    // Also include home messages for global badges
    const home = homeMessagesStore.get()
    for (let index = home.length - 1; index >= 0; index -= 1) {
      const message = home[index]
      if (message) newestFirst.push(message)
    }
    return collectUserBadges(newestFirst, target.platform, target.platformUserId)
  }, [target.platform, target.platformUserId, target.channelId])

  // Fetch Twitch user badge catalog from backend (global + role badges)
  // Used as a lookup to enrich retainedBadges with imageUrl/description
  const [userBadgeCatalog, setUserBadgeCatalog] = useState<Map<string, Badge>>(new Map())
  useEffect(() => {
    if (target.platform !== 'twitch' || !target.username) return
    let cancelled = false
    const url = new URL(`${getBackendUrl()}/api/twitch/user-badges`)
    url.searchParams.set('broadcasterLogin', target.username)
    fetch(url.toString())
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
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
        }
      })
      .catch((err) => {
        log.warn('Failed to fetch user badge catalog', { error: String(err) })
      })
    return () => {
      cancelled = true
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

  // retainedBadges now contains badges from current channel + home (global)
  // Merge: enrichedRetainedBadges (all badges from current channel + global) + target.badges (fallback) + cosmetics
  const extraBadges = mergeBadges(
    enrichedRetainedBadges,
    target.badges,
    profileState.badgesEnabled ? profileState.cosmetics?.badges : undefined,
    profileState.badgesEnabled ? profileState.cosmetics?.inventoryBadges : undefined,
  )
  const channelUrl = target.username
    ? publicChannelURL(target.platform, target.username)
    : undefined

  const moderationPlatform: ModerationPlatform | undefined =
    target.platform === 'twitch' || target.platform === 'kick' ? target.platform : undefined

  const alias = useUserCardAlias({ target, currentAlias, onClose })
  const metadata = useUserCardMetadata({ target, moderationPlatform })
  const publicChannel = useUserCardPublicChannel({ channelUrl })

  const [tab, setTab] = useState<UserCardTab>('profile')

  const metadataItems: MetadataItem[] = metadata.metadata
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
    : []

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
        {/* Keep the header out of the scroll area so long tab content never hides it. */}
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
          openWindow={() => runUiTask(openInWindow())}
          hideAvatar={hideAvatar}
          channelUrl={channelUrl}
          openingPublicChannel={publicChannel.isOpening}
          openPublicChannel={() => runUiTask(publicChannel.openPublicChannel())}
          onAvatarClick={openPicture}
          effectiveAlias={effectiveAlias}
          accent={headerAccent}
        />

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
              publicChannelError={publicChannel.openError}
              openPublicChannel={() => runUiTask(publicChannel.openPublicChannel())}
            />

            <UserCardTabs tab={tab} setTab={setTab} />

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
                />
              ) : null}
              {tab === 'notes' ? (
                <UserNotes key={`${target.platform}:${target.platformUserId}`} target={target} />
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
                  reloadMetadata={() => runUiTask(metadata.reloadMetadata())}
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
            </motion.div>
          </div>
        </div>
      </div>
      {avatarMenuOpen && !hideAvatar && avatarUrl ? (
        <ProfilePictureMenu url={avatarUrl} onClose={() => setAvatarMenuOpen(false)} />
      ) : null}
    </Modal>
  )
}
