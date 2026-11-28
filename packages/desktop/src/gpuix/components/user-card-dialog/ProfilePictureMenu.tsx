import { useTheme } from '@desktop/gpuix/theme-context'
import { useBackend } from '@gpuix/backend/context'
import { useActionToast, type ActionClickEvent } from '@gpuix/components/action-toast'
import { ActionButton } from '@gpuix/components/ui/Form'
import { Modal } from '@gpuix/components/ui/Modal'
import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { Text } from '@gpuix/components/ui/Text'
import { usePopupHotkeys } from '@gpuix/hooks/use-popup-hotkeys'
import { useT } from '@gpuix/hooks/use-translation'
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import { useState } from 'react'

import { Icon } from '../ui'

export function ProfilePictureMenu({ url, onClose }: { url: string; onClose: () => void }) {
  const backend = useBackend()
  const { t } = useT()
  const theme = useTheme()
  const { showToast } = useActionToast()
  const [, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const popupContextId = usePopupHotkeys('profile-picture', { delete: onClose })
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function open(event?: ActionClickEvent) {
    if (await run(() => backend.api.openExternalUrl({ url })))
      showToast(t('userCard.feedback.opened'), event)
  }

  async function copy(event?: ActionClickEvent) {
    if (await run(() => backend.api.copyText({ text: url })))
      showToast(t('userCard.feedback.copied'), event)
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
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <ActionButton disabled={busy} onClick={(event) => void open(event).catch(() => {})}>
                {t('userCard.picture.openFull')}
              </ActionButton>
            </TooltipTrigger>
            <TooltipContent side="top" style={{ padding: 6, borderRadius: 6 }}>
              <Text style={{ fontSize: 12, color: theme.text }}>
                {t('userCard.picture.openFull')}
              </Text>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 33,
                  height: 33,
                  flexShrink: 0,
                  cursor: 'pointer',
                  borderColor: theme.border,
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 10,
                  paddingRight: 10,
                  borderRadius: 6,
                  borderWidth: 1,
                  backgroundColor: 'transparent',
                  hover: { backgroundColor: theme.fill },
                }}
                onClick={(event) => void copy(event).catch(() => {})}
              >
                <Icon name="copy" size={14} color={theme.navText} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} style={{ padding: 6, borderRadius: 6 }}>
              <Text style={{ fontSize: 12, color: theme.text }}>
                {t('userCard.picture.copyUrl')}
              </Text>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 33,
                  height: 33,
                  flexShrink: 0,
                  cursor: 'pointer',
                  borderColor: theme.border,
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 10,
                  paddingRight: 10,
                  borderRadius: 6,
                  borderWidth: 1,
                  backgroundColor: 'transparent',
                  hover: { backgroundColor: theme.fill },
                }}
                onClick={onClose}
              >
                <Icon name="close" size={14} color={theme.navText} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} style={{ padding: 6, borderRadius: 6 }}>
              <Text style={{ fontSize: 12, color: theme.text }}>{t('common.close')}</Text>
            </TooltipContent>
          </Tooltip>
        </div>
        <RemoteImage
          url={url}
          objectFit="contain"
          style={{ width: '100%', height: 300, borderRadius: 6 }}
        />
      </div>
    </Modal>
  )
}
