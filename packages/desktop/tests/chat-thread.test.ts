import { expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { selectTwitchThread } from '../src/gpuix/chat-thread'

const author = { id: 'viewer', displayName: 'Viewer', username: 'viewer', badges: [] }
const at = Date.now()
let sequence = 0

function message(
  id: string,
  overrides: Partial<NormalizedChatMessage> = {},
): NormalizedChatMessage {
  return {
    id,
    text: id,
    channelId: 'stream',
    platform: 'twitch',
    author,
    timestamp: new Date(at + sequence++),
    emotes: [],
    type: 'message',
    ...overrides,
  }
}

function reply(id: string, parentMessageId: string, threadRootMessageId?: string) {
  return message(id, {
    reply: {
      parentMessageId,
      parentMessageText: parentMessageId,
      parentAuthor: author,
      threadRootMessageId,
    },
  })
}

test('groups Twitch siblings and legacy descendants in the same channel', () => {
  const root = message('root', { channelId: '#Stream' })
  const direct = reply('direct', root.id)
  const sibling = reply('sibling', root.id, root.id)
  const nested = reply('nested', direct.id)
  const explicit = reply('explicit', 'evicted-parent', root.id)
  const otherThread = reply('other-thread', direct.id, 'different-root')
  const otherChannel = { ...reply('other-channel', root.id, root.id), channelId: 'other' }
  const otherPlatform: NormalizedChatMessage = {
    ...reply('other-platform', root.id),
    platform: 'kick',
  }
  const messages = [
    root,
    direct,
    sibling,
    nested,
    explicit,
    otherThread,
    otherChannel,
    otherPlatform,
  ]
  const thread = selectTwitchThread(nested, messages)
  expect(thread.root).toMatchObject({ kind: 'message', message: root })
  expect(thread.replies).toEqual([direct, sibling, nested, explicit])
})

test('uses a reply preview only when the immediate parent is the missing root', () => {
  const direct = reply('direct', 'missing')
  const nested = reply('nested', 'another-message', 'missing')
  expect(selectTwitchThread(direct, [direct]).root).toMatchObject({
    kind: 'preview',
    message: { id: 'missing', text: 'missing' },
  })
  expect(selectTwitchThread(nested, [nested]).root).toEqual({ kind: 'unavailable', id: 'missing' })
  expect(selectTwitchThread(nested, [direct, nested]).root).toMatchObject({
    kind: 'preview',
    message: { id: 'missing', text: 'missing' },
  })
})

test('keeps already visible rows while an open thread receives new replies', () => {
  const root = message('root')
  const direct = reply('direct', root.id)
  const clicked = reply('clicked', direct.id)
  const initial = selectTwitchThread(clicked, [root, direct, clicked])
  const latest = reply('latest', clicked.id)
  const updated = selectTwitchThread(clicked, [latest, message('unrelated')], initial)
  expect(updated.root).toMatchObject({ kind: 'message', message: root })
  expect(updated.replies).toEqual([direct, clicked, latest])
})
