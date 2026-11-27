import { expect, test } from 'bun:test'

import { combinedChannelViewers, type ViewerStatus } from '../src/gpuix/state/channel-viewers'

function statuses(entries: Record<string, ViewerStatus>): Map<string, ViewerStatus> {
  return new Map(Object.entries(entries))
}

const twitch = { platform: 'twitch', channelSlug: 'satont' }
const kick = { platform: 'kick', channelSlug: 'satont' }
const other = { platform: 'kick', channelSlug: 'oceanofapathy' }

test('viewers of every live source are summed', () => {
  expect(
    combinedChannelViewers(
      [twitch, other],
      statuses({
        'twitch:satont': { isLive: true, viewerCount: 1200 },
        'kick:oceanofapathy': { isLive: true, viewerCount: 34 },
      }),
    ),
  ).toEqual({ viewers: 1234, liveCount: 2 })
})

test('the same channel on two platforms counts once', () => {
  expect(
    combinedChannelViewers(
      [twitch, kick],
      statuses({
        'twitch:satont': { isLive: true, viewerCount: 900 },
        'kick:satont': { isLive: true, viewerCount: 90 },
      }),
    ),
  ).toEqual({ viewers: 900, liveCount: 1 })
})

test('offline sources are skipped and no live source reads as no total', () => {
  expect(
    combinedChannelViewers(
      [twitch, other],
      statuses({ 'twitch:satont': { isLive: false, viewerCount: 5 } }),
    ),
  ).toBeNull()
  expect(combinedChannelViewers([], statuses({}))).toBeNull()
})

test('platforms without viewer counts still count as live', () => {
  expect(
    combinedChannelViewers(
      [
        { platform: 'youtube', channelSlug: 'streamx' },
        { platform: 'twitch', channelSlug: 'satont' },
      ],
      statuses({
        'youtube:streamx': { isLive: true },
        'twitch:satont': { isLive: true, viewerCount: 12 },
      }),
    ),
  ).toEqual({ viewers: 12, liveCount: 1 })
})
