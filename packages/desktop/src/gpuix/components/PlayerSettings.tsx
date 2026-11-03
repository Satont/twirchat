import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  DEFAULT_PLAYER_SETTINGS,
  validatePlayerSettings,
  type PlayerSettings as Settings,
} from '../../services/channel-actions'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useTheme } from '../theme-context'
import { ActionButton, FormError, FormField, FormInput } from './ui/Form'
import { Text } from './ui/Text'

export function PlayerSettings() {
  const { api } = useBackend()
  const theme = useTheme()
  const [draft, setDraft] = useState<Settings>(() => structuredClone(DEFAULT_PLAYER_SETTINGS))
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const revision = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const load = useCallback(async () => {
    const requested = ++revision.current
    setError('')
    try {
      const settings = validatePlayerSettings(await api.getPlayerSettings())
      if (!mounted.current || revision.current !== requested) return
      setDraft(settings)
      setLoaded(true)
      setDirty(false)
    } catch (cause) {
      if (mounted.current && revision.current === requested) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoaded(true)
      }
    }
  }, [api])
  useEffect(() => {
    runUiTask(load())
  }, [load])
  const edit = (kind: keyof Settings, key: 'executable' | 'arguments', value: string) => {
    revision.current++
    setDirty(true)
    setNotice('')
    setError('')
    setDraft((current) => ({
      ...current,
      [kind]: { ...current[kind], [key]: key === 'arguments' ? value.split('\n') : value },
    }))
  }
  const validation = useMemo(() => {
    try {
      validatePlayerSettings(draft)
      return ''
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  }, [draft])
  const save = async () => {
    const requested = revision.current
    setSaving(true)
    setError('')
    try {
      await api.savePlayerSettings({ settings: validatePlayerSettings(draft) })
      if (mounted.current && requested === revision.current) {
        setDirty(false)
        setNotice('Player settings saved.')
      }
    } catch (cause) {
      if (mounted.current && requested === revision.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoaded(true)
      }
    } finally {
      if (mounted.current) setSaving(false)
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        Open channel streams in your browser, a custom player or Streamlink. Install the player
        separately and enter its executable path here.
      </Text>
      {!loaded && !error ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>Loading player settings…</Text>
      ) : null}
      <FormError>{error || validation}</FormError>
      {error && !dirty ? (
        <ActionButton
          onClick={() => {
            runUiTask(load())
          }}
        >
          Retry loading player settings
        </ActionButton>
      ) : null}
      {loaded
        ? (
            ['custom', 'streamlink'] satisfies (keyof Pick<Settings, 'custom' | 'streamlink'>)[]
          ).map((kind) => (
            <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FormField
                label={kind === 'custom' ? 'Custom player executable' : 'Streamlink executable'}
              >
                <FormInput
                  testId={`player-${kind}-executable`}
                  value={draft[kind].executable}
                  onChange={(value) => edit(kind, 'executable', value)}
                  placeholder={kind === 'custom' ? '/usr/bin/mpv' : 'streamlink'}
                />
              </FormField>
              <FormField
                label="Arguments"
                hint="One argument per line. Use {url}, {channel} and {platform}. Spaces within a line stay in that single argument; do not add shell quotes."
              >
                <FormInput
                  multiline
                  testId={`player-${kind}-arguments`}
                  value={draft[kind].arguments.join('\n')}
                  onChange={(value) => edit(kind, 'arguments', value)}
                />
              </FormField>
            </div>
          ))
        : null}
      {notice ? <Text style={{ fontSize: 12, color: theme.text2 }}>{notice}</Text> : null}
      <ActionButton
        primary
        testId="player-save"
        disabled={!loaded || !dirty || saving || Boolean(validation)}
        onClick={() => {
          runUiTask(save())
        }}
      >
        {saving
          ? 'Saving…'
          : error && dirty
            ? 'Retry saving player settings'
            : 'Save player settings'}
      </ActionButton>
    </div>
  )
}
