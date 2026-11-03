import type { NormalizedChatMessage } from '@twirchat/shared/types'

import type { StreamerModeStatus } from '../services/streamer-mode'

export function isMessageHiddenForStreamer(
  message: NormalizedChatMessage,
  status: StreamerModeStatus,
): boolean {
  if (!status.effectiveEnabled) return false
  const flags = message.metadata?.flags
  return !!(
    (status.settings.hideModActions && (flags?.moderation_action || flags?.mod_action)) ||
    (status.settings.hideRestrictedUsers && (flags?.restricted_message || flags?.restricted)) ||
    (status.settings.suppressInlineWhispers && flags?.whisper)
  )
}
