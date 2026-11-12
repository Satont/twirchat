import { useTheme } from '@desktop/gpuix/theme-context'
import { useBackend } from '@gpuix/backend/context'
import { ActionButton } from '@gpuix/components/ui/Form'
import { Modal } from '@gpuix/components/ui/Modal'
import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { usePopupHotkeys } from '@gpuix/hooks/use-popup-hotkeys'
import { useT } from '@gpuix/i18n'
import { useState } from 'react'

import { Icon } from '../ui'

export function ProfilePictureMenu({ url, onClose }: { url: string; onClose: () => void }) {
  const backend = useBackend()
  const { t } = useT()
  const theme = useTheme()
  const [, setError] = useState('')
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
    <Modal hotkeyContextId={popupContextId} width={320} onClose={onClose}>
      <div
        testId="profile-picture-menu"
        style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <ActionButton
            disabled={busy}
            onClick={() => void run(() => backend.api.openExternalUrl({ url }))}
          >
            {t('userCard.picture.openFull')}
          </ActionButton>

          <div
            style={{
              borderColor: theme.border,
              borderRadius: 6,
              borderWidth: 2,
              cursor: 'pointer',
              paddingLeft: 6,
              paddingRight: 6,
              display: 'flex',
              flexDirection: 'center',
              alignItems: 'center',
              hover: { backgroundColor: theme.fill },
            }}
            onClick={() => void run(() => backend.api.copyText({ text: url }))}
          >
            <Icon name="copy" size={14} color={theme.navText} />
          </div>

          <div
            style={{
              borderColor: theme.border,
              borderRadius: 6,
              borderWidth: 2,
              cursor: 'pointer',
              paddingLeft: 6,
              paddingRight: 6,
              display: 'flex',
              flexDirection: 'center',
              alignItems: 'center',
              hover: { backgroundColor: theme.fill },
            }}
            onClick={onClose}
          >
            <Icon name="close" size={14} color={theme.navText} />
          </div>
        </div>
        <RemoteImage url={url} objectFit="contain" style={{ width: '100%', height: 300 }} />
      </div>
    </Modal>
  )
}
