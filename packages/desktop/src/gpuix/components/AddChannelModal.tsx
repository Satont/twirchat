import type { WatchedPlatform } from '../../watched-channels/plugin-channel-types'
import { usePopupContextId } from '../hooks/use-popup-hotkeys'
import { useT } from '../i18n'
/**
 * Add-channel modal — Modal wrapper around AddChannelForm
 * (port of AddChannelModal.vue).
 */
import { useTheme } from '../theme-context'
import { AddChannelForm } from './AddChannelForm'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'

export function AddChannelModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (platform: WatchedPlatform, channelSlug: string) => void
  onCancel: () => void
}) {
  const theme = useTheme()
  const { t } = useT()
  const popupContextId = usePopupContextId('add-channel')
  return (
    <Modal hotkeyContextId={popupContextId} width={340} onClose={onCancel}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Text style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
            {t('app.addChannel.title')}
          </Text>
          <Text style={{ fontSize: 12, color: theme.text2 }}>{t('app.addChannel.subtitle')}</Text>
        </div>
        <AddChannelForm
          popup
          popupContextId={popupContextId}
          onCancel={onCancel}
          onConfirm={(platform, slug) => {
            onConfirm(platform, slug)
          }}
        />
      </div>
    </Modal>
  )
}
