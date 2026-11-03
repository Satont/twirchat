import { expect, test } from 'bun:test'

import { createRendererState, registerEventHandler, type NativeRenderer } from '@gpuix/native/host'

import { observeWindowScale, readWindowScale } from '../src/services/window-scale'

type ScaleRenderer = NativeRenderer & { getWindowScaleFactor(): number }

function fixture() {
  let scale = 1
  const renderer: ScaleRenderer = {
    applyBatch: () => [],
    getWindowScaleFactor: () => scale,
  }
  const state = createRendererState(renderer)
  const root = state.attach()
  return {
    renderer,
    state,
    root,
    setScale: (value: number) => {
      scale = value
    },
  }
}

test('a scale change between initial read and subscription is observed without polling', () => {
  const f = fixture()
  expect(readWindowScale(f.renderer)).toBe(1)
  f.setScale(2)
  const seen: number[] = []
  const stop = observeWindowScale(f.renderer, (scale) => seen.push(scale))
  expect(seen).toEqual([2])
  f.setScale(1.5)
  expect(f.state.dispatch({ elementId: 0, eventType: 'windowScaleChange' })).toBe(true)
  expect(seen).toEqual([2, 1.5])
  stop()
  expect(f.state.dispatch({ elementId: 0, eventType: 'windowScaleChange' })).toBe(false)
  expect(f.root.eventHandlers.size).toBe(0)
  f.root.detach()
})

test('a retired observer cannot remove its replacement or deliver already queued scale events', () => {
  const f = fixture()
  const oldSeen: number[] = []
  const newSeen: number[] = []
  const stopOld = observeWindowScale(f.renderer, (scale) => oldSeen.push(scale))
  const oldCallback = f.root.eventHandlers.get(0)?.get('windowScaleChange')
  const stopNew = observeWindowScale(f.renderer, (scale) => newSeen.push(scale))
  registerEventHandler(f.root.eventHandlers, 0, 'otherEvent', () => {})
  stopOld()
  f.setScale(2)
  oldCallback?.({ elementId: 0, eventType: 'windowScaleChange' })
  f.state.dispatch({ elementId: 0, eventType: 'windowScaleChange' })
  expect(oldSeen).toEqual([1])
  expect(newSeen).toEqual([1, 2])
  stopNew()
  expect(f.root.eventHandlers.get(0)?.has('otherEvent')).toBe(true)
  expect(f.root.eventHandlers.get(0)?.has('windowScaleChange')).toBe(false)
  f.root.detach()
})

test('scale observers stay independent across windows and root replacement', () => {
  const a = fixture()
  const b = fixture()
  const aSeen: number[] = [],
    bSeen: number[] = []
  const stopA = observeWindowScale(a.renderer, (scale) => aSeen.push(scale))
  const stopB = observeWindowScale(b.renderer, (scale) => bSeen.push(scale))
  a.setScale(2)
  a.state.dispatch({ elementId: 0, eventType: 'windowScaleChange' })
  expect(aSeen).toEqual([1, 2])
  expect(bSeen).toEqual([1])
  a.root.detach()
  const replacement = a.state.attach()
  const replacementSeen: number[] = []
  const stopReplacement = observeWindowScale(a.renderer, (scale) => replacementSeen.push(scale))
  stopA()
  a.setScale(1.25)
  a.state.dispatch({ elementId: 0, eventType: 'windowScaleChange' })
  expect(replacementSeen).toEqual([2, 1.25])
  stopReplacement()
  stopB()
  replacement.detach()
  b.root.detach()
})

test('missing or invalid scale capabilities fail before they reach image sizing', () => {
  expect(() => readWindowScale({ applyBatch: () => [] })).toThrow('Rebuild the native runtime')
  const f = fixture()
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    f.setScale(value)
    expect(() => readWindowScale(f.renderer)).toThrow()
  }
  f.root.detach()
})
