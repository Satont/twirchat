import { expect, test } from 'bun:test'

import type { BackendToDesktopMessage } from '@twirchat/shared/protocol'

import { buildMessageTokens } from '../src/gpuix/message-tokens'
import { backendToDesktopMessageSchema } from '../src/services/persisted-schemas'
import { enrichProviderEmotes } from '../src/services/provider-emotes'
import { buildSevenTvSystemMessage } from '../src/services/seventv-system-message'

const emote = {
  id: '01GBFAYKGR000FWWN7MDZZ8XQN',
  alias: 'RAGEY',
  name: 'RAGEY',
  animated: true,
  zeroWidth: false,
  aspectRatio: 1.4,
  imageUrl: 'https://cdn.7tv.app/emote/01GBFAYKGR000FWWN7MDZZ8XQN/4x.gif',
}
const identity = { id: '7tv-notice', timestamp: new Date('2026-11-03T06:36:18Z') }
const actions: Array<'added' | 'removed' | 'updated'> = ['added', 'removed', 'updated']

for (const action of actions) {
  test(`7TV ${action} notice preserves event artwork and visible alias`, () => {
    const incoming = backendToDesktopMessageSchema.parse({
      type: 'seventv_system_message',
      platform: 'kick',
      channelId: 'satont',
      action,
      emote,
      ...(action === 'updated' ? { oldAlias: 'OldRagey' } : {}),
    })
    if (incoming.type !== 'seventv_system_message') throw new Error('Expected 7TV notice.')
    const message = buildSevenTvSystemMessage(incoming, identity)
    expect(message).toMatchObject({
      ...identity,
      platform: 'kick',
      channelId: 'satont',
      type: 'system',
    })
    expect(message.emotes).toEqual([
      expect.objectContaining({
        id: emote.id,
        name: emote.alias,
        imageUrl: emote.imageUrl,
        animated: true,
        aspectRatio: 1.4,
        provider: 'seventv',
      }),
    ])
    const enriched = enrichProviderEmotes(message, [{ ...emote, source: 'seventv' }])
    const tokens = buildMessageTokens(enriched)
    expect(tokens.filter((token) => token.kind === 'emote')).toEqual([
      expect.objectContaining({ emote: expect.objectContaining({ imageUrl: emote.imageUrl }) }),
    ])
    const visibleText = tokens
      .flatMap((token) => (token.kind === 'text' ? token.text : ''))
      .join('')
    expect(visibleText).toContain('RAGEY')
    expect(visibleText).toContain(
      action === 'added' ? 'added to' : action === 'removed' ? 'removed from' : 'renamed in',
    )
    if (action === 'updated') expect(visibleText).toContain('(was OldRagey)')
  })
}

test('7TV set notifications preserve their text without artwork', () => {
  const changes: Array<Extract<BackendToDesktopMessage, { type: 'seventv_system_message' }>> = [
    {
      type: 'seventv_system_message',
      platform: 'twitch',
      channelId: 'satont',
      action: 'set_changed',
      setName: 'New',
    },
    {
      type: 'seventv_system_message',
      platform: 'twitch',
      channelId: 'satont',
      action: 'set_renamed',
      oldName: 'Old',
      newName: 'New',
    },
    {
      type: 'seventv_system_message',
      platform: 'twitch',
      channelId: 'satont',
      action: 'set_deleted',
      setName: 'Old',
    },
  ]
  expect(changes.map((change) => buildSevenTvSystemMessage(change, identity).text)).toEqual([
    'Active emote set changed to «New»',
    'Emote set «Old» renamed to «New»',
    'Emote set «Old» was deleted',
  ])
  for (const change of changes)
    expect(buildSevenTvSystemMessage(change, identity).emotes).toEqual([])
})
