import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { DesktopSevenTVService } from '@desktop/seventv'
import type { DesktopToBackendMessage } from '@twirchat/shared'

let sevenTVService = new DesktopSevenTVService()
function resetSevenTVService(): void {
  sevenTVService = new DesktopSevenTVService()
}

describe('sevenTVService', () => {
  beforeEach(() => {
    resetSevenTVService()
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
