import { expect, test } from 'bun:test'

import { initializeManagedRenderer } from '../src/gpuix/managed-renderer'

test('managed init preserves renderer identity and calls native prototype instead of stdin wrapper', () => {
  const options = { title: 'Managed QA', width: 320, height: 240 }
  const calls: { receiver: object; options: unknown }[] = []
  const prototype = {
    init(this: object, received: unknown) {
      calls.push({ receiver: this, options: received })
    },
  }
  const renderer = Object.assign(Object.create(prototype), {
    init() {
      throw new Error('SDK stdin automation wrapper must not run')
    },
    marker: Symbol('exact renderer identity'),
  })
  initializeManagedRenderer(renderer, options)
  expect(calls[0]?.receiver).toBe(renderer)
  expect(calls[0]?.options).toBe(options)
  expect(Object.getPrototypeOf(renderer)).toBe(prototype)
})

test('missing native prototype init fails closed without calling an own fallback', () => {
  let fallbackCalls = 0
  const renderer = {
    init() {
      fallbackCalls++
    },
  }
  expect(() => initializeManagedRenderer(renderer, {})).toThrow('prototype does not provide init')
  expect(() => initializeManagedRenderer(Object.create(null), {})).toThrow(
    'prototype does not provide init',
  )
  expect(fallbackCalls).toBe(0)
})
