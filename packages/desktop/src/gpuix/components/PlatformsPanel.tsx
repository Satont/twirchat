/**
 * Platforms panel — port of PlatformsPanel.vue: one card per platform with
 * account connect/disconnect, the channel join row and the stream editor
 * for authenticated Twitch/Kick accounts.
 *
 * Data flow differences from the Vue source:
 * - accounts/statuses come from accountsStore / channelStatusStore
 * - the `accounts-updated` emit becomes accountsStore.set(await getAccounts())
 * - Teleport toasts become the app-wide notice (showNotice), same texts
 * - the joined-channel list state is kept (loaded from the backend, updated
 *   on join) but, exactly like the Vue template, it is not rendered
 */

import { useEffect, useState } from 'react'
import type { Account, Platform, PlatformStatusInfo } from '@twirchat/shared/types'

import { useBackend, useBackendEvent } from '../backend/context'
import { useStore } from '../state/create-store'
import { accountsStore, channelStatusStore, showNotice } from '../state/app'
import { accent, platformColor, withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { applySavedChannels } from '../../views/main/utils/channel-connections'
import { PlatformIcon } from './ui/Icon'
import { Text } from './ui/Text'
import { RemoteImage } from './ui/RemoteImage'
import { StreamEditor } from './StreamEditor'

const platforms: Platform[] = ['twitch', 'youtube', 'kick']

function platformName(platform: Platform): string {
  return platform === 'twitch' ? 'Twitch' : platform === 'youtube' ? 'YouTube' : 'Kick'
}

function statusLabel(s?: PlatformStatusInfo): string {
  if (!s) return 'Not connected'
  switch (s.status) {
    case 'connected':
      return s.mode === 'authenticated' ? 'Connected' : 'Connected (anonymous)'
    case 'connecting':
      return 'Connecting…'
    case 'error':
      return s.error ?? 'Error'
    default:
      return 'Disconnected'
  }
}

function statusDotColor(s?: PlatformStatusInfo): string {
  if (!s) return '#4b5563'
  switch (s.status) {
    case 'connected':
      return '#22c55e'
    case 'connecting':
      return '#f59e0b'
    case 'error':
      return '#ef4444'
    default:
      return '#4b5563'
  }
}

/** Ghost "Disconnect" button — hover recolors the label, so it needs state. */
function DisconnectButton({ onClick }: { onClick: () => void }) {
  const theme = useTheme()
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: hovered ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255, 255, 255, 0.06)',
        borderWidth: 1,
        borderColor: hovered ? 'rgba(239, 68, 68, 0.3)' : theme.border,
        borderRadius: 8,
        paddingTop: 7,
        paddingBottom: 7,
        paddingLeft: 14,
        paddingRight: 14,
        cursor: 'pointer',
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: hovered ? '#ef4444' : theme.text2,
          whiteSpace: 'nowrap',
        }}
      >
        Disconnect
      </Text>
    </div>
  )
}

interface PlatformCardProps {
  platform: Platform
  account?: Account
  status?: PlatformStatusInfo
  channelInput: string
  joining: boolean
  authLoading: boolean
  inputFocused: boolean
  onInputChange: (value: string) => void
  onInputFocus: () => void
  onInputBlur: () => void
  onJoin: () => void
  onStartAuth: () => void
  onLogout: () => void
}

function PlatformCard({
  platform,
  account,
  status,
  channelInput,
  joining,
  authLoading,
  inputFocused,
  onInputChange,
  onInputFocus,
  onInputBlur,
  onJoin,
  onStartAuth,
  onLogout,
}: PlatformCardProps) {
  const theme = useTheme()
  const pColor = platformColor(platform)
  const joinDisabled = !channelInput.trim() || joining

  return (
    <div
      style={{
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 14,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingTop: 18,
          paddingBottom: 18,
          paddingLeft: 20,
          paddingRight: 20,
          borderBottomWidth: 1,
          borderColor: theme.border,
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 10,
            backgroundColor: pColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PlatformIcon
            platform={platform}
            size={20}
            color={platform === 'kick' ? '#000000' : '#ffffff'}
          />
        </div>

        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Text style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>
            {platformName(platform)}
          </Text>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                flexShrink: 0,
                backgroundColor: statusDotColor(status),
                boxShadow:
                  status?.status === 'connected'
                    ? {
                        offsetX: 0,
                        offsetY: 0,
                        blurRadius: 6,
                        spreadRadius: 0,
                        color: 'rgba(34, 197, 94, 0.6)',
                      }
                    : undefined,
              }}
            />
            <Text style={{ fontSize: 12, color: theme.text2 }}>{statusLabel(status)}</Text>
          </div>
        </div>

        {/* Auth actions */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
            minWidth: 160,
            justifyContent: 'flex-end',
          }}
        >
          {account ? (
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  borderWidth: 2,
                  borderColor: pColor,
                  overflow: 'hidden',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pColor,
                }}
              >
                {account.avatarUrl ? (
                  <RemoteImage
                    url={account.avatarUrl}
                    objectFit="cover"
                    style={{ width: '100%', height: '100%' }}
                  />
                ) : (
                  <Text style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
                    {account.displayName.charAt(0).toUpperCase()}
                  </Text>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: theme.text,
                    maxWidth: 110,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {account.displayName}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    color: theme.text2,
                    maxWidth: 110,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {`@${account.username}`}
                </Text>
              </div>
              <DisconnectButton onClick={onLogout} />
            </div>
          ) : (
            <div
              testId={`connect-${platform}`}
              onClick={authLoading ? undefined : onStartAuth}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: pColor,
                borderRadius: 8,
                paddingTop: 7,
                paddingBottom: 7,
                paddingLeft: 14,
                paddingRight: 14,
                cursor: authLoading ? 'not-allowed' : 'pointer',
                opacity: authLoading ? 0.45 : 1,
                whiteSpace: 'nowrap',
                hover: authLoading ? undefined : { opacity: 0.88 },
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: platform === 'kick' ? '#000000' : '#ffffff',
                  whiteSpace: 'nowrap',
                }}
              >
                {authLoading ? 'Opening…' : 'Connect account'}
              </Text>
            </div>
          )}
        </div>
      </div>

      {/* Channel join section */}
      <div
        style={{
          paddingTop: 14,
          paddingBottom: 14,
          paddingLeft: 20,
          paddingRight: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Input for Twitch, or for YouTube/Kick while not authenticated */}
        {platform === 'twitch' || !account ? (
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <div
              style={{
                flexGrow: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.surface2,
                borderWidth: 1,
                borderColor: inputFocused ? accent.primary : theme.border,
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <Text
                style={{
                  paddingLeft: 12,
                  paddingRight: 4,
                  fontSize: 14,
                  color: theme.text2,
                  userSelect: 'none',
                }}
              >
                #
              </Text>
              <input
                value={channelInput}
                placeholder={platform === 'youtube' ? 'Channel ID or handle' : 'channel name'}
                onChange={(event) => onInputChange(event.value ?? '')}
                onSubmit={onJoin}
                onFocus={onInputFocus}
                onBlur={onInputBlur}
                theme={{ caret: accent.primary, textMuted: withAlpha(theme.text2, 0.6) }}
                style={{
                  flexGrow: 1,
                  minWidth: 0,
                  fontSize: 14,
                  color: theme.text,
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 2,
                  paddingRight: 12,
                }}
              />
            </div>
            <div
              testId={`join-${platform}`}
              onClick={joinDisabled ? undefined : onJoin}
              style={{
                backgroundColor: accent.tint15,
                borderWidth: 1,
                borderColor: withAlpha(accent.primary, 0.3),
                borderRadius: 8,
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 18,
                paddingRight: 18,
                cursor: joinDisabled ? 'not-allowed' : 'pointer',
                opacity: joinDisabled ? 0.45 : 1,
                hover: joinDisabled ? undefined : { backgroundColor: accent.tint25 },
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: accent.primary,
                  whiteSpace: 'nowrap',
                }}
              >
                {joining ? '…' : 'Join'}
              </Text>
            </div>
          </div>
        ) : (
          /* Authenticated YouTube/Kick auto-join their own channel */
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingTop: 8,
              paddingBottom: 8,
            }}
          >
            <Text style={{ fontSize: 13, color: theme.text2 }}>Connected to your channel</Text>
          </div>
        )}
      </div>

      {/* Stream editor: shown for Twitch/Kick when account is connected */}
      {account && (platform === 'twitch' || platform === 'kick') ? (
        <StreamEditor platform={platform} channelId={account.platformUserId} />
      ) : null}
    </div>
  )
}

export function PlatformsPanel() {
  const backend = useBackend()
  const theme = useTheme()
  const accounts = useStore(accountsStore)
  const statuses = useStore(channelStatusStore)

  // Per-platform channel input state
  const [channelInputs, setChannelInputs] = useState<Record<string, string>>({
    kick: '',
    twitch: '',
    youtube: '',
  })
  const [joiningChannel, setJoiningChannel] = useState<Record<string, boolean>>({})
  const [authLoading, setAuthLoading] = useState<Record<string, boolean>>({})
  const [joinedChannels, setJoinedChannels] = useState<Record<string, string[]>>({
    kick: [],
    twitch: [],
    youtube: [],
  })
  const [focusedInput, setFocusedInput] = useState<Platform | null>(null)

  useBackendEvent('auth_success', ({ displayName }) => {
    void backend.api.getAccounts().then((updated) => accountsStore.set(updated))
    void backend.api.getChannels().then((saved) => {
      setJoinedChannels((current) => {
        const next = { ...current }
        applySavedChannels(next, saved)
        return next
      })
    })
    showNotice('success', `Connected as ${displayName}`, 4000)
  })
  useBackendEvent('auth_error', ({ error }) => {
    showNotice('error', error, 4000)
  })

  useEffect(() => {
    // Load persisted channels from the backend
    backend.api
      .getChannels()
      .then((saved) => {
        setJoinedChannels((current) => {
          const next = { ...current }
          applySavedChannels(next, saved)
          return next
        })
      })
      .catch((error) => {
        console.warn('[PlatformsPanel] Failed to load persisted channels:', error)
      })
  }, [backend])

  // ── Actions ────────────────────────────────────────────────────────────

  async function startAuth(platform: Platform) {
    setAuthLoading((current) => ({ ...current, [platform]: true }))
    try {
      await backend.api.authStart({ platform })
    } finally {
      setAuthLoading((current) => ({ ...current, [platform]: false }))
    }
  }

  async function logout(platform: Platform) {
    await backend.api.authLogout({ platform })
    accountsStore.set(await backend.api.getAccounts())
  }

  async function joinChannel(platform: Platform) {
    const slug = (channelInputs[platform] ?? '').trim()
    if (!slug) return
    setJoiningChannel((current) => ({ ...current, [platform]: true }))
    try {
      await backend.api.joinChannel({ channelSlug: slug, platform })
      if (!(joinedChannels[platform] ?? []).includes(slug)) {
        setJoinedChannels((current) => ({
          ...current,
          [platform]: [...(current[platform] ?? []), slug],
        }))
      }
      setChannelInputs((current) => ({ ...current, [platform]: '' }))
    } catch (error) {
      console.error(`[PlatformsPanel] joinChannel failed for ${platform}:`, error)
      showNotice(
        'error',
        `Failed to join channel: ${error instanceof Error ? error.message : String(error)}`,
        4000,
      )
    } finally {
      setJoiningChannel((current) => ({ ...current, [platform]: false }))
    }
  }

  return (
    <div
      style={{
        flexGrow: 1,
        minHeight: 0,
        overflowY: 'scroll',
        paddingTop: 28,
        paddingBottom: 28,
        paddingLeft: 32,
        paddingRight: 32,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: 700, color: theme.text }}>Platforms</Text>
        <Text style={{ fontSize: 13, color: theme.text2 }}>
          Connect your streaming accounts and join channels
        </Text>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {platforms.map((platform) => (
          <PlatformCard
            key={platform}
            platform={platform}
            account={accounts.find((a) => a.platform === platform)}
            status={statuses[platform]}
            channelInput={channelInputs[platform] ?? ''}
            joining={joiningChannel[platform] ?? false}
            authLoading={authLoading[platform] ?? false}
            inputFocused={focusedInput === platform}
            onInputChange={(value) =>
              setChannelInputs((current) => ({ ...current, [platform]: value }))
            }
            onInputFocus={() => setFocusedInput(platform)}
            onInputBlur={() =>
              setFocusedInput((current) => (current === platform ? null : current))
            }
            onJoin={() => void joinChannel(platform)}
            onStartAuth={() => void startAuth(platform)}
            onLogout={() => void logout(platform)}
          />
        ))}
      </div>
    </div>
  )
}
