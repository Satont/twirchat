import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
/**
 * User card dialog — port of UserCardDialog.vue onto GPUIX.
 *
 * Header gradient, alias editing, moderation actions (timeout/ban), account
 * metadata cards and the stored chat history panel.
 *
 * GPUIX deviations:
 * - CSS color-mix() in the header gradient is precomputed via hexMix().
 * - Dialog width is a fixed 760px (Vue used 90vw capped at 760px).
 * - The "Alias: X" pill keeps its case (the Vue CSS uppercased it via
 *   text-transform, which GPUIX does not support).
 * - The alias input has no 50-char maxlength (GPUIX inputs don't expose one).
 * - Esc closes via a focusable wrapper + input key handlers; reka-ui's global
 *   dialog Escape handling does not exist here.
 */
import type { UserCardMetadataResponse } from '@twirchat/shared/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { UserCardTarget } from '../../views/main/utils/chatCommands'
import { publicChannelURL } from '../../views/main/utils/public-channel-url'
import { initialsOf } from '../../views/shared/utils/display-text'
import type { ModerationPlatform } from '../backend/api'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { usePopupHotkeys, scrollPopupPage } from '../hooks/use-popup-hotkeys'
import { aliasesStore, showNotice } from '../state/app'
import { useStore } from '../state/create-store'
import { useDesktopWindows } from '../state/desktop-windows'
import { useTextInputFocusTracking } from '../state/focus'
import { streamerModeStore } from '../state/streamer-mode'
import { platformColor } from '../theme'
import { useTheme } from '../theme-context'
import { ActionButton } from './ui/Form'
import { PlatformIcon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'
import {
  accountAgeText,
  errorText,
  followAgeText,
  hexMix,
  subAgeText,
  subscriptionDurationText,
} from './user-card/format'
import { ProfilePictureMenu } from './user-card/ProfilePictureMenu'
import { UserCardActions, useUserCardModeration } from './user-card/UserCardActions'
import { UserChatHistoryPanel } from './user-card/UserChatHistoryPanel'
import { UserNotes } from './user-card/UserNotes'
import { UserProfile } from './user-card/UserProfile'

function initials(name: string): string {
  return initialsOf(name, 2)
}

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
  const backend = useBackend()
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
  const titleHandle = target.username ?? target.platformUserId
  const channelUrl = target.username
    ? publicChannelURL(target.platform, target.username)
    : undefined

  // ── Alias ───────────────────────────────────────────────────────────────

  const [aliasValue, setAliasValue] = useState(effectiveAlias ?? '')
  const aliasFocus = useTextInputFocusTracking()
  useEffect(() => {
    setAliasValue(effectiveAlias ?? '')
  }, [effectiveAlias, target.platform, target.platformUserId])

  async function refreshAliases(): Promise<void> {
    aliasesStore.set(await backend.api.getUserAliases())
  }

  async function handleSaveAlias(): Promise<void> {
    const value = aliasValue.trim()
    try {
      if (!value) {
        await backend.api.removeUserAlias({
          platform: target.platform,
          platformUserId: target.platformUserId,
        })
      } else {
        await backend.api.setUserAlias({
          platform: target.platform,
          platformUserId: target.platformUserId,
          alias: value,
        })
      }
      await refreshAliases()
    } catch (cause) {
      showNotice('error', errorText(cause))
      return
    }
    onClose()
  }

  async function handleRemoveAlias(): Promise<void> {
    try {
      await backend.api.removeUserAlias({
        platform: target.platform,
        platformUserId: target.platformUserId,
      })
      await refreshAliases()
    } catch (cause) {
      showNotice('error', errorText(cause))
      return
    }
    setAliasValue('')
    onClose()
  }

  // ── Open public channel ─────────────────────────────────────────────────

  const [openingPublicChannel, setOpeningPublicChannel] = useState(false)
  const [publicChannelError, setPublicChannelError] = useState<string | null>(null)

  async function openPublicChannel(): Promise<void> {
    if (!channelUrl) return
    setOpeningPublicChannel(true)
    setPublicChannelError(null)
    try {
      await backend.api.openExternalUrl({ url: channelUrl })
    } catch (cause) {
      setPublicChannelError(errorText(cause))
    } finally {
      setOpeningPublicChannel(false)
    }
  }

  // ── Moderation ──────────────────────────────────────────────────────────

  const moderationPlatform: ModerationPlatform | undefined =
    target.platform === 'twitch' || target.platform === 'kick' ? target.platform : undefined

  // ── Account metadata (port of useUserCardMetadata) ──────────────────────

  const supportedByCard = moderationPlatform !== undefined
  const [metadata, setMetadata] = useState<UserCardMetadataResponse | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const metadataGenerationRef = useRef(0)

  const reloadMetadata = useCallback(async (): Promise<void> => {
    const platform = moderationPlatform
    if (!platform) {
      setMetadata(null)
      setMetadataError(null)
      setMetadataLoading(false)
      return
    }

    const generation = metadataGenerationRef.current + 1
    metadataGenerationRef.current = generation
    setMetadataLoading(true)
    setMetadataError(null)

    try {
      const response = await backend.api.getUserCardMetadata({
        platform,
        platformUserId: target.platformUserId,
        username: target.username,
        channelId: target.channelId,
        channelSlug: target.channelSlug,
      })
      if (generation !== metadataGenerationRef.current) return
      setMetadata(response)
    } catch (loadError) {
      if (generation !== metadataGenerationRef.current) return
      setMetadata(null)
      setMetadataError(errorText(loadError))
    } finally {
      if (generation === metadataGenerationRef.current) {
        setMetadataLoading(false)
      }
    }
  }, [
    backend,
    moderationPlatform,
    target.platformUserId,
    target.username,
    target.channelId,
    target.channelSlug,
  ])

  // Reset + load on mount / when the target changes (reloadMetadata identity
  // tracks exactly those fields).
  useEffect(() => {
    metadataGenerationRef.current += 1
    setMetadata(null)
    setMetadataError(null)
    setMetadataLoading(false)
    if (supportedByCard) runUiTask(reloadMetadata())
  }, [reloadMetadata, supportedByCard])

  // ── Render ──────────────────────────────────────────────────────────────

  const [tab, setTab] = useState<'profile' | 'actions' | 'notes' | 'history'>('profile')

  const popupContextId = usePopupHotkeys('user-card', {
    delete: onClose,
    pin: togglePin,
    openProfilePictureMenu: !hideAvatar && avatarUrl ? openPicture : null,
    scrollPage:
      tab === 'history'
        ? ([direction]) => scrollPopupPage(renderer, historyViewport, direction!)
        : null,
    execModeratorAction: moderation.available
      ? ([argument]) => {
          setTab('actions')
          return moderation.exec(argument!)
        }
      : null,
  })

  const metadataItems: Array<{ label: string; value: string | null }> = metadata
    ? [
        { label: 'Account age', value: accountAgeText(metadata) },
        { label: 'Follow age', value: followAgeText(metadata) },
        { label: 'Subscription duration', value: subscriptionDurationText(metadata) },
        { label: 'Sub age', value: subAgeText(metadata) },
      ]
    : []

  return (
    <Modal
      hotkeyContextId={popupContextId}
      width={760}
      onClose={onClose}
      embedded={standalone}
      closeOnOutsideClick={!pinned}
    >
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
        {/* Header (full-bleed: the Vue version used negative margins) */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 16,
            padding: 20,
            marginBottom: 18,
            background: {
              type: 'linear-gradient',
              angle: 135,
              stops: [
                {
                  color: theme.isLight
                    ? hexMix(platformColor(target.platform), theme.dialog, 0.22)
                    : hexMix(platformColor(target.platform), '#101012', 0.72),
                  position: 0,
                },
                { color: theme.dialog, position: 1 },
              ],
            },
            borderBottomWidth: 1,
            borderColor: theme.hairline,
          }}
        >
          <div
            testId="user-card-avatar"
            tabIndex={!hideAvatar && avatarUrl ? 0 : undefined}
            onClick={openPicture}
            onKeyDown={(event) => {
              if (event.key === 'enter' || event.key === 'space') {
                event.preventDefault()
                openPicture()
              }
            }}
            style={{
              flexShrink: 0,
              cursor: !hideAvatar && avatarUrl ? 'pointer' : 'default',
            }}
          >
            {!hideAvatar && avatarUrl ? (
              <RemoteImage
                url={avatarUrl}
                avatarSize={72}
                objectFit="cover"
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 18,
                  backgroundColor: theme.fill,
                }}
              />
            ) : (
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 18,
                  backgroundColor: theme.fill,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontWeight: 800, fontSize: 24, color: theme.text }}>
                  {initials(target.displayName)}
                </Text>
              </div>
            )}
          </div>

          <div
            style={{
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>
                {target.displayName}
              </Text>
              <PlatformIcon platform={target.platform} size={18} color={theme.text} />
            </div>
            <Text style={{ fontSize: 13, color: theme.text2 }}>{titleHandle}</Text>
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <HeaderPill>{target.platform.toUpperCase()}</HeaderPill>
              {effectiveAlias ? <HeaderPill accent>{`Alias: ${effectiveAlias}`}</HeaderPill> : null}
            </div>
          </div>
        </div>

        <div
          style={{
            paddingLeft: 20,
            paddingRight: 20,
            paddingBottom: 20,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Alias section */}
          <div style={{ marginBottom: 18 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: theme.text,
                marginBottom: 6,
              }}
            >
              {'Display alias'.toUpperCase()}
            </Text>
            <Text style={{ fontSize: 13, color: theme.text2 }}>
              Replaces the displayed name in chat. Leave empty to remove alias.
            </Text>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                gap: 10,
                alignItems: 'center',
                marginTop: 12,
              }}
            >
              <input
                autoFocus
                value={aliasValue}
                placeholder={target.displayName}
                onChange={(event) => setAliasValue(event.value ?? '')}
                {...aliasFocus}
                onSubmit={() => void handleSaveAlias()}
                onKeyDown={(event) => {
                  if (event.key === 'escape') onClose()
                }}
                theme={{ caret: theme.link }}
                style={{
                  flexGrow: 1,
                  minWidth: 0,
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 12,
                  paddingRight: 12,
                  backgroundColor: theme.surface2,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 4,
                  fontSize: 13,
                  color: theme.text,
                }}
              />
              <div
                onClick={() => void handleSaveAlias()}
                style={{
                  flexShrink: 0,
                  backgroundColor: '#9147ff',
                  borderRadius: 4,
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 14,
                  paddingRight: 14,
                  cursor: 'pointer',
                  hover: { opacity: 0.9 },
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: 500, color: '#ffffff' }}>Save</Text>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: 10,
                marginTop: 12,
              }}
            >
              {channelUrl ? (
                <GhostButton
                  disabled={openingPublicChannel}
                  onClick={() => void openPublicChannel()}
                >
                  {openingPublicChannel ? 'Opening…' : 'Open channel'}
                </GhostButton>
              ) : null}
              <ActionButton primary={pinned} onClick={togglePin}>
                {pinned ? 'Unpin card' : 'Pin card'}
              </ActionButton>
              <GhostButton onClick={onClose}>Close</GhostButton>
              {windows && !standalone ? (
                <GhostButton
                  disabled={openingWindow}
                  onClick={() => {
                    setOpeningWindow(true)
                    void windows
                      .openUser(target)
                      .then(onClose)
                      .catch((error) => {
                        setOpeningWindow(false)
                        showNotice('error', String(error))
                      })
                  }}
                >
                  {openingWindow ? 'Opening…' : 'Open in window'}
                </GhostButton>
              ) : null}
              {effectiveAlias ? (
                <ActionButton danger onClick={() => void handleRemoveAlias()}>
                  Remove alias
                </ActionButton>
              ) : null}
            </div>
            {publicChannelError ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.dangerText }}>{publicChannelError}</Text>
                <InlineButton onClick={() => void openPublicChannel()}>Retry</InlineButton>
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {(
              ['profile', 'actions', 'notes', 'history'] satisfies (
                | 'profile'
                | 'actions'
                | 'notes'
                | 'history'
              )[]
            ).map((name) => (
              <ActionButton key={name} primary={tab === name} onClick={() => setTab(name)}>
                {name === 'actions'
                  ? 'Actions & moderation'
                  : name[0]!.toUpperCase() + name.slice(1)}
              </ActionButton>
            ))}
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
          {tab === 'profile' ? (
            <>
              <UserProfile
                target={target}
                hideAvatar={hideAvatar}
                onAvatarChange={updateProfileAvatar}
              />
              {/* Account metadata section */}
              <div style={{ marginBottom: 18 }}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
                      Account metadata
                    </Text>
                    <Text style={{ fontSize: 13, color: theme.text2 }}>
                      Fetched through the backend for this platform.
                    </Text>
                  </div>

                  {supportedByCard ? (
                    <InlineButton disabled={metadataLoading} onClick={() => void reloadMetadata()}>
                      Refresh
                    </InlineButton>
                  ) : null}
                </div>

                {!supportedByCard ? (
                  <MetadataState>
                    <Text style={{ fontSize: 13, color: theme.text2 }}>
                      Metadata is not supported for this platform yet.
                    </Text>
                  </MetadataState>
                ) : metadataLoading ? (
                  <MetadataState>
                    <Text style={{ fontSize: 13, color: theme.text2 }}>Loading metadata…</Text>
                  </MetadataState>
                ) : metadataError ? (
                  <MetadataState error>
                    <Text style={{ fontSize: 13, color: theme.dangerText }}>{metadataError}</Text>
                    <InlineButton onClick={() => void reloadMetadata()}>Retry</InlineButton>
                  </MetadataState>
                ) : metadata ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    {metadataItems.map((item) => (
                      <div
                        key={item.label}
                        style={{
                          flexGrow: 1,
                          flexBasis: 150,
                          minWidth: 0,
                          padding: 12,
                          borderWidth: 1,
                          borderColor: theme.hairline,
                          borderRadius: 10,
                          backgroundColor: theme.fill,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: theme.text2,
                            marginBottom: 6,
                          }}
                        >
                          {item.label.toUpperCase()}
                        </Text>
                        <Text style={{ fontSize: 13, color: theme.text, lineHeight: 19 }}>
                          {item.value ?? ''}
                        </Text>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          {tab === 'history' ? (
            <UserChatHistoryPanel
              onViewport={(viewport) => {
                historyViewport.current = viewport
              }}
              platform={target.platform}
              platformUserId={target.platformUserId}
            />
          ) : null}
        </div>
      </div>
      {avatarMenuOpen && !hideAvatar && avatarUrl ? (
        <ProfilePictureMenu url={avatarUrl} onClose={() => setAvatarMenuOpen(false)} />
      ) : null}
    </Modal>
  )
}

// ── Local styled bits ───────────────────────────────────────────────────────

function HeaderPill({ accent, children }: { accent?: boolean; children: string }) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        minHeight: 24,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 999,
        backgroundColor: accent
          ? theme.fillHover
          : theme.isLight
            ? theme.fill
            : 'rgba(0, 0, 0, 0.25)',
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>{children}</Text>
    </div>
  )
}

function GhostButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean
  onClick: () => void
  children: string
}) {
  const theme = useTheme()
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        backgroundColor: 'transparent',
        borderRadius: 4,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 14,
        paddingRight: 14,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        hover: disabled ? {} : { backgroundColor: theme.fillHover },
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>{children}</Text>
    </div>
  )
}

function InlineButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean
  onClick: () => void
  children: string
}) {
  const theme = useTheme()
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        borderRadius: 6,
        backgroundColor: theme.fill,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
        hover: disabled ? {} : { backgroundColor: theme.fillHover },
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>{children}</Text>
    </div>
  )
}

function MetadataState({ error, children }: { error?: boolean; children: React.ReactNode }) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: error ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        minHeight: 96,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.hairline,
        borderRadius: 10,
        backgroundColor: theme.fill,
      }}
    >
      {children}
    </div>
  )
}
