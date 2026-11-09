import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  DEFAULT_PLAYER_SETTINGS,
  validatePlayerSettings,
  type PlayerSettings as Settings,
} from '../../services/channel-actions'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton, FormField, FormInput } from './ui/Form'
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
  const savedSettings = useRef<Settings | null>(null)
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
      savedSettings.current = structuredClone(settings)
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
  const save = async (): Promise<boolean> => {
    const requested = revision.current
    setSaving(true)
    setError('')
    try {
      const settings = validatePlayerSettings(draft)
      await api.savePlayerSettings({ settings })
      savedSettings.current = structuredClone(settings)
      const current = mounted.current && requested === revision.current
      if (current) setDirty(false)
      return current
    } catch (cause) {
      if (mounted.current && requested === revision.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoaded(true)
      }
      return false
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
      <SettingsFooter
        sectionId="players"
        dirty={dirty}
        saving={saving}
        error={error || validation}
        note={notice}
        disabled={!loaded || Boolean(validation)}
        saveTestId="player-save"
        errorTestId="player-save-error"
        onSave={save}
        onDiscard={() => {
          revision.current++
          setDraft(structuredClone(savedSettings.current ?? DEFAULT_PLAYER_SETTINGS))
          setDirty(false)
          setError('')
          setNotice('')
        }}
      />
    </div>
  )
}
