import type { Account, Platform, PlatformStatusInfo } from '@twirchat/shared/types'
import { useState } from 'react'

import { initialsOf } from '../../views/shared/utils/display-text'
import { useBackend, useBackendEvent } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT, type MessageKey } from '../i18n'
import { accountsStore, channelStatusStore, showNotice } from '../state/app'
import { useStore } from '../state/create-store'
import { useWindowScope } from '../state/window-scope'
import { platformColor } from '../theme'
import { useTheme } from '../theme-context'
import { SavedAccounts } from './SavedAccounts'
import { StreamEditor } from './StreamEditor'
import { PlatformIcon } from './ui/Icon'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

const platforms = new Map<Platform, string>([
  ['twitch', 'Twitch'],
  ['youtube', 'YouTube'],
  ['vkplay', 'Vkplay'],
  ['kick', 'Kick'],
])

function platformName(platform: Platform): string {
  return platforms.get(platform)!
}

function statusLabel(s: PlatformStatusInfo | undefined, t: (key: MessageKey) => string): string {
  if (!s) return t('app.platforms.status.notConnected')
  switch (s.status) {
    case 'connected':
      return s.mode === 'authenticated'
        ? t('app.platforms.status.connected')
        : t('app.platforms.status.connectedAnonymous')
    case 'connecting':
      return t('app.platforms.status.connecting')
    case 'error':
      return s.error ?? t('app.platforms.status.error')
    default:
      return t('app.platforms.status.disconnected')
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
  const { t } = useT()
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
        {t('common.disconnect')}
      </Text>
    </div>
  )
}

interface PlatformCardProps {
  platform: Platform
  account?: Account
  status?: PlatformStatusInfo
  authLoading: boolean
  onStartAuth: () => void
  onLogout: () => void
}

function PlatformCard({
  platform,
  account,
  status,
  authLoading,
  onStartAuth,
  onLogout,
}: PlatformCardProps) {
  const theme = useTheme()
  const { t } = useT()
  const pColor = platformColor(platform)

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
            <Text style={{ fontSize: 12, color: theme.text2 }}>{statusLabel(status, t)}</Text>
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
                    thumbnailSize={32}
                    objectFit="cover"
                    // GPUI clips overflow to a rectangle, so the image needs
                    // its own radius to stay inside the round frame.
                    style={{ width: '100%', height: '100%', borderRadius: 16 }}
                  />
                ) : (
                  <Text style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
                    {initialsOf(account.displayName)}
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
                {authLoading ? t('app.platforms.opening') : t('app.platforms.connect')}
              </Text>
            </div>
          )}
        </div>
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
  const { t } = useT()
  const windowScope = useWindowScope()
  const accounts = useStore(accountsStore)
  const statuses = useStore(channelStatusStore)

  const [authLoading, setAuthLoading] = useState<Record<string, boolean>>({})

  useBackendEvent('auth_success', ({ displayName }) => {
    runUiTask(backend.api.getAccounts().then((updated) => accountsStore.set(updated)))
    showNotice('success', t('app.platforms.connectedAs', { name: displayName }), 4000)
  })
  useBackendEvent('auth_error', ({ error }) => {
    showNotice('error', error, 4000)
  })

  async function startAuth(platform: Platform) {
    setAuthLoading((current) => ({ ...current, [platform]: true }))
    try {
      await backend.api.authStart({ platform, windowScope })
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : String(error))
    } finally {
      setAuthLoading((current) => ({ ...current, [platform]: false }))
    }
  }

  async function logout(platform: Platform) {
    try {
      await backend.api.authLogout({ platform })
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : String(error))
    } finally {
      accountsStore.set(await backend.api.getAccounts())
    }
  }

  return (
    <div
      style={{
        flexGrow: 1,
        minHeight: 0,
        overflowY: 'scroll',
        scrollbarColor: theme.scrollbar,
        scrollbarWidth: 4,
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
        <Text style={{ fontSize: 20, fontWeight: 700, color: theme.text }}>
          {t('app.platforms.title')}
        </Text>
        <Text style={{ fontSize: 13, color: theme.text2 }}>{t('app.platforms.subtitle')}</Text>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {Array.from(platforms.keys()).map((platform) => (
          <PlatformCard
            key={platform}
            platform={platform}
            account={accounts.find((a) => a.platform === platform)}
            status={statuses[platform]}
            authLoading={authLoading[platform] ?? false}
            onStartAuth={() => runUiTask(startAuth(platform))}
            onLogout={() => runUiTask(logout(platform))}
          />
        ))}
      </div>
      <SavedAccounts />
    </div>
  )
}
