import { expect, test } from 'bun:test'

import {
  createSystemIntegration,
  registerWindowsNotificationHandler,
  type WindowsNotification,
} from '../src/services/system-integration'
import { required } from './fixture-values'

test('reads Wayland clipboard without logging or modifying its content', async () => {
  const calls: string[][] = []
  const integration = createSystemIntegration({
    platform: 'linux',
    wayland: true,
    exists: async () => true,
    run: async (command) => {
      calls.push(command)
      return { code: 0, output: 'secret-token' }
    },
  })
  expect(await integration.readClipboard()).toBe('secret-token')
  expect(calls).toEqual([['wl-paste', '-n']])
})

test('notification content stays in arguments, never interpolated into executable code', async () => {
  const calls: { command: string[]; input?: string }[] = []
  const run = async (command: string[], input?: string) => {
    calls.push({ command, input })
    return { code: 0, output: '' }
  }
  const title = '$(danger)'
  const body = '`danger` " text'
  const integration = createSystemIntegration({
    platform: 'linux',
    wayland: true,
    exists: async () => true,
    run,
  })
  await integration.notify({ title, body, sound: true })
  expect(required(calls[0]).command).toEqual([
    'notify-send',
    '--app-name=TwirChat',
    '--hint=boolean:suppress-sound:true',
    '--',
    title,
    body,
  ])
  expect(required(calls[1]).command).toEqual(['canberra-gtk-play', '-i', 'message-new-instant'])
  calls.length = 0
  const native: WindowsNotification[] = []
  await createSystemIntegration({
    platform: 'win32',
    wayland: false,
    exists: async () => true,
    run,
    nativeNotifyWindows: async (notification) => {
      native.push(notification)
    },
  }).notify({ title, body })
  expect(native).toEqual([{ title, body }])
  expect(calls).toEqual([])
})

test('sound-only notifications never invoke an OS banner helper', async () => {
  const calls: string[][] = []
  const integration = createSystemIntegration({
    platform: 'linux',
    wayland: true,
    exists: async () => true,
    run: async (command) => {
      calls.push(command)
      return { code: 0, output: '' }
    },
  })
  await integration.notify({ title: 'Highlight', body: 'Message', silent: true, sound: true })
  expect(calls).toEqual([['canberra-gtk-play', '-i', 'message-new-instant']])
  calls.length = 0
  await integration.notify({ title: 'Highlight', body: 'Message', silent: true })
  expect(calls).toEqual([])
})

test('Windows uses the existing native tray and one separate sound path', async () => {
  const notifications: WindowsNotification[] = []
  const calls: { command: string[]; input?: string }[] = []
  const integration = createSystemIntegration({
    platform: 'win32',
    wayland: false,
    exists: async () => true,
    nativeNotifyWindows: async (notification) => {
      notifications.push(notification)
    },
    run: async (command, input) => {
      calls.push({ command, input })
      return { code: 0, output: '' }
    },
  })
  await integration.notify({ title: 'Mention', body: 'Hello', sound: true })
  expect(notifications).toEqual([{ title: 'Mention', body: 'Hello' }])
  expect(calls).toHaveLength(1)
  const sound = required(calls[0])
  expect(sound.command.slice(0, 4)).toEqual([
    'powershell',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
  ])
  expect(sound.command.join(' ')).not.toContain('NotifyIcon')
  expect(sound.command.join(' ')).not.toContain('ShowBalloonTip')
  expect(JSON.parse(required(sound.input))).toEqual({ soundPath: '' })
})

test('Windows sound-only alerts do not require or create a tray', async () => {
  const calls: { command: string[]; input?: string }[] = []
  const integration = createSystemIntegration({
    platform: 'win32',
    wayland: false,
    exists: async () => true,
    nativeNotifyWindows: async () => {
      throw new Error('Desktop delivery must not be invoked for sound-only alerts.')
    },
    run: async (command, input) => {
      calls.push({ command, input })
      return { code: 0, output: '' }
    },
  })
  const soundPath = String.raw`C:\sounds\$(danger) "mention".wav`
  await integration.notify({ title: 'Mention', body: 'Hello', silent: true, soundPath })
  expect(calls).toHaveLength(1)
  const sound = required(calls[0])
  expect(sound.command.join(' ')).not.toContain(soundPath)
  expect(JSON.parse(required(sound.input))).toEqual({ soundPath })
  calls.length = 0
  await integration.notify({ title: 'Mention', body: 'Hello', silent: true })
  expect(calls).toEqual([])
})

test('missing Windows custom sound files fail before invoking a sound helper', async () => {
  const calls: string[][] = []
  const paths: string[] = []
  const integration = createSystemIntegration({
    platform: 'win32',
    wayland: false,
    exists: async (path) => {
      paths.push(path)
      return false
    },
    run: async (command) => {
      calls.push(command)
      return { code: 0, output: '' }
    },
  })
  await expect(
    integration.notify({
      title: 'Mention',
      body: 'Hello',
      silent: true,
      soundPath: 'missing.wav',
    }),
  ).rejects.toThrow('sound file does not exist')
  expect(paths).toEqual(['missing.wav'])
  expect(calls).toEqual([])
})

test('Windows native failures propagate without invoking fallback icons or sounds', async () => {
  const calls: string[][] = []
  const integration = createSystemIntegration({
    platform: 'win32',
    wayland: false,
    exists: async () => true,
    nativeNotifyWindows: async () => {
      throw new Error('The native tray has closed.')
    },
    run: async (command) => {
      calls.push(command)
      return { code: 0, output: '' }
    },
  })
  await expect(
    integration.notify({ title: 'Mention', body: 'Hello', sound: true }),
  ).rejects.toThrow('The native tray has closed.')
  expect(calls).toEqual([])
})

test('Windows sound failures are reported without retrying desktop delivery', async () => {
  const notifications: WindowsNotification[] = []
  let soundAttempts = 0
  const integration = createSystemIntegration({
    platform: 'win32',
    wayland: false,
    exists: async () => true,
    nativeNotifyWindows: async (notification) => {
      notifications.push(notification)
    },
    run: async () => {
      soundAttempts++
      return { code: 1, output: '' }
    },
  })
  await expect(
    integration.notify({ title: 'Mention', body: 'Hello', sound: true }),
  ).rejects.toThrow('notification helper is unavailable')
  expect(notifications).toEqual([{ title: 'Mention', body: 'Hello' }])
  expect(soundAttempts).toBe(1)
})

test('Windows registration survives stale cleanup and reports unavailability after its owner closes', async () => {
  const notifications: WindowsNotification[] = []
  const handler = async (notification: WindowsNotification) => {
    notifications.push(notification)
  }
  const integration = createSystemIntegration({
    platform: 'win32',
    wayland: false,
    exists: async () => true,
    run: async () => {
      throw new Error('Native desktop notifications must not spawn a helper.')
    },
  })
  const offFirst = registerWindowsNotificationHandler(handler)
  const offSecond = registerWindowsNotificationHandler(handler)
  try {
    offFirst()
    await integration.notify({ title: 'a'.repeat(300), body: 'b'.repeat(3000) })
    expect(notifications).toEqual([{ title: 'a'.repeat(200), body: 'b'.repeat(2000) }])
    offSecond()
    await expect(integration.notify({ title: 'Mention', body: 'Hello' })).rejects.toThrow(
      'native Windows notification tray is unavailable',
    )
  } finally {
    offFirst()
    offSecond()
  }
})

test('macOS passes content as AppleScript arguments and plays a custom sound once', async () => {
  const calls: string[][] = []
  const title = '$(danger)'
  const body = '`danger` " text'
  const soundPath = '/sounds/mention.aiff'
  const integration = createSystemIntegration({
    platform: 'darwin',
    wayland: false,
    exists: async (path) => path === soundPath,
    run: async (command) => {
      calls.push(command)
      return { code: 0, output: '' }
    },
  })
  await integration.notify({ title, body, soundPath })
  expect(calls).toHaveLength(2)
  const banner = required(calls[0])
  expect(banner.slice(0, 2)).toEqual(['osascript', '-e'])
  expect(banner[2]).not.toContain(title)
  expect(banner.slice(3)).toEqual([title, body])
  expect(calls[1]).toEqual(['afplay', soundPath])
})

test('a failed macOS notification helper rejects without pretending it was delivered', async () => {
  const integration = createSystemIntegration({
    platform: 'darwin',
    wayland: false,
    exists: async () => true,
    run: async () => ({ code: 1, output: '' }),
  })
  await expect(integration.notify({ title: 'Mention', body: 'Hello' })).rejects.toThrow(
    'notification helper is unavailable',
  )
})
