import { useEffect, useMemo, useRef, useState } from 'react'

import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT, type MessageKey } from '../i18n'
import { useStore } from '../state/create-store'
import { notificationErrorStore, notificationPreferences } from '../state/highlight-notifications'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { FormError, FormField, FormInput } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

type NotificationToggle =
  | 'enabled'
  | 'mentionsEnabled'
  | 'soundEnabled'
  | 'desktopEnabled'
  | 'backgroundOnly'
  | 'excludeBotBadges'

const toggleLabels: Record<NotificationToggle, MessageKey> = {
  enabled: 'notificationSettings.enabled',
  mentionsEnabled: 'notificationSettings.mentionsEnabled',
  soundEnabled: 'notificationSettings.soundEnabled',
  desktopEnabled: 'notificationSettings.desktopEnabled',
  backgroundOnly: 'notificationSettings.backgroundOnly',
  excludeBotBadges: 'notificationSettings.excludeBotBadges',
}

export function NotificationSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const state = useStore(notificationPreferences.store)
  const error = useStore(notificationErrorStore)
  const [draft, setDraft] = useState(state.value)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(state.value),
    [draft, state.value],
  )
  useEffect(() => {
    runUiTask(notificationPreferences.load(backend.api))
  }, [backend])
  useEffect(() => {
    if (!dirty) setDraft(state.value)
  }, [dirty, state.value])
  const toggle = (key: NotificationToggle) => (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ fontSize: 12, color: theme.text, flexGrow: 1 }}>{t(toggleLabels[key])}</Text>
      <Switch
        checked={draft[key]}
        onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))}
      />
    </div>
  )
  async function save(): Promise<boolean> {
    const snapshot = draft
    try {
      await notificationPreferences.save(backend.api, snapshot)
      return draftRef.current === snapshot
    } catch {
      /* Error is displayed by the preference store. */
      return false
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
        label={t('notificationSettings.excludedUsers')}
        hint={t('notificationSettings.excludedUsersHint')}
      >
        <FormInput
          multiline
          value={draft.excludedUsers.join('\n')}
          onChange={(text) =>
            setDraft((current) => ({ ...current, excludedUsers: text.split('\n') }))
          }
        />
      </FormField>
      <FormField
        label={t('notificationSettings.soundFile')}
        hint={t('notificationSettings.soundFileHint')}
      >
        <FormInput
          value={draft.soundPath}
          onChange={(soundPath) => setDraft((current) => ({ ...current, soundPath }))}
        />
      </FormField>
      <FormField
        label={t('notificationSettings.mutedChannels')}
        hint={t('notificationSettings.mutedChannelsHint')}
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
      <SettingsFooter
        sectionId="notifications"
        dirty={dirty}
        saving={state.saving}
        saveTestId="notifications-save"
        errorTestId="notifications-save-error"
        onSave={save}
        onDiscard={() => setDraft(state.value)}
      />
    </div>
  )
}
