import type { ModerationPlatform } from '@gpuix/backend/api'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { usePopupHotkeys, scrollPopupPage } from '@gpuix/hooks/use-popup-hotkeys'
import { useT } from '@gpuix/i18n'
import { useGpuixRequired, motion, type PublicInstance } from '@gpuix/react'
import { showNotice } from '@gpuix/state/app'
import { useStore } from '@gpuix/state/create-store'
import { useDesktopWindows } from '@gpuix/state/desktop-windows'
import { useTextInputFocusTracking } from '@gpuix/state/focus'
import { streamerModeStore } from '@gpuix/state/streamer-mode'
import { useTheme } from '@gpuix/theme-context'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { publicChannelURL } from '@views/main/utils/public-channel-url'
import { useCallback, useEffect, useRef, useState } from 'react'

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
import {
  accountAgeText,
  followAgeText,
  subAgeText,
  subscriptionDurationText,
} from './user-card/format'

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

  const effectiveAlias = currentAlias ?? target.currentAlias
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
            avatarUrl: target.avatarUrl,
            badges: target.badges,
          }}
          hideAvatar={hideAvatar}
          channelUrl={channelUrl}
          openingPublicChannel={publicChannel.isOpening}
          openPublicChannel={() => void publicChannel.openPublicChannel()}
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