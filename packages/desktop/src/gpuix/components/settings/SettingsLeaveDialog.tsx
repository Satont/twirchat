import { useState } from 'react'

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
          Leave settings without saving?
        </Text>
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          You have unsaved changes. Save them before leaving, discard them, or stay in settings.
        </Text>
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
            Stay
          </ActionButton>
          <ActionButton
            testId="settings-leave-discard"
            danger
            disabled={saving}
            onClick={discardSettingsAndLeave}
          >
            Discard and leave
          </ActionButton>
          <ActionButton
            testId="settings-leave-save"
            primary
            disabled={saving}
            onClick={() => void saveAndLeave()}
          >
            {saving ? 'Saving…' : 'Save and leave'}
          </ActionButton>
        </div>
      </div>
    </Modal>
  )
}
