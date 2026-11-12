import { expect, test } from 'bun:test'

import type { BackendToDesktopMessage } from '@twirchat/shared/protocol'
import type { SevenTvSystemAction } from '@twirchat/shared/types'

import { setLanguage } from '../src/gpuix/i18n'
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
      ...(action === 'updated' ? { oldAlias: 'OldRagey' } : { actorName: 'Editor' }),
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
    const emoteTokens = tokens.filter((token) => token.kind === 'emote')
    expect(emoteTokens).toEqual([
      expect.objectContaining({ emote: expect.objectContaining({ imageUrl: emote.imageUrl }) }),
    ])
    expect(emoteTokens[0]?.alias).toBeUndefined()
    const visibleText = tokens
      .flatMap((token) => (token.kind === 'text' ? token.text : ''))
      .join('')
    expect(visibleText).toContain('RAGEY')
    expect(visibleText).toContain(
      action === 'added' ? 'added to' : action === 'removed' ? 'removed from' : 'renamed in',
    )
    if (action === 'updated') expect(visibleText).toContain('(was OldRagey)')
    else expect(visibleText).toEndWith(' by Editor')
  })
}

test('7TV add and remove notices still work without an actor name', () => {
  const changes = [
    { action: 'added', expected: 'Emote «RAGEY» :RAGEY: added to the channel' },
    { action: 'removed', expected: 'Emote «RAGEY» :RAGEY: removed from the channel' },
  ]
  for (const { action, expected } of changes) {
    const incoming = backendToDesktopMessageSchema.parse({
      type: 'seventv_system_message',
      platform: 'kick',
      channelId: 'satont',
      action,
      emote,
    })
    if (incoming.type !== 'seventv_system_message') throw new Error('Expected 7TV notice.')
    expect(buildSevenTvSystemMessage(incoming, identity).text).toBe(expected)
  }
})

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

test('7TV notices carry their action so translated text keeps its styling', () => {
  setLanguage('ru')
  try {
    const expected: Record<(typeof actions)[number], SevenTvSystemAction> = {
      added: 'added',
      removed: 'removed',
      updated: 'changed',
    }
    for (const action of actions) {
      const message = buildSevenTvSystemMessage(
        {
          type: 'seventv_system_message',
          platform: 'twitch',
          channelId: 'satont',
          action,
          emote,
          actorName: action === 'updated' ? undefined : 'Редактор',
        },
        identity,
      )
      if (action !== 'updated') expect(message.text).toEndWith(' · Автор — Редактор')
      expect(message.metadata?.sevenTvAction).toBe(expected[action])
    }
  } finally {
    setLanguage('en')
  }
})
