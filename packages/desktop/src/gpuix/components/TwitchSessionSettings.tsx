import type { TwitchWebSessionStatus } from '@twirchat/shared/twitch-activities'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useBackend, useBackendEvent } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton } from './ui/Form'
import { Text } from './ui/Text'

export function TwitchSessionSettings() {
  const backend = useBackend()
  const theme = useTheme()
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
      if (!token) throw new Error('The clipboard is empty. Copy your Twitch session token first.')
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
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        Voting, predictions, reward redemption and following use a separate Twitch web session. Copy
        its token, then connect below. Encrypted sessions are saved separately for each Twitch
        account and never displayed.
      </Text>
      <Text style={{ fontSize: 12, color: theme.text }}>
        {status?.configured
          ? `Connected${status.username ? ` as ${status.username}` : ''}`
          : 'No additional Twitch session connected.'}
      </Text>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <ActionButton primary disabled={busy} onClick={() => void connect()}>
          {busy ? 'Connecting…' : 'Connect token from clipboard'}
        </ActionButton>
        {status?.configured ? (
          <ActionButton danger disabled={busy} onClick={() => void disconnect()}>
            Disconnect session
          </ActionButton>
        ) : null}
      </div>
      <SettingsFooter
        sectionId="twitch-session"
        error={error}
        errorTestId="twitch-session-error"
        note="Connect and disconnect apply immediately."
      />
    </div>
  )
}
