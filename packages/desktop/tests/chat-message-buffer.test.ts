import { expect, test } from 'bun:test'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { mergeChatMessageSnapshot } from '../src/views/main/utils/chat-message-buffer'

function message(id: string, timestamp: string): NormalizedChatMessage {
  return {
    id,
    platform: 'kick',
    channelId: 'satont',
    author: { id: 'viewer', displayName: 'Viewer', badges: [] },
    text: id,
    emotes: [],
    timestamp: new Date(timestamp),
    type: 'message',
  }
}

test('keeps a live message when a stale initial history snapshot finishes afterward', () => {
  const earlier = message('persisted', '2026-07-13T14:00:00.000Z')
  const live = message('live', '2026-07-13T14:01:00.000Z')

  expect(mergeChatMessageSnapshot([live], [earlier])).toEqual([earlier, live])
})
