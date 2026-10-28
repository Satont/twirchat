/**
 * Add-channel modal — Modal wrapper around AddChannelForm
 * (port of AddChannelModal.vue).
 */

import { useTheme } from '../theme-context'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'
import { AddChannelForm } from './AddChannelForm'

export function AddChannelModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (platform: 'twitch' | 'kick' | 'youtube', channelSlug: string) => void
  onCancel: () => void
}) {
  const theme = useTheme()
  return (
    <Modal width={340} onClose={onCancel}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Text style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>Watch a channel</Text>
          <Text style={{ fontSize: 12, color: theme.text2 }}>
            Opens the channel's chat in a new tab
          </Text>
        </div>
        <AddChannelForm
          onConfirm={(platform, slug) => {
            onConfirm(platform, slug)
          }}
        />
      </div>
    </Modal>
  )
}
