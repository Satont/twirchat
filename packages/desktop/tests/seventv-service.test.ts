import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { sevenTVService } from '@desktop/seventv'
import type { DesktopToBackendMessage } from '@twirchat/shared'

function resetSevenTVService(): void {
  ;(
    sevenTVService as unknown as {
      subscriptions: Map<string, unknown>
      emoteSets: Map<string, unknown>
      lookupToChannelKey: Map<string, unknown>
    }
  ).subscriptions.clear()
  ;(
    sevenTVService as unknown as {
      subscriptions: Map<string, unknown>
      emoteSets: Map<string, unknown>
      lookupToChannelKey: Map<string, unknown>
    }
  ).emoteSets.clear()
  ;(
    sevenTVService as unknown as {
      subscriptions: Map<string, unknown>
      emoteSets: Map<string, unknown>
      lookupToChannelKey: Map<string, unknown>
    }
  ).lookupToChannelKey.clear()
}

describe('sevenTVService', () => {
  beforeEach(() => {
    resetSevenTVService()
  })

  it('sends optional Twitch platformUserId to backend', async () => {
    const messages: DesktopToBackendMessage[] = []
    sevenTVService.sendToBackend = mock((message: unknown) => {
      messages.push(message as DesktopToBackendMessage)
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
})
