import { expect, test } from 'bun:test'
import { publicChannelURL } from '../src/views/main/utils/public-channel-url'

test('builds exact HTTPS URLs for supported public channel names', () => {
  expect(publicChannelURL('twitch', 'Satont')).toBe('https://www.twitch.tv/Satont')
  expect(publicChannelURL('kick', 'satont')).toBe('https://kick.com/satont')
  expect(publicChannelURL('youtube', '@TwirChat')).toBe('https://www.youtube.com/@TwirChat')
})

test('rejects unsafe or unsupported public channel names', () => {
  expect(publicChannelURL('twitch', '../unsafe')).toBeUndefined()
  expect(publicChannelURL('youtube', 'not-a-handle')).toBeUndefined()
})
