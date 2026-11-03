import { expect, test } from 'bun:test'

import { createDragMotion, type DragPoint } from '../src/gpuix/hooks/use-drag-motion'

test('rapid pointer movement runs once with the latest position', async () => {
  const positions: DragPoint[] = []
  const motion = createDragMotion((point) => positions.push(point))
  try {
    for (let x = 0; x < 100; x++) motion.schedule({ x, y: 50 })
    expect(positions).toEqual([])
    await Bun.sleep(30)
    expect(positions).toEqual([{ x: 99, y: 50 }])
  } finally {
    motion.cancel()
  }
})

test('release flushes the final position once and removes the pending timer', async () => {
  const positions: DragPoint[] = []
  const motion = createDragMotion((point) => positions.push(point))
  try {
    motion.schedule({ x: 10, y: 20 })
    motion.schedule({ x: 30, y: 40 })
    motion.flush()
    expect(positions).toEqual([{ x: 30, y: 40 }])
    await Bun.sleep(30)
    expect(positions).toEqual([{ x: 30, y: 40 }])
  } finally {
    motion.cancel()
  }
})

test('cancelled pointer work cannot apply to a later gesture', async () => {
  const positions: DragPoint[] = []
  const motion = createDragMotion((point) => positions.push(point))
  try {
    motion.schedule({ x: 100, y: 200 })
    motion.cancel()
    motion.flush()
    expect(positions).toEqual([])
    motion.schedule({ x: 3, y: 4 })
    await Bun.sleep(30)
    expect(positions).toEqual([{ x: 3, y: 4 }])
    motion.cancel()
    motion.cancel()
    expect(positions).toHaveLength(1)
  } finally {
    motion.cancel()
  }
})

test('a pending move uses the committed handler without restarting its timer', async () => {
  const previous: DragPoint[] = []
  const latest: DragPoint[] = []
  const motion = createDragMotion((point) => previous.push(point))
  try {
    motion.schedule({ x: 4, y: 8 })
    motion.setHandler((point) => latest.push(point))
    await Bun.sleep(30)
    expect(previous).toEqual([])
    expect(latest).toEqual([{ x: 4, y: 8 }])
  } finally {
    motion.cancel()
  }
})
