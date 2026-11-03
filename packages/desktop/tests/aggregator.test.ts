import { describe, expect, test } from 'bun:test'

import { ChatAggregator } from '@desktop/chat/aggregator'
import { BasePlatformAdapter } from '@desktop/platforms/base-adapter'
import type { ChatClear, RoomState } from '@twirchat/shared/channel-tools'
import type {
  ModerationOutcome,
  NormalizedChatMessage,
  NormalizedEvent,
} from '@twirchat/shared/types'

import { literal, required } from './fixture-values'

class MockAdapter extends BasePlatformAdapter {
  readonly platform = literal('kick')

  async connect(_channelSlug: string): Promise<void> {
    this.emit('status', {
      mode: 'anonymous',
      platform: 'kick',
      status: 'connected',
    })
  }

  async disconnect(): Promise<void> {
    this.emit('status', {
      mode: 'anonymous',
      platform: 'kick',
      status: 'disconnected',
    })
  }

  async sendMessage(_channelId: string, _text: string): Promise<void> {}

  simulateMessage(msg: NormalizedChatMessage): void {
    this.emit('message', msg)
  }

  simulateEvent(event: NormalizedEvent): void {
    this.emit('event', event)
  }

  simulateModeration(outcome: ModerationOutcome): void {
    this.emit('moderation', outcome)
  }
  simulateRoomState(state: RoomState): void {
    this.emit('room_state', state)
  }
  simulateClear(clear: ChatClear): void {
    this.emit('chat_clear', clear)
  }
}

function makeMessage(id: string): NormalizedChatMessage {
  return {
    author: {
      avatarUrl: 'https://files.kick.com/images/user/1/profile.webp',
      badges: [],
      displayName: 'User',
      id: 'user1',
    },
    channelId: 'test-channel',
    emotes: [],
    id,
    platform: 'kick',
    text: `Message ${id}`,
    timestamp: new Date(),
    type: 'message',
  }
}

describe('ChatAggregator', () => {
  test('deduplicates source-aware identities without dropping equal IDs in other channels or platforms', () => {
    const aggregator = new ChatAggregator(3)
    const incoming = makeMessage('same-id')
    aggregator.injectMessage(incoming)
    aggregator.injectMessage({ ...incoming, channelId: '#TEST-CHANNEL' })
    aggregator.injectMessage({ ...incoming, channelId: 'other' })
    aggregator.injectMessage({ ...incoming, platform: 'twitch' })
    expect(aggregator.getRecentMessages()).toHaveLength(3)
    aggregator.injectMessage(makeMessage('new-id'))
    aggregator.injectMessage(incoming)
    expect(aggregator.getRecentMessages().at(-1)?.id).toBe('same-id')
    expect(aggregator.getRecentMessages()).toHaveLength(3)
  })

  test('keeps case-sensitive YouTube channel IDs distinct', () => {
    const aggregator = new ChatAggregator()
    aggregator.injectMessage({ ...makeMessage('id'), platform: 'youtube', channelId: 'UCa' })
    aggregator.injectMessage({ ...makeMessage('id'), platform: 'youtube', channelId: 'UCA' })
    expect(aggregator.getRecentMessages()).toHaveLength(2)
  })

  test('applies backend enrichment before live dispatch and retained history snapshots', () => {
    const aggregator = new ChatAggregator(500, (message) => ({
      ...message,
      text: `enriched:${message.text}`,
    }))
    const received: NormalizedChatMessage[] = []
    aggregator.onMessage((message) => received.push(message))
    const adapter = new MockAdapter()
    aggregator.registerAdapter(adapter)
    adapter.simulateMessage(makeMessage('adapter'))
    aggregator.injectMessage(makeMessage('injected'))
    expect(received.map((message) => message.text)).toEqual([
      'enriched:Message adapter',
      'enriched:Message injected',
    ])
    expect(aggregator.getRecentMessages()).toEqual(received)
  })
  test('forwards remote moderation and room-state events and isolates channel clears', () => {
    const aggregator = new ChatAggregator()
    const adapter = new MockAdapter()
    aggregator.registerAdapter(adapter)
    const moderation: ModerationOutcome[] = []
    const states: RoomState[] = []
    const clears: ChatClear[] = []
    const stopModeration = aggregator.onModeration((value) => moderation.push(value))
    const stopRoom = aggregator.onRoomState((value) => states.push(value))
    const stopClear = aggregator.onChatClear((value) => clears.push(value))
    adapter.simulateMessage(makeMessage('cleared'))
    adapter.simulateMessage({ ...makeMessage('retained'), channelId: 'other-channel' })
    const outcome: ModerationOutcome = {
      platform: 'kick',
      channelId: 'test-channel',
      action: 'delete_message',
      messageId: 'cleared',
    }
    const state: RoomState = { platform: 'kick', channelId: 'test-channel', slowSeconds: 10 }
    const clear: ChatClear = { platform: 'kick', channelId: 'test-channel' }
    adapter.simulateModeration(outcome)
    adapter.simulateRoomState(state)
    adapter.simulateClear(clear)
    expect(moderation).toEqual([outcome])
    expect(states).toEqual([state])
    expect(clears).toEqual([clear])
    expect(aggregator.getRecentMessages().map((message) => message.id)).toEqual(['retained'])
    stopModeration()
    stopRoom()
    stopClear()
    adapter.simulateModeration(outcome)
    adapter.simulateRoomState(state)
    adapter.simulateClear(clear)
    expect(moderation).toHaveLength(1)
    expect(states).toHaveLength(1)
    expect(clears).toHaveLength(1)
  })
  test('collects messages from adapter', () => {
    const aggregator = new ChatAggregator()
    const adapter = new MockAdapter()
    aggregator.registerAdapter(adapter)

    const received: NormalizedChatMessage[] = []
    aggregator.onMessage((msg) => received.push(msg))

    adapter.simulateMessage(makeMessage('1'))
    adapter.simulateMessage(makeMessage('2'))

    expect(received.length).toBe(2)
    expect(required(received[0]).id).toBe('1')
    expect(required(received[0]).author.avatarUrl).toBe(
      'https://files.kick.com/images/user/1/profile.webp',
    )
  })

  test('deduplicates messages with same id', () => {
    const aggregator = new ChatAggregator()
    const adapter = new MockAdapter()
    aggregator.registerAdapter(adapter)

    const received: NormalizedChatMessage[] = []
    aggregator.onMessage((msg) => received.push(msg))

    const msg = makeMessage('dup-1')
    adapter.simulateMessage(msg)
    adapter.simulateMessage(msg) // Дубликат

    expect(received.length).toBe(1)
  })

  test('ring buffer limits size', () => {
    const aggregator = new ChatAggregator(5) // Буфер 5 сообщений
    const adapter = new MockAdapter()
    aggregator.registerAdapter(adapter)

    for (let i = 0; i < 10; i++) {
      adapter.simulateMessage(makeMessage(`msg-${i}`))
    }

    const recent = aggregator.getRecentMessages()
    expect(recent.length).toBe(5)
    // Должны остаться последние 5
    expect(required(recent[recent.length - 1]).id).toBe('msg-9')
  })

  test('onMessage unsubscribe works', () => {
    const aggregator = new ChatAggregator()
    const adapter = new MockAdapter()
    aggregator.registerAdapter(adapter)

    const received: string[] = []
    const unsub = aggregator.onMessage((msg) => received.push(msg.id))

    adapter.simulateMessage(makeMessage('a'))
    unsub()
    adapter.simulateMessage(makeMessage('b'))

    expect(received).toEqual(['a'])
  })

  test('emits events', () => {
    const aggregator = new ChatAggregator()
    const adapter = new MockAdapter()
    aggregator.registerAdapter(adapter)

    const events: NormalizedEvent[] = []
    aggregator.onEvent((e) => events.push(e))

    adapter.simulateEvent({
      data: {},
      id: 'ev1',
      platform: 'kick',
      timestamp: new Date(),
      type: 'follow',
      user: { displayName: 'Follower', id: 'u1' },
    })

    expect(events.length).toBe(1)
    expect(required(events[0]).type).toBe('follow')
  })
})
