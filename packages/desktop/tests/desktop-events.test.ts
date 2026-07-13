import { expect, test } from 'bun:test'

import { createDesktopEvents } from '../src/views/main/services/desktop-events'

test('converts event timestamps and returns the Wails subscription cleanup', () => {
  let listener: ((event: { data: unknown }) => void) | undefined
  let cleanedUp = false
  const events = createDesktopEvents({
    On: (_name, callback) => {
      listener = callback
      return () => {
        cleanedUp = true
      }
    },
  })
  let received: unknown

  const unsubscribe = events.on('chat_event', (event) => {
    received = event
  })
  listener?.({
    data: {
      id: 'event-1',
      platform: 'kick',
      type: 'follow',
      user: { id: 'viewer-1', displayName: 'Viewer' },
      data: {},
      timestamp: '2026-07-12T14:30:00.000Z',
    },
  })
  unsubscribe()

  expect(received).toMatchObject({ id: 'event-1' })
  expect((received as { timestamp: unknown }).timestamp).toBeInstanceOf(Date)
  expect((received as { timestamp: Date }).timestamp.toISOString()).toBe('2026-07-12T14:30:00.000Z')
  expect(cleanedUp).toBe(true)
})
