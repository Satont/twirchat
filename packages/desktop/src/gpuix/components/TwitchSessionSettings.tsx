import type { TwitchWebSessionStatus } from '@twirchat/shared/twitch-activities'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useBackend, useBackendEvent } from '../backend-context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../hooks/use-translation'
import { useWindowScope } from '../state/window-scope'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton } from './ui/Form'
import { Text } from './ui/Text'

interface SessionStatuses {
  points: TwitchWebSessionStatus
  manual: TwitchWebSessionStatus
}

type SessionAction = 'connect-points' | 'disconnect-points' | 'connect-manual' | 'disconnect-manual'

export function TwitchSessionSettings() {
  const { api } = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const windowScope = useWindowScope()
  const [statuses, setStatuses] = useState<SessionStatuses | null>(null)
  const [action, setAction] = useState<SessionAction | null>(null)
  const [error, setError] = useState('')
  const lifetimeRef = useRef({ mounted: true, statusRevision: 0, actionRevision: 0 })
  const loadStatus = useCallback(async () => {
    const lifetime = lifetimeRef.current
    const revision = ++lifetime.statusRevision
    try {
      const [points, manual] = await Promise.all([
        api.getTwitchPointsSessionStatus(),
        api.getTwitchWebSessionStatus(),
      ])
      if (lifetime.mounted && revision === lifetime.statusRevision) setStatuses({ points, manual })
    } catch (cause) {
      if (lifetime.mounted && revision === lifetime.statusRevision)
        setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api])
  useEffect(() => {
    const lifetime = lifetimeRef.current
    lifetime.mounted = true
    runUiTask(Promise.resolve().then(loadStatus))
    return () => {
      lifetime.mounted = false
      lifetime.statusRevision++
      lifetime.actionRevision++
    }
  }, [loadStatus])
  useBackendEvent('accounts_changed', ({ platform, identityChanged }) => {
    if (platform !== 'twitch' || !identityChanged) return
    lifetimeRef.current.actionRevision++
    setAction(null)
    setStatuses(null)
    setError('')
    runUiTask(loadStatus())
  })
  useBackendEvent('twitch_web_session_changed', () => runUiTask(loadStatus()))

  async function runAction(
    next: SessionAction,
    perform: (isCurrent: () => boolean) => Promise<unknown>,
  ) {
    const lifetime = lifetimeRef.current
    const revision = ++lifetime.actionRevision
    const isCurrent = () => lifetime.mounted && revision === lifetime.actionRevision
    setAction(next)
    setError('')
    try {
      await perform(isCurrent)
      if (isCurrent()) await loadStatus()
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isCurrent()) setAction(null)
    }
  }

  const busy = action !== null
  let pointsLabel = t('twitchSessionSettings.checking')
  let manualLabel = pointsLabel
  if (statuses) {
    pointsLabel = statuses.points.configured
      ? t('twitchSessionSettings.pointsConnected')
      : t('twitchSessionSettings.pointsNotConnected')
    const { configured, username } = statuses.manual
    manualLabel = t('twitchSessionSettings.notConnected')
    if (configured)
      manualLabel = username
        ? t('twitchSessionSettings.connectedAs', { username })
        : t('twitchSessionSettings.connected')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text testId="channel-points-session-status" style={{ fontSize: 12, color: theme.text }}>
        {pointsLabel}
      </Text>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {statuses?.points.configured ? (
          <ActionButton
            testId="disconnect-channel-points"
            danger
            disabled={busy}
            onClick={() =>
              runUiTask(runAction('disconnect-points', () => api.clearTwitchPointsSession()))
            }
          >
            {t('twitchSessionSettings.disconnectPoints')}
          </ActionButton>
        ) : (
          <ActionButton
            testId="connect-channel-points"
            primary
            disabled={busy}
            onClick={() =>
              runUiTask(runAction('connect-points', () => api.connectTwitchPoints({ windowScope })))
            }
          >
            {action === 'connect-points'
              ? t('twitchSessionSettings.connecting')
              : t('twitchSessionSettings.connectPoints')}
          </ActionButton>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          paddingTop: 12,
          borderTopWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Text style={{ fontSize: 12, color: theme.text2 }}>{t('twitchSessionSettings.intro')}</Text>
        <Text style={{ fontSize: 12, color: theme.text }}>{manualLabel}</Text>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <ActionButton
            disabled={busy}
            onClick={() =>
              runUiTask(
                runAction('connect-manual', async (isCurrent) => {
                  const token = (await api.readClipboard()).trim()
                  if (!isCurrent()) return
                  if (!token) throw new Error(t('twitchSessionSettings.clipboardEmpty'))
                  await api.setTwitchWebSession({ token })
                }),
              )
            }
          >
            {action === 'connect-manual'
              ? t('twitchSessionSettings.connecting')
              : t('twitchSessionSettings.connect')}
          </ActionButton>
          {statuses?.manual.configured ? (
            <ActionButton
              danger
              disabled={busy}
              onClick={() =>
                runUiTask(runAction('disconnect-manual', () => api.clearTwitchWebSession()))
              }
            >
              {t('twitchSessionSettings.disconnect')}
            </ActionButton>
          ) : null}
        </div>
      </div>
      <SettingsFooter
        sectionId="twitch-session"
        error={error}
        errorTestId="twitch-session-error"
        note={t('twitchSessionSettings.note')}
      />
    </div>
  )
}
