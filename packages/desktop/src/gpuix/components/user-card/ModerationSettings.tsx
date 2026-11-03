import {
  DEFAULT_MODERATION_SETTINGS,
  validateModerationSettings,
  type ModerationSettings as Settings,
} from '@twirchat/shared/user-profile'
import { useEffect, useState } from 'react'

import { useBackend } from '../../backend/context'
import { useTheme } from '../../theme-context'
import { ActionButton, FormField, FormInput } from '../ui/Form'
import { Text } from '../ui/Text'

export function ModerationSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const [settings, setSettings] = useState<Settings>(structuredClone(DEFAULT_MODERATION_SETTINGS))
  const [reasonsText, setReasonsText] = useState(DEFAULT_MODERATION_SETTINGS.reasons.join('\n'))
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    let active = true
    backend.api
      .getModerationSettings()
      .then((value) => {
        if (active) {
          setSettings(value)
          setReasonsText(value.reasons.join('\n'))
          setLoaded(true)
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setFeedback(String(cause))
          setLoaded(true)
        }
      })
    return () => {
      active = false
    }
  }, [backend])
  async function save() {
    setBusy(true)
    try {
      await backend.api.saveModerationSettings(
        validateModerationSettings({
          ...settings,
          reasons: reasonsText.split('\n').filter((line) => line.trim()),
        }),
      )
      setFeedback('Moderation settings saved.')
    } catch (cause) {
      setFeedback(String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text style={{ color: theme.text, fontSize: 14, fontWeight: 700 }}>User card moderation</Text>
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
                setSettings((current) => ({
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
                setSettings((current) => ({
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
        <FormInput multiline value={reasonsText} onChange={setReasonsText} />
      </FormField>
      <FormField label="Default reason">
        <FormInput
          value={settings.defaultReason}
          onChange={(defaultReason) => setSettings((current) => ({ ...current, defaultReason }))}
        />
      </FormField>
      <ActionButton primary disabled={!loaded || busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save moderation settings'}
      </ActionButton>
      {feedback ? <Text style={{ color: theme.text2, fontSize: 12 }}>{feedback}</Text> : null}
    </div>
  )
}
