import { expect, test } from 'bun:test'

import { createTestRoot, type TestRenderer } from '@gpuix/react/testing'

import { MessageModerationRail } from '../src/gpuix/components/MessageModerationRail'
import type { ModerationDragAction } from '../src/views/main/utils/moderation-drag'

const ROW_HEIGHT = 40
const Y = ROW_HEIGHT / 2

interface RailOptions {
  rowHovered?: boolean
  messageDeleted?: boolean
  opacity?: number
}

function renderRail({ rowHovered = true, messageDeleted, opacity = 1 }: RailOptions = {}) {
  const testRoot = createTestRoot({ width: 600, height: 200 })
  const actions: ModerationDragAction[] = []
  testRoot.render(
    <div style={{ position: 'relative', width: 600, height: ROW_HEIGHT, opacity }}>
      <MessageModerationRail
        platform="twitch"
        messageDeleted={messageDeleted}
        rowHovered={rowHovered}
        onModerate={(action) => actions.push(action)}
      />
    </div>,
  )
  testRoot.renderer.flush()
  return { ...testRoot, actions }
}

function drag(renderer: TestRenderer, fromX: number, toX: number) {
  renderer.nativeSimulateMouseMove(fromX, Y)
  renderer.nativeSimulateMouseDown(fromX, Y)
  renderer.nativeSimulateMouseMove((fromX + toX) / 2, Y, 0)
  renderer.nativeSimulateMouseMove(toX, Y, 0)
  renderer.nativeSimulateMouseUp(toX, Y)
}

// x = 5..8 is the painted grip line; it used to swallow the press.
for (const rowHovered of [false, true]) {
  for (const x of [1, 6, 7, 12]) {
    test(`the rail grabs at x=${x} (row hovered: ${rowHovered})`, () => {
      const { renderer, actions, unmount } = renderRail({ rowHovered })
      drag(renderer, x, x + 50)
      unmount()
      expect(actions.map((action) => action.action)).toEqual(['delete_message'])
    })
  }
}

test('a faded (moderated) row keeps the whole rail grabbable', () => {
  const { renderer, actions, unmount } = renderRail({ opacity: 0.48 })
  drag(renderer, 6, 56)
  unmount()
  expect(actions.map((action) => action.action)).toEqual(['delete_message'])
})

test('a release outside the window disarms the gesture', () => {
  const { renderer, actions, unmount } = renderRail()
  renderer.nativeSimulateMouseMove(6, Y)
  renderer.nativeSimulateMouseDown(6, Y)
  renderer.nativeSimulateMouseMove(200, Y, 0)
  // The button came up outside the window: the next move arrives unpressed.
  renderer.nativeSimulateMouseMove(220, Y)
  renderer.nativeSimulateMouseUp(220, Y)
  expect(actions).toEqual([])

  drag(renderer, 6, 56)
  unmount()
  expect(actions.map((action) => action.action)).toEqual(['delete_message'])
})

test('a deleted message offers no second delete but still times out', () => {
  const { renderer, actions, unmount } = renderRail({ messageDeleted: true })
  drag(renderer, 6, 56)
  expect(actions).toEqual([])

  drag(renderer, 6, 136)
  unmount()
  expect(actions).toEqual([{ action: 'timeout', durationSeconds: 300, label: 'Timeout 5m' }])
})
