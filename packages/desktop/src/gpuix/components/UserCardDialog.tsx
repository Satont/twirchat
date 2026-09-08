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

import { useCallback, useEffect, useRef, useState } from 'react'
import type { UserCardMetadataResponse } from '@twirchat/shared/protocol'
import type { UserCardTarget } from '../../views/main/utils/chatCommands'
import { publicChannelURL } from '../../views/main/utils/public-channel-url'
import { platformColor } from '../theme'
import { useTheme } from '../theme-context'
import { useBackend } from '../backend/context'
import type { ModerationPlatform } from '../backend/api'
import { aliasesStore, applyModerationOutcome, showNotice } from '../state/app'
import { Text } from './ui/Text'
import { RemoteImage } from './ui/RemoteImage'
import { Modal } from './ui/Modal'
import { PlatformIcon } from './ui/Icon'
import { UserChatHistoryPanel } from './user-card/UserChatHistoryPanel'
import {
  accountAgeText,
  errorText,
  followAgeText,
  hexMix,
  subAgeText,
  subscriptionDurationText,
} from './user-card/format'

type UserModerationAction = 'timeout' | 'ban'

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

export function UserCardDialog({
  target,
  currentAlias,
  onClose,
}: {
  target: UserCardTarget
  currentAlias?: string
  onClose: () => void
}) {
  const theme = useTheme()
  const backend = useBackend()

  const effectiveAlias = currentAlias ?? target.currentAlias
  const titleHandle = target.username ?? target.platformUserId
  const channelUrl = target.username
    ? publicChannelURL(target.platform, target.username)
    : undefined

  // ── Alias ───────────────────────────────────────────────────────────────

  const [aliasValue, setAliasValue] = useState(effectiveAlias ?? '')
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

  const [moderationChecking, setModerationChecking] = useState(false)
  const [moderationAllowed, setModerationAllowed] = useState<boolean | null>(null)
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)
  const [moderationAction, setModerationAction] = useState<UserModerationAction | null>(null)
  const [moderationFeedback, setModerationFeedback] = useState<{
    kind: 'error' | 'success'
    text: string
  } | null>(null)

  const moderationInputError = ((): string | undefined => {
    if (!moderationPlatform) return 'Moderation is available for Twitch and Kick only.'
    if (!target.channelSlug) return 'No channel context is available for this user.'
    if (!target.messageId) return 'Open this card from a chat message to moderate this user.'
    return undefined
  })()

  const moderationDisabledReason =
    moderationInputError ??
    (moderationChecking ? 'Checking moderation permissions…' : undefined) ??
    capabilitiesError ??
    (moderationAllowed === false
      ? 'You do not have moderation permission in this channel.'
      : undefined)

  useEffect(() => {
    setModerationAllowed(null)
    setCapabilitiesError(null)
    setModerationFeedback(null)

    const platform = moderationPlatform
    const channelSlug = target.channelSlug
    if (!platform || !channelSlug || !target.messageId) return

    let cancelled = false
    setModerationChecking(true)
    backend.api
      .getModerationCapabilities({ channelSlug, platform })
      .then((capabilities) => {
        if (!cancelled) setModerationAllowed(capabilities.canModerate)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setModerationAllowed(false)
        setCapabilitiesError(errorText(cause))
      })
      .finally(() => {
        if (!cancelled) setModerationChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [backend, moderationPlatform, target.channelSlug, target.messageId])

  async function moderateUser(action: UserModerationAction): Promise<void> {
    const platform = moderationPlatform
    const channelSlug = target.channelSlug
    const messageId = target.messageId
    if (!platform || !channelSlug || !messageId || moderationDisabledReason) return

    setModerationAction(action)
    setModerationFeedback(null)
    try {
      await backend.api.moderateMessage({
        action,
        channelSlug,
        messageId,
        platform,
        targetUserId: target.platformUserId,
        ...(action === 'timeout' ? { durationSeconds: 600 } : {}),
      })
      applyModerationOutcome({
        action,
        channelId: target.channelId ?? channelSlug,
        platform,
        targetUserId: target.platformUserId,
        ...(action === 'timeout' ? { durationSeconds: 600 } : {}),
      })
      const text = action === 'timeout' ? 'Timed out for 10 minutes.' : 'User banned.'
      setModerationFeedback({ kind: 'success', text })
      showNotice('success', text)
    } catch (cause) {
      const text = errorText(cause)
      setModerationFeedback({ kind: 'error', text })
      showNotice('error', text)
    } finally {
      setModerationAction(null)
    }
  }

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
    if (supportedByCard) void reloadMetadata()
  }, [reloadMetadata, supportedByCard])

  // ── Render ──────────────────────────────────────────────────────────────

  const moderationButtonsDisabled = Boolean(moderationDisabledReason) || moderationAction !== null

  const metadataItems: Array<{ label: string; value: string | null }> = metadata
    ? [
        { label: 'Account age', value: accountAgeText(metadata) },
        { label: 'Follow age', value: followAgeText(metadata) },
        { label: 'Subscription duration', value: subscriptionDurationText(metadata) },
        { label: 'Sub age', value: subAgeText(metadata) },
      ]
    : []

  return (
    <Modal width={760} onClose={onClose}>
      <div
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'escape') onClose()
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'scroll',
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
                { color: hexMix(platformColor(target.platform), '#101012', 0.72), position: 0 },
                { color: '#1a1a22', position: 1 },
              ],
            },
            borderBottomWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ flexShrink: 0 }}>
            {target.avatarUrl ? (
              <RemoteImage
                url={target.avatarUrl}
                objectFit="cover"
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 18,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 18,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontWeight: 800, fontSize: 24, color: '#ffffff' }}>
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
              <PlatformIcon
                platform={target.platform}
                size={18}
                color="rgba(255, 255, 255, 0.95)"
              />
            </div>
            <Text style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.75)' }}>{titleHandle}</Text>
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
                onSubmit={() => void handleSaveAlias()}
                onKeyDown={(event) => {
                  if (event.key === 'escape') onClose()
                }}
                theme={{ caret: '#a78bfa' }}
                style={{
                  flexGrow: 1,
                  minWidth: 0,
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 12,
                  paddingRight: 12,
                  backgroundColor: '#1e1e24',
                  borderWidth: 1,
                  borderColor: '#3a3a45',
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
              <GhostButton onClick={onClose}>Close</GhostButton>
              {effectiveAlias ? (
                <DangerButton onClick={() => void handleRemoveAlias()}>Remove alias</DangerButton>
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
                <Text style={{ fontSize: 12, color: '#fca5a5' }}>{publicChannelError}</Text>
                <InlineButton onClick={() => void openPublicChannel()}>Retry</InlineButton>
              </div>
            ) : null}
          </div>

          {/* Moderation section */}
          <div style={{ marginBottom: 18 }}>
            <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>Moderation</Text>
            <Text style={{ fontSize: 13, color: theme.text2 }}>
              Actions apply to this user in the message channel.
            </Text>
            {moderationDisabledReason ? (
              <Text style={{ fontSize: 12, color: theme.text2, marginTop: 10 }}>
                {moderationDisabledReason}
              </Text>
            ) : null}
            {moderationFeedback ? (
              <Text
                style={{
                  fontSize: 12,
                  color: moderationFeedback.kind === 'error' ? '#fca5a5' : '#86efac',
                  marginTop: 10,
                }}
              >
                {moderationFeedback.text}
              </Text>
            ) : null}
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                gap: 10,
                marginTop: 12,
              }}
            >
              <div
                onClick={moderationButtonsDisabled ? undefined : () => void moderateUser('timeout')}
                style={{
                  backgroundColor: 'rgba(251, 191, 36, 0.16)',
                  borderRadius: 4,
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 14,
                  paddingRight: 14,
                  cursor: moderationButtonsDisabled ? 'default' : 'pointer',
                  opacity: moderationButtonsDisabled ? 0.48 : 1,
                  hover: moderationButtonsDisabled
                    ? {}
                    : { backgroundColor: 'rgba(251, 191, 36, 0.24)' },
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: 500, color: '#fde68a' }}>
                  {moderationAction === 'timeout' ? 'Timing out…' : 'Timeout 10m'}
                </Text>
              </div>
              <DangerButton
                disabled={moderationButtonsDisabled}
                onClick={() => void moderateUser('ban')}
              >
                {moderationAction === 'ban' ? 'Banning…' : 'Ban'}
              </DangerButton>
            </div>
          </div>

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
                <Text style={{ fontSize: 13, color: '#fca5a5' }}>{metadataError}</Text>
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
                      borderColor: 'rgba(255, 255, 255, 0.06)',
                      borderRadius: 10,
                      backgroundColor: 'rgba(0, 0, 0, 0.16)',
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

          <UserChatHistoryPanel platform={target.platform} platformUserId={target.platformUserId} />
        </div>
      </div>
    </Modal>
  )
}

// ── Local styled bits ───────────────────────────────────────────────────────

function HeaderPill({ accent, children }: { accent?: boolean; children: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        minHeight: 24,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 999,
        backgroundColor: accent ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.25)',
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: 700, color: '#ffffff' }}>{children}</Text>
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
        hover: disabled ? {} : { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>{children}</Text>
    </div>
  )
}

function DangerButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean
  onClick: () => void
  children: string
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        backgroundColor: 'rgba(255, 80, 80, 0.14)',
        borderRadius: 4,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 14,
        paddingRight: 14,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.48 : 1,
        hover: disabled ? {} : { backgroundColor: 'rgba(255, 80, 80, 0.2)' },
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: 500, color: '#ff9b9b' }}>{children}</Text>
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
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
        hover: disabled ? {} : { backgroundColor: 'rgba(255, 255, 255, 0.14)' },
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>{children}</Text>
    </div>
  )
}

function MetadataState({ error, children }: { error?: boolean; children: React.ReactNode }) {
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
        borderColor: 'rgba(255, 255, 255, 0.06)',
        borderRadius: 10,
        backgroundColor: 'rgba(0, 0, 0, 0.16)',
      }}
    >
      {children}
    </div>
  )
}
