import type { TwitchWebSessionStatus } from '@twirchat/shared/twitch-activities'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useBackend, useBackendEvent } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton } from './ui/Form'
import { Text } from './ui/Text'

export function TwitchSessionSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const [status, setStatus] = useState<TwitchWebSessionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lifetime = useRef({ mounted: true, statusRevision: 0, actionRevision: 0 }).current
  const loadStatus = useCallback(async () => {
    const revision = ++lifetime.statusRevision
    try {
      const value = await backend.api.getTwitchWebSessionStatus()
      if (lifetime.mounted && revision === lifetime.statusRevision) setStatus(value)
    } catch (cause) {
      if (lifetime.mounted && revision === lifetime.statusRevision) setError(String(cause))
    }
  }, [backend, lifetime])
  useEffect(() => {
    lifetime.mounted = true
    runUiTask(loadStatus())
    return () => {
      lifetime.mounted = false
      lifetime.statusRevision++
      lifetime.actionRevision++
    }
  }, [loadStatus, lifetime])
  useBackendEvent('accounts_changed', ({ platform, identityChanged }) => {
    if (platform !== 'twitch' || !identityChanged) return
    lifetime.actionRevision++
    setBusy(false)
    setStatus(null)
    setError('')
    runUiTask(loadStatus())
  })
  async function connect() {
    const revision = ++lifetime.actionRevision
    setBusy(true)
    setError('')
    try {
      const token = (await backend.api.readClipboard()).trim()
      if (!lifetime.mounted || revision !== lifetime.actionRevision) return
      if (!token) throw new Error(t('twitchSessionSettings.clipboardEmpty'))
      await backend.api.setTwitchWebSession({ token })
      if (lifetime.mounted && revision === lifetime.actionRevision) await loadStatus()
    } catch (cause) {
      if (lifetime.mounted && revision === lifetime.actionRevision)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (lifetime.mounted && revision === lifetime.actionRevision) setBusy(false)
    }
  }
  async function disconnect() {
    const revision = ++lifetime.actionRevision
    setBusy(true)
    setError('')
    try {
      await backend.api.clearTwitchWebSession()
      if (lifetime.mounted && revision === lifetime.actionRevision) await loadStatus()
    } catch (cause) {
      if (lifetime.mounted && revision === lifetime.actionRevision) setError(String(cause))
    } finally {
      if (lifetime.mounted && revision === lifetime.actionRevision) setBusy(false)
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text style={{ fontSize: 12, color: theme.text2 }}>{t('twitchSessionSettings.intro')}</Text>
      <Text style={{ fontSize: 12, color: theme.text }}>
        {status?.configured
          ? status.username
            ? t('twitchSessionSettings.connectedAs', { username: status.username })
            : t('twitchSessionSettings.connected')
          : t('twitchSessionSettings.notConnected')}
      </Text>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <ActionButton primary disabled={busy} onClick={() => void connect()}>
          {busy ? t('twitchSessionSettings.connecting') : t('twitchSessionSettings.connect')}
        </ActionButton>
        {status?.configured ? (
          <ActionButton danger disabled={busy} onClick={() => void disconnect()}>
            {t('twitchSessionSettings.disconnect')}
          </ActionButton>
        ) : null}
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
