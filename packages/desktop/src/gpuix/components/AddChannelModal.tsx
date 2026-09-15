/**
 * Add-channel modal — Modal wrapper around AddChannelForm
 * (port of AddChannelModal.vue).
 */

import { Modal } from './ui/Modal'
import { AddChannelForm } from './AddChannelForm'

export function AddChannelModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (platform: 'twitch' | 'kick' | 'youtube', channelSlug: string) => void
  onCancel: () => void
}) {
  return (
    <Modal width={320} onClose={onCancel}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
        <AddChannelForm
          onConfirm={(platform, slug) => {
            onConfirm(platform, slug)
          }}
        />
      </div>
    </Modal>
  )
}
