import { useState } from 'react'

import { useT } from '../../i18n'
import { useStore } from '../../state/create-store'
import {
  discardSettingsAndLeave,
  saveSettingsAndLeave,
  settingsSessionStore,
  stayInSettings,
} from '../../state/settings-session'
import { useTheme } from '../../theme-context'
import { ActionButton } from '../ui/Form'
import { Modal } from '../ui/Modal'
import { Text } from '../ui/Text'

/** Warning shown when a navigation tries to leave Settings with unsaved drafts. */
export function SettingsLeaveDialog() {
  const theme = useTheme()
  const { t } = useT()
  const session = useStore(settingsSessionStore)
  const [saving, setSaving] = useState(false)
  if (!session.pending) return null
  const saveAndLeave = async () => {
    setSaving(true)
    const saved = await saveSettingsAndLeave()
    setSaving(false)
    if (!saved) stayInSettings()
  }
  return (
    <Modal width={460} onClose={stayInSettings}>
      <div
        testId="settings-leave-dialog"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 20,
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: 700, color: theme.text }}>
          {t('settings.leave.title')}
        </Text>
        <Text style={{ fontSize: 12, color: theme.text2 }}>{t('settings.leave.body')}</Text>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 4,
          }}
        >
          <ActionButton testId="settings-leave-stay" disabled={saving} onClick={stayInSettings}>
            {t('settings.leave.stay')}
          </ActionButton>
          <ActionButton
            testId="settings-leave-discard"
            danger
            disabled={saving}
            onClick={discardSettingsAndLeave}
          >
            {t('settings.leave.discard')}
          </ActionButton>
          <ActionButton
            testId="settings-leave-save"
            primary
            disabled={saving}
            onClick={() => void saveAndLeave()}
          >
            {saving ? t('common.saving') : t('settings.leave.save')}
          </ActionButton>
        </div>
      </div>
    </Modal>
  )
}
