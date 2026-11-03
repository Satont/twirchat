import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { DesktopSevenTVService } from '@desktop/seventv'
import type { DesktopToBackendMessage, SevenTVEmote } from '@twirchat/shared'

function makeEmote(id: string, alias: string): SevenTVEmote {
  return {
    id,
    alias,
    name: `Original${id}`,
    animated: false,
    zeroWidth: false,
    aspectRatio: 1,
    imageUrl: `https://cdn.7tv.app/emote/${id}/4x.webp`,
  }
}

let sevenTVService = new DesktopSevenTVService()
function resetSevenTVService(): void {
  sevenTVService = new DesktopSevenTVService()
}

describe('sevenTVService', () => {
  beforeEach(() => {
    resetSevenTVService()
  })

  it('preserves distinct case-sensitive aliases in an incoming emote set', () => {
    const upper = makeEmote('upper', 'Pog')
    const lower = makeEmote('lower', 'pog')
    sevenTVService.handleEmoteSet('twitch', 'satont', [upper, lower])

    expect(sevenTVService.getEmotes('twitch', '#Satont')).toEqual([upper, lower])
    expect(sevenTVService.getEmote('twitch', '#Satont', 'Pog')).toBe(upper)
    expect(sevenTVService.getEmote('twitch', 'satont', 'pog')).toBe(lower)
    expect(sevenTVService.getEmote('twitch', 'satont', 'POG')).toBeUndefined()
    expect(sevenTVService.getEmote('twitch', 'satont', upper.name)).toBeUndefined()
  })

  it('adds an emote without replacing an alias with different casing', () => {
    const upper = makeEmote('upper', 'Pog')
    const lower = makeEmote('lower', 'pog')
    sevenTVService.handleEmoteSet('twitch', 'satont', [upper])
    sevenTVService.handleEmoteAdded('twitch', 'satont', lower)

    expect(sevenTVService.getEmotes('twitch', 'satont')).toEqual([upper, lower])
    expect(sevenTVService.getEmote('twitch', 'satont', 'Pog')).toBe(upper)
    expect(sevenTVService.getEmote('twitch', 'satont', 'pog')).toBe(lower)
  })

  it('preserves casing and removes the previous alias on rename', () => {
    const renamed = makeEmote('renamed', 'Before')
    const lower = makeEmote('lower', 'pog')
    sevenTVService.handleEmoteSet('twitch', 'satont', [renamed, lower])
    sevenTVService.handleEmoteUpdated('twitch', 'satont', renamed.id, 'Pog')

    expect(sevenTVService.getEmote('twitch', 'satont', 'Before')).toBeUndefined()
    expect(sevenTVService.getEmote('twitch', 'satont', 'Pog')).toMatchObject({
      id: renamed.id,
      alias: 'Pog',
    })
    expect(sevenTVService.getEmote('twitch', 'satont', 'pog')).toBe(lower)
    expect(sevenTVService.getEmotes('twitch', 'satont')).toHaveLength(2)
  })

  it('updates only the exact alias during a case-only rename', () => {
    const upper = makeEmote('upper', 'Pog')
    const lower = makeEmote('lower', 'pog')
    sevenTVService.handleEmoteSet('twitch', 'satont', [upper, lower])
    sevenTVService.handleEmoteUpdated('twitch', 'satont', upper.id, 'POG')

    expect(sevenTVService.getEmote('twitch', 'satont', 'Pog')).toBeUndefined()
    expect(sevenTVService.getEmote('twitch', 'satont', 'POG')).toMatchObject({
      id: upper.id,
      alias: 'POG',
    })
    expect(sevenTVService.getEmote('twitch', 'satont', 'pog')).toBe(lower)
    expect(sevenTVService.getEmotes('twitch', 'satont')).toHaveLength(2)
  })

  it('removes an emote by ID without removing an alias with different casing', () => {
    const upper = makeEmote('upper', 'Pog')
    const lower = makeEmote('lower', 'pog')
    sevenTVService.handleEmoteSet('twitch', 'satont', [upper, lower])
    sevenTVService.handleEmoteRemoved('twitch', 'satont', upper.id)

    expect(sevenTVService.getEmote('twitch', 'satont', 'Pog')).toBeUndefined()
    expect(sevenTVService.getEmote('twitch', 'satont', 'pog')).toBe(lower)
    expect(sevenTVService.getEmotes('twitch', 'satont')).toEqual([lower])
  })

  it('sends optional Twitch platformUserId to backend', async () => {
    const messages: DesktopToBackendMessage[] = []
    sevenTVService.sendToBackend = mock((message: DesktopToBackendMessage) => {
      messages.push(message)
    })

    await sevenTVService.subscribeToChannel('twitch', 'satont', ['Satont'], '12345')

    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual({
      channelId: 'satont',
      platform: 'twitch',
      platformUserId: '12345',
      type: 'seventv_subscribe',
    })
  })

  it('preserves platformUserId in subscriptions for reconnect', async () => {
    sevenTVService.sendToBackend = mock(() => {})

    await sevenTVService.subscribeToChannel('twitch', 'satont', ['Satont'], '12345')

    expect(sevenTVService.getSubscribedChannels()).toEqual([
      {
        channelId: 'satont',
        platform: 'twitch',
        platformUserId: '12345',
      },
    ])
    expect(sevenTVService.getLookupChannelIds('twitch', 'Satont')).toEqual(['satont', 'Satont'])
  })

  it('clears stale platformUserId on later subscribe without one', async () => {
    sevenTVService.sendToBackend = mock(() => {})

    await sevenTVService.subscribeToChannel('twitch', 'satont', ['Satont'], '12345')
    await sevenTVService.subscribeToChannel('twitch', 'satont', ['Satont'])

    expect(sevenTVService.getSubscribedChannels()).toEqual([
      {
        channelId: 'satont',
        platform: 'twitch',
        platformUserId: undefined,
      },
    ])
  })

  it('retains a shared channel until both own and watched subscriptions release it', async () => {
    const messages: DesktopToBackendMessage[] = []
    sevenTVService.sendToBackend = (message) => {
      messages.push(message)
    }
    await sevenTVService.subscribeToChannel('kick', '3195252', ['Satont'], undefined, 'own:kick')
    await sevenTVService.subscribeToChannel('kick', '3195252', ['satont'], undefined, 'watched:one')
    await sevenTVService.unsubscribeFromChannel('kick', 'satont', 'watched:one')
    expect(sevenTVService.getSubscribedChannels()).toHaveLength(1)
    expect(messages.some((message) => message.type === 'seventv_unsubscribe')).toBe(false)
    await sevenTVService.unsubscribeFromChannel('kick', 'satont', 'own:kick')
    expect(sevenTVService.getSubscribedChannels()).toEqual([])
    expect(messages.at(-1)).toEqual({
      type: 'seventv_unsubscribe',
      platform: 'kick',
      channelId: '3195252',
    })
  })

  it('does not resubscribe late emote data after its final owner has closed', async () => {
    sevenTVService.sendToBackend = () => {}
    await sevenTVService.subscribeToChannel('twitch', 'closed', [], undefined, 'watched:closed')
    await sevenTVService.unsubscribeFromChannel('twitch', 'closed', 'watched:closed')
    sevenTVService.handleEmoteSet('twitch', 'closed', [])
    expect(sevenTVService.getSubscribedChannels()).toEqual([])
  })
})
