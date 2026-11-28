import { expect, test } from 'bun:test'

import { createDesktopExit } from '../src/services/desktop-exit'

test('update waits for window cleanup and shares the normal shutdown', async () => {
  const closed = Promise.withResolvers<void>()
  const stopped = Promise.withResolvers<void>()
  const exited = Promise.withResolvers<void>()
  const calls: string[] = []
  const owner = createDesktopExit({
    closeWindows: async () => {
      calls.push('windows')
      closed.resolve()
    },
    shutdown: async () => {
      calls.push('backend')
      await stopped.promise
    },
    exit: () => {
      calls.push('exit')
      exited.resolve()
    },
    updateDelayMs: 0,
    updateDeadlineMs: 1000,
  })
  owner.scheduleUpdateExit()
  owner.scheduleUpdateExit()
  await closed.promise
  expect(calls).toEqual(['windows'])
  owner.quit()
  owner.quit()
  await Promise.resolve()
  expect(calls).toEqual(['windows', 'backend'])
  stopped.resolve()
  await exited.promise
  expect(calls).toEqual(['windows', 'backend', 'exit'])
})

test('an update adds a deadline to an already-running quit without reopening windows', async () => {
  const stopped = Promise.withResolvers<void>()
  const exited = Promise.withResolvers<void>()
  const calls: string[] = []
  const owner = createDesktopExit({
    closeWindows: async () => {
      calls.push('windows')
    },
    shutdown: () => {
      calls.push('backend')
      return stopped.promise
    },
    exit: () => {
      calls.push('exit')
      exited.resolve()
    },
    updateDelayMs: 0,
    updateDeadlineMs: 25,
  })
  owner.quit()
  await Promise.resolve()
  expect(calls).toEqual(['backend'])
  owner.scheduleUpdateExit()
  await exited.promise
  stopped.resolve()
  await Bun.sleep(0)
  expect(calls).toEqual(['backend', 'exit'])
})

test('a stalled window close leaves time for backend shutdown before update exit', async () => {
  const closed = Promise.withResolvers<void>()
  const exited = Promise.withResolvers<void>()
  const calls: string[] = []
  const owner = createDesktopExit({
    closeWindows: () => {
      calls.push('windows')
      return closed.promise
    },
    shutdown: async () => {
      calls.push('backend')
    },
    exit: () => {
      calls.push('exit')
      exited.resolve()
    },
    updateDelayMs: 0,
    windowDeadlineMs: 10,
    updateDeadlineMs: 1000,
  })
  owner.scheduleUpdateExit()
  try {
    await exited.promise
    expect(calls).toEqual(['windows', 'backend', 'exit'])
  } finally {
    closed.resolve()
  }
})

test('update still exits when window close and shutdown reject', async () => {
  const exited = Promise.withResolvers<void>()
  const calls: string[] = []
  const owner = createDesktopExit({
    closeWindows: async () => {
      calls.push('windows')
      throw new Error('layout save failed')
    },
    shutdown: async () => {
      calls.push('backend')
      throw new Error('backend shutdown failed')
    },
    exit: () => {
      calls.push('exit')
      exited.resolve()
    },
    updateDelayMs: 0,
    updateDeadlineMs: 1000,
  })
  owner.scheduleUpdateExit()
  await exited.promise
  expect(calls).toEqual(['windows', 'backend', 'exit'])
})
