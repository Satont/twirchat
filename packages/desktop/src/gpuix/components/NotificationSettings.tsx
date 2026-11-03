import { useEffect, useState } from 'react'

import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useStore } from '../state/create-store'
import { notificationErrorStore, notificationPreferences } from '../state/highlight-notifications'
import { useTheme } from '../theme-context'
import { ActionButton, FormError, FormField, FormInput } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

type NotificationToggle =
  | 'enabled'
  | 'mentionsEnabled'
  | 'soundEnabled'
  | 'desktopEnabled'
  | 'backgroundOnly'
  | 'excludeBotBadges'

const toggleLabels: Record<NotificationToggle, string> = {
  enabled: 'Enable notifications',
  mentionsEnabled: 'Notify about mentions and replies',
  soundEnabled: 'Play notification sounds',
  desktopEnabled: 'Show desktop alerts',
  backgroundOnly: 'Only when the app is not visible',
  excludeBotBadges: 'Exclude accounts with a bot badge',
}

export function NotificationSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const state = useStore(notificationPreferences.store)
  const error = useStore(notificationErrorStore)
  const [draft, setDraft] = useState(state.value)
  useEffect(() => {
    runUiTask(notificationPreferences.load(backend.api))
  }, [backend])
  useEffect(() => setDraft(state.value), [state.value])
  const toggle = (key: NotificationToggle) => (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ fontSize: 12, color: theme.text, flexGrow: 1 }}>{toggleLabels[key]}</Text>
      <Switch
        checked={draft[key]}
        onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))}
      />
    </div>
  )
  async function save() {
    try {
      await notificationPreferences.save(backend.api, draft)
    } catch {
      /* Error is displayed by the preference store. */
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {toggle('enabled')}
      {toggle('mentionsEnabled')}
      {toggle('soundEnabled')}
      {toggle('desktopEnabled')}
      {toggle('backgroundOnly')}
      {toggle('excludeBotBadges')}
      <FormField
        label="Excluded users"
        hint="One username per line; optionally prefix with twitch:, kick: or youtube:. Known chat bots are excluded by default."
      >
        <FormInput
          multiline
          value={draft.excludedUsers.join('\n')}
          onChange={(text) =>
            setDraft((current) => ({ ...current, excludedUsers: text.split('\n') }))
          }
        />
      </FormField>
      <FormField label="Custom sound file" hint="Leave blank for the system message sound">
        <FormInput
          value={draft.soundPath}
          onChange={(soundPath) => setDraft((current) => ({ ...current, soundPath }))}
        />
      </FormField>
      <FormField
        label="Muted channels"
        hint="One channel per line; optionally prefix with twitch:, kick: or youtube:"
      >
        <FormInput
          multiline
          value={draft.mutedChannels.join('\n')}
          onChange={(text) =>
            setDraft((current) => ({ ...current, mutedChannels: text.split('\n') }))
          }
        />
      </FormField>
      <FormError>{state.error || error}</FormError>
      <ActionButton primary disabled={state.saving} onClick={() => void save()}>
        {state.saving ? 'Saving…' : 'Save notifications'}
      </ActionButton>
    </div>
  )
}
