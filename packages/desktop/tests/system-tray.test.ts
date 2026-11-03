import { expect, test } from 'bun:test'

import { createSystemTray, type TrayWindow } from '../src/gpuix/state/system-tray'

function fixture() {
  const calls: Array<{ id: string; enabled: boolean; notifications: boolean }> = []
  const activated: string[] = []
  const errors: unknown[] = []
  const open = new Set<string>()
  const events = new Map<string, unknown>()
  let windows: TrayWindow[] = []
  let notifications = true
  let quits = 0
  const tray = createSystemTray({
    windows: () => windows,
    notificationsEnabled: () => notifications,
    async toggleNotifications() {
      notifications = !notifications
    },
    async quit() {
      quits++
    },
    failed: (error) => errors.push(error),
  })
  return {
    calls,
    activated,
    errors,
    open,
    events,
    tray,
    setWindows(ids: string[]) {
      windows = ids.map((id) => ({
        id,
        isOpen: () => open.has(id),
        async configure(enabled, notifications) {
          calls.push({ id, enabled, notifications })
        },
        takeEvents() {
          const current = events.get(id) ?? []
          events.delete(id)
          return current
        },
        activate: () => {
          activated.push(id)
        },
      }))
      for (const id of ids) open.add(id)
    },
    notifications: () => notifications,
    quits: () => quits,
  }
}

test('one tray follows the main window and updates its notification menu only when needed', async () => {
  const f = fixture()
  f.setWindows(['child', 'main'])
  await f.tray.refresh()
  await f.tray.refresh()
  expect(f.calls).toEqual([{ id: 'main', enabled: true, notifications: true }])
  f.events.set('main', ['notifications'])
  await f.tray.refresh()
  expect(f.notifications()).toBe(false)
  await f.tray.refresh()
  expect(f.calls.at(-1)).toEqual({ id: 'main', enabled: true, notifications: false })
  await f.tray.stop()
})

test('closing the main window transfers tray ownership to a remaining window without calling a closed renderer', async () => {
  const f = fixture()
  f.setWindows(['main', 'child'])
  await f.tray.refresh()
  f.open.delete('main')
  await f.tray.refresh()
  expect(f.calls.map((call) => call.id)).toEqual(['main', 'child'])
  f.events.set('child', ['show', 'quit'])
  await f.tray.refresh()
  expect(f.activated).toEqual(['child'])
  expect(f.quits()).toBe(1)
  f.open.clear()
  await f.tray.refresh()
  expect(f.errors).toEqual([])
  await f.tray.stop()
})

test('switching to a newly-opened main window disposes the old tray before creating its replacement', async () => {
  const f = fixture()
  f.setWindows(['child'])
  await f.tray.refresh()
  f.setWindows(['child', 'main'])
  await f.tray.refresh()
  expect(f.calls).toEqual([
    { id: 'child', enabled: true, notifications: true },
    { id: 'child', enabled: false, notifications: false },
    { id: 'main', enabled: true, notifications: true },
  ])
  await f.tray.stop()
  await f.tray.refresh()
  expect(f.calls.at(-1)).toEqual({ id: 'main', enabled: false, notifications: false })
})

test('invalid native events fail once without executing a command or looping on every poll', async () => {
  const f = fixture()
  f.setWindows(['main'])
  f.events.set('main', ['shell command'])
  await f.tray.refresh()
  await f.tray.refresh()
  expect(f.errors).toHaveLength(1)
  expect(f.activated).toEqual([])
  expect(f.quits()).toBe(0)
  await f.tray.stop()
})
