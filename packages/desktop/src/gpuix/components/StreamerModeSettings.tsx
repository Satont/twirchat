import { useEffect, useRef, useState } from 'react'

import type { StreamerMode, StreamerModeSettings as Settings } from '../../services/streamer-mode'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useStore } from '../state/create-store'
import {
  loadStreamerMode,
  saveStreamerMode,
  saveStreamerModeSettings,
  streamerModeRequestStore,
  streamerModeStore,
} from '../state/streamer-mode'
import { useTheme } from '../theme-context'
import { ActionButton, FormError } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'
const privacy: [keyof Settings, string][] = [
  ['hideUsercardAvatars', 'Hide user card avatars'],
  ['hideLinkThumbnails', 'Hide link thumbnails'],
  ['hideModActions', 'Hide moderation actions'],
  ['hideRestrictedUsers', 'Hide restricted users'],
  ['muteMentions', 'Mute mention sounds'],
  ['suppressInlineWhispers', 'Hide inline whispers'],
  ['hideBlockedTermText', 'Hide blocked-term text'],
  ['hideViewerCountAndDuration', 'Hide viewer counts and stream duration'],
  ['suppressLiveNotifications', 'Suppress live notifications'],
]
export function StreamerModeSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const status = useStore(streamerModeStore)
  const requests = useStore(streamerModeRequestStore)
  const [draft, setDraft] = useState(() => structuredClone(status.settings))
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const revision = useRef(0)
  useEffect(() => {
    runUiTask(loadStreamerMode(backend))
  }, [backend])
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(status.settings))
  }, [dirty, status.settings])
  const setMode = (mode: StreamerMode | 'toggle') => {
    void saveStreamerMode(backend, mode).catch(() => {})
  }
  const save = async () => {
    const requested = revision.current
    try {
      await saveStreamerModeSettings(backend, draft)
      if (revision.current === requested) {
        setDirty(false)
        setNotice('Streamer privacy settings saved.')
      }
    } catch {
      /* The request store keeps the actionable error and the draft remains editable. */
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text style={{ color: theme.text, fontSize: 12 }}>
        {`Streamer privacy is ${status.effectiveEnabled ? 'on' : 'off'}${status.checking ? ' · Checking streaming software…' : ''}`}
      </Text>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['auto', 'on', 'off'] satisfies StreamerMode[]).map((mode) => (
          <ActionButton
            key={mode}
            primary={status.mode === mode}
            disabled={requests.saving}
            onClick={() => setMode(mode)}
          >
            {mode === 'auto' ? 'Auto' : mode === 'on' ? 'On' : 'Off'}
          </ActionButton>
        ))}
        <ActionButton disabled={requests.saving} onClick={() => setMode('toggle')}>
          Toggle effective mode
        </ActionButton>
      </div>
      <Text style={{ color: theme.text2, fontSize: 12 }}>
        Auto checks for streaming software immediately and every 20 seconds. On and Off stop
        automatic detection. Privacy options below apply only while streamer mode is active.
      </Text>
      <FormError>{requests.error || status.error}</FormError>
      {requests.error ? (
        <ActionButton
          onClick={() => {
            runUiTask(loadStreamerMode(backend))
          }}
        >
          Retry loading streamer mode
        </ActionButton>
      ) : null}
      {privacy.map(([key, label]) => (
        <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Switch
            checked={draft[key]}
            onChange={(value) => {
              revision.current++
              setDirty(true)
              setNotice('')
              setDraft((current) => ({ ...current, [key]: value }))
            }}
          />
          <Text style={{ color: theme.text, fontSize: 12 }}>{label}</Text>
        </div>
      ))}
      {notice ? <Text style={{ color: theme.text2, fontSize: 12 }}>{notice}</Text> : null}
      <ActionButton
        primary
        disabled={!requests.loaded || !dirty || requests.saving}
        onClick={() => {
          runUiTask(save())
        }}
      >
        {requests.saving
          ? 'Saving…'
          : requests.error
            ? 'Retry saving streamer privacy settings'
            : 'Save streamer privacy settings'}
      </ActionButton>
    </div>
  )
}
