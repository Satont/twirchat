import { describe, expect, test } from 'bun:test'
import type { ChatLayout, SplitConfig, WatchedChannel } from '@twirchat/shared/types'

function watchedChannelForSplit(
  split: SplitConfig,
  watchedChannels: WatchedChannel[],
): WatchedChannel | undefined {
  if (split.type !== 'channel' || !split.channelId) return undefined
  return watchedChannels.find((ch) => ch.id === split.channelId)
}

interface PaneInfo {
  size: number
}

function buildResizedLayout(layout: ChatLayout, paneInfos: PaneInfo[]): ChatLayout {
  const sizes = paneInfos.map((p) => p.size)
  const updatedSplits = layout.splits.map((split, i) => ({
    ...split,
    size: sizes[i] ?? split.size,
  }))
  return { ...layout, splits: updatedSplits }
}

function platformForSplit(
  split: SplitConfig,
  watchedChannels: WatchedChannel[],
): string | undefined {
  return watchedChannelForSplit(split, watchedChannels)?.platform as string | undefined
}

function channelNameForSplit(
  split: SplitConfig,
  watchedChannels: WatchedChannel[],
): string | undefined {
  return watchedChannelForSplit(split, watchedChannels)?.displayName
}

function makeWatchedChannel(overrides: Partial<WatchedChannel> = {}): WatchedChannel {
  return {
    id: 'twitch:streamer1',
    platform: 'twitch',
    channelSlug: 'streamer1',
    displayName: 'Streamer One',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeSplit(overrides: Partial<SplitConfig> = {}): SplitConfig {
  return { id: 'default', type: 'combined', size: 100, ...overrides }
}

function makeCombinedLayout(): ChatLayout {
  return { version: 1, mode: 'combined', splits: [makeSplit()] }
}

function makeSplitLayout(splits: SplitConfig[]): ChatLayout {
  return { version: 1, mode: 'split', splits }
}

describe('ChatSplitView – panel counting', () => {
  test('combined layout has exactly one panel', () => {
    const layout = makeCombinedLayout()
    expect(layout.splits).toHaveLength(1)
  })

  test('split layout exposes all configured panels', () => {
    const layout = makeSplitLayout([
      makeSplit({ id: 'p1', size: 50 }),
      makeSplit({ id: 'p2', size: 50 }),
    ])
    expect(layout.splits).toHaveLength(2)
  })

  test('three-panel layout contains three splits', () => {
    const layout = makeSplitLayout([
      makeSplit({ id: 'p1', size: 33 }),
      makeSplit({ id: 'p2', size: 33 }),
      makeSplit({ id: 'p3', size: 34 }),
    ])
    expect(layout.splits).toHaveLength(3)
  })
})

describe('watchedChannelForSplit()', () => {
  test('returns undefined for combined type', () => {
    const split = makeSplit({ type: 'combined' })
    expect(watchedChannelForSplit(split, [])).toBeUndefined()
  })

  test('returns undefined for channel type when no channelId', () => {
    const split = makeSplit({ type: 'channel' })
    expect(watchedChannelForSplit(split, [])).toBeUndefined()
  })

  test('returns undefined when channelId not in watchedChannels', () => {
    const split = makeSplit({ type: 'channel', channelId: 'twitch:unknown' })
    const channels = [makeWatchedChannel({ id: 'kick:other' })]
    expect(watchedChannelForSplit(split, channels)).toBeUndefined()
  })

  test('returns matching WatchedChannel by id', () => {
    const split = makeSplit({ type: 'channel', channelId: 'twitch:streamer1' })
    const channel = makeWatchedChannel({ id: 'twitch:streamer1' })
    const result = watchedChannelForSplit(split, [channel])
    expect(result).not.toBeUndefined()
    expect(result!.id).toBe('twitch:streamer1')
  })

  test('returns first match when multiple channels with same id', () => {
    const split = makeSplit({ type: 'channel', channelId: 'twitch:x' })
    const first = makeWatchedChannel({ id: 'twitch:x', displayName: 'First' })
    const second = makeWatchedChannel({ id: 'twitch:x', displayName: 'Second' })
    const result = watchedChannelForSplit(split, [first, second])
    expect(result!.displayName).toBe('First')
  })
})

describe('platformForSplit()', () => {
  test('returns undefined for combined split', () => {
    const split = makeSplit({ type: 'combined' })
    expect(platformForSplit(split, [])).toBeUndefined()
  })

  test('returns platform string for matched channel split', () => {
    const split = makeSplit({ type: 'channel', channelId: 'kick:ch1' })
    const channel = makeWatchedChannel({ id: 'kick:ch1', platform: 'kick' })
    expect(platformForSplit(split, [channel])).toBe('kick')
  })
})

describe('channelNameForSplit()', () => {
  test('returns undefined for combined split', () => {
    const split = makeSplit({ type: 'combined' })
    expect(channelNameForSplit(split, [])).toBeUndefined()
  })

  test('returns displayName for matched channel split', () => {
    const split = makeSplit({ type: 'channel', channelId: 'twitch:streamer1' })
    const channel = makeWatchedChannel({ id: 'twitch:streamer1', displayName: 'Streamer One' })
    expect(channelNameForSplit(split, [channel])).toBe('Streamer One')
  })

  test('returns undefined when channel not found', () => {
    const split = makeSplit({ type: 'channel', channelId: 'twitch:ghost' })
    expect(channelNameForSplit(split, [])).toBeUndefined()
  })
})

describe('buildResizedLayout()', () => {
  test('updates all split sizes from pane infos', () => {
    const layout = makeSplitLayout([
      makeSplit({ id: 'left', size: 50 }),
      makeSplit({ id: 'right', size: 50 }),
    ])

    const updated = buildResizedLayout(layout, [{ size: 30 }, { size: 70 }])

    expect(updated.splits[0]!.size).toBe(30)
    expect(updated.splits[1]!.size).toBe(70)
  })

  test('preserves split ids after resize', () => {
    const layout = makeSplitLayout([
      makeSplit({ id: 'alpha', size: 60 }),
      makeSplit({ id: 'beta', size: 40 }),
    ])

    const updated = buildResizedLayout(layout, [{ size: 40 }, { size: 60 }])

    expect(updated.splits[0]!.id).toBe('alpha')
    expect(updated.splits[1]!.id).toBe('beta')
  })

  test('preserves split type and channelId after resize', () => {
    const layout = makeSplitLayout([
      makeSplit({ id: 'ch', type: 'channel', channelId: 'kick:test', size: 50 }),
      makeSplit({ id: 'all', type: 'combined', size: 50 }),
    ])

    const updated = buildResizedLayout(layout, [{ size: 35 }, { size: 65 }])

    expect(updated.splits[0]!.channelId).toBe('kick:test')
    expect(updated.splits[0]!.type).toBe('channel')
    expect(updated.splits[1]!.type).toBe('combined')
  })

  test('preserves layout mode after resize', () => {
    const layout = makeSplitLayout([makeSplit({ id: 'a', size: 100 })])
    const updated = buildResizedLayout(layout, [{ size: 100 }])
    expect(updated.mode).toBe('split')
  })

  test('keeps original size when paneInfos array is shorter than splits', () => {
    const layout = makeSplitLayout([
      makeSplit({ id: 'a', size: 33 }),
      makeSplit({ id: 'b', size: 33 }),
      makeSplit({ id: 'c', size: 34 }),
    ])

    const updated = buildResizedLayout(layout, [{ size: 50 }, { size: 50 }])

    expect(updated.splits[0]!.size).toBe(50)
    expect(updated.splits[1]!.size).toBe(50)
    expect(updated.splits[2]!.size).toBe(34)
  })

  test('does not mutate original layout', () => {
    const layout = makeSplitLayout([
      makeSplit({ id: 'p', size: 70 }),
      makeSplit({ id: 'q', size: 30 }),
    ])

    buildResizedLayout(layout, [{ size: 20 }, { size: 80 }])

    expect(layout.splits[0]!.size).toBe(70)
    expect(layout.splits[1]!.size).toBe(30)
  })

  test('extract sizes array matches paneInfos order', () => {
    const layout = makeSplitLayout([
      makeSplit({ id: 'x', size: 50 }),
      makeSplit({ id: 'y', size: 50 }),
    ])

    const paneInfos = [{ size: 25 }, { size: 75 }]
    const updated = buildResizedLayout(layout, paneInfos)

    const extractedSizes = updated.splits.map((s) => s.size)
    expect(extractedSizes).toEqual([25, 75])
  })
})

describe('ChatLayout structural invariants', () => {
  test('all splits in a layout have unique ids', () => {
    const splits: SplitConfig[] = [
      makeSplit({ id: 'unique-1', size: 50 }),
      makeSplit({ id: 'unique-2', size: 50 }),
    ]
    const ids = splits.map((s) => s.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  test('split sizes in a layout approximately sum to 100', () => {
    const splits: SplitConfig[] = [
      makeSplit({ id: 'p1', size: 33 }),
      makeSplit({ id: 'p2', size: 33 }),
      makeSplit({ id: 'p3', size: 34 }),
    ]
    const total = splits.reduce((acc, s) => acc + s.size, 0)
    expect(total).toBe(100)
  })

  test('channel split type requires a channelId to be useful', () => {
    const splitWithChannel = makeSplit({ type: 'channel', channelId: 'twitch:x' })
    const splitWithout = makeSplit({ type: 'channel' })

    expect(splitWithChannel.channelId).toBeDefined()
    expect(splitWithout.channelId).toBeUndefined()
  })
})
