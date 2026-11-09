import { useBackend } from '@gpuix/backend/context'
import { SettingsFooter } from '@gpuix/components/settings/SettingsLayout'
import { FormField, FormInput } from '@gpuix/components/ui/Form'
import { Text } from '@gpuix/components/ui/Text'
import { useTheme } from '@gpuix/theme-context'
import {
  DEFAULT_MODERATION_SETTINGS,
  validateModerationSettings,
  type ModerationSettings as Settings,
} from '@twirchat/shared/user-profile'
import { useEffect, useMemo, useRef, useState } from 'react'

export function ModerationSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const [settings, setSettings] = useState<Settings>(structuredClone(DEFAULT_MODERATION_SETTINGS))
  const [persisted, setPersisted] = useState<Settings | null>(null)
  const [reasonsText, setReasonsText] = useState(DEFAULT_MODERATION_SETTINGS.reasons.join('\n'))
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const draft = useMemo(
    () => ({
      ...settings,
      reasons: reasonsText.split('\n').filter((line) => line.trim()),
    }),
    [reasonsText, settings],
  )
  const draftRef = useRef(draft)
  draftRef.current = draft
  const dirty = persisted !== null && JSON.stringify(draft) !== JSON.stringify(persisted)
  useEffect(() => {
    let active = true
    backend.api
      .getModerationSettings()
      .then((value) => {
        if (active) {
          setSettings(value)
          setReasonsText(value.reasons.join('\n'))
          setPersisted(value)
          setLoaded(true)
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(String(cause))
          setLoaded(true)
        }
      })
    return () => {
      active = false
    }
  }, [backend])
  const edit = (mutate: (current: Settings) => Settings) => {
    setError('')
    setNotice('')
    setSettings(mutate)
  }
  async function save(): Promise<boolean> {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = validateModerationSettings(draft)
      await backend.api.saveModerationSettings(next)
      setSettings(next)
      setReasonsText(next.reasons.join('\n'))
      setPersisted(next)
      return JSON.stringify(draftRef.current) === JSON.stringify(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  const discard = () => {
    if (!persisted) return
    setSettings(persisted)
    setReasonsText(persisted.reasons.join('\n'))
    setError('')
    setNotice('')
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text style={{ color: theme.text2, fontSize: 12 }}>
        Eight timeout buttons. Durations use seconds; Twitch allows 1–1209600. Kick requires at
        least 60 seconds.
      </Text>
      {settings.timeouts.map((item, index) => (
        <div key={index} style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
          <div style={{ flexGrow: 1 }}>
            <FormInput
              value={item.label}
              onChange={(label) =>
                edit((current) => ({
                  ...current,
                  timeouts: current.timeouts.map((timeout, i) =>
                    i === index ? { ...timeout, label } : timeout,
                  ),
                }))
              }
              placeholder="Label"
            />
          </div>
          <div style={{ width: 130 }}>
            <FormInput
              value={String(item.seconds)}
              onChange={(seconds) =>
                edit((current) => ({
                  ...current,
                  timeouts: current.timeouts.map((timeout, i) =>
                    i === index ? { ...timeout, seconds: Number(seconds) } : timeout,
                  ),
                }))
              }
              placeholder="Seconds"
            />
          </div>
        </div>
      ))}
      <FormField label="Quick reasons (one per line)">
        <FormInput
          multiline
          value={reasonsText}
          onChange={(value) => {
            setError('')
            setNotice('')
            setReasonsText(value)
          }}
        />
      </FormField>
      <FormField label="Default reason">
        <FormInput
          value={settings.defaultReason}
          onChange={(defaultReason) => edit((current) => ({ ...current, defaultReason }))}
        />
      </FormField>
      <SettingsFooter
        sectionId="moderation"
        dirty={dirty}
        saving={busy}
        error={error}
        note={notice}
        disabled={!loaded}
        saveTestId="moderation-save"
        errorTestId="moderation-save-error"
        onSave={save}
        onDiscard={discard}
      />
    </div>
  )
}
