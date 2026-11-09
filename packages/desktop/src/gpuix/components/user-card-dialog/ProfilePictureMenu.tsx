import { useBackend } from '@gpuix/backend/context'
import { ActionButton, FormError } from '@gpuix/components/ui/Form'
import { Modal } from '@gpuix/components/ui/Modal'
import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { Text } from '@gpuix/components/ui/Text'
import { usePopupHotkeys } from '@gpuix/hooks/use-popup-hotkeys'
import { useTheme } from '@gpuix/theme-context'
import { useState } from 'react'

export function ProfilePictureMenu({ url, onClose }: { url: string; onClose: () => void }) {
  const backend = useBackend()
  const theme = useTheme()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const popupContextId = usePopupHotkeys('profile-picture', { delete: onClose })
  async function run(action: () => Promise<unknown>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal hotkeyContextId={popupContextId} width={420} onClose={onClose}>
      <div
        testId="profile-picture-menu"
        style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: 700 }}>Profile picture</Text>
        <RemoteImage url={url} objectFit="contain" style={{ width: '100%', height: 300 }} />
        <FormError>{error}</FormError>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <ActionButton
            disabled={busy}
            onClick={() => void run(() => backend.api.openExternalUrl({ url }))}
          >
            Open full size
          </ActionButton>
          <ActionButton
            disabled={busy}
            onClick={() => void run(() => backend.api.copyText({ text: url }))}
          >
            Copy image URL
          </ActionButton>
          <ActionButton onClick={onClose}>Close</ActionButton>
        </div>
      </div>
    </Modal>
  )
}
