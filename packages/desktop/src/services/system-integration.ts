interface CommandResult {
  code: number
  output: string
}
export interface WindowsNotification {
  title: string
  body: string
}
type WindowsNotificationHandler = (notification: WindowsNotification) => Promise<void>

declare global {
  var __twirchatWindowsNotificationHandler: WindowsNotificationHandler | undefined
}

export function registerWindowsNotificationHandler(
  handler: WindowsNotificationHandler,
): () => void {
  const registration: WindowsNotificationHandler = (notification) => handler(notification)
  globalThis.__twirchatWindowsNotificationHandler = registration
  return () => {
    if (globalThis.__twirchatWindowsNotificationHandler === registration)
      globalThis.__twirchatWindowsNotificationHandler = undefined
  }
}

async function notifyWindows(notification: WindowsNotification): Promise<void> {
  const handler = globalThis.__twirchatWindowsNotificationHandler
  if (!handler) throw new Error('The native Windows notification tray is unavailable.')
  await handler(notification)
}

interface SystemIntegrationOptions {
  platform: NodeJS.Platform
  wayland: boolean
  run(command: string[], input?: string): Promise<CommandResult>
  exists(path: string): Promise<boolean>
  nativeNotifyWindows?: WindowsNotificationHandler
}

const WINDOWS_SOUND =
  '$ErrorActionPreference = "Stop"; $p = [Console]::In.ReadToEnd() | ConvertFrom-Json; if ($p.soundPath) { $s = New-Object System.Media.SoundPlayer([string]$p.soundPath); try { $s.PlaySync() } finally { $s.Dispose() } } else { [System.Media.SystemSounds]::Asterisk.Play(); Start-Sleep -Milliseconds 1000 }'
const MAC_NOTIFICATION =
  'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run'

export function createSystemIntegration(options: SystemIntegrationOptions) {
  async function first(commands: string[][], input?: string): Promise<string> {
    for (const command of commands) {
      try {
        // Try installed platform helpers in preference order.
        // eslint-disable-next-line no-await-in-loop
        const result = await options.run(command, input)
        if (result.code === 0) return result.output
      } catch {
        /* Try the next installed native helper. */
      }
    }
    throw new Error('The native clipboard or notification helper is unavailable.')
  }
  return {
    async readClipboard(): Promise<string> {
      const commands =
        options.platform === 'darwin'
          ? [['pbpaste']]
          : options.platform === 'win32'
            ? [['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw']]
            : options.wayland
              ? [
                  ['wl-paste', '-n'],
                  ['xclip', '-selection', 'clipboard', '-o'],
                  ['xsel', '--clipboard', '--output'],
                ]
              : [
                  ['xclip', '-selection', 'clipboard', '-o'],
                  ['xsel', '--clipboard', '--output'],
                  ['wl-paste', '-n'],
                ]
      return first(commands)
    },
    async notify(params: {
      title: string
      body: string
      sound?: boolean
      soundPath?: string
      silent?: boolean
    }): Promise<void> {
      if (params.silent && !params.sound && !params.soundPath) return
      const title = params.title.slice(0, 200)
      const body = params.body.slice(0, 2000)
      if (!params.silent) {
        if (options.platform === 'win32')
          await (options.nativeNotifyWindows ?? notifyWindows)({ title, body })
        else if (options.platform === 'darwin')
          await first([['osascript', '-e', MAC_NOTIFICATION, title, body]])
        else
          await first([
            [
              'notify-send',
              '--app-name=TwirChat',
              '--hint=boolean:suppress-sound:true',
              '--',
              title,
              body,
            ],
          ])
      }
      if (!params.sound && !params.soundPath) return
      if (params.soundPath && !(await options.exists(params.soundPath)))
        throw new Error('The notification sound file does not exist.')
      if (options.platform === 'win32') {
        await first(
          [['powershell', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_SOUND]],
          JSON.stringify({ soundPath: params.soundPath ?? '' }),
        )
        return
      }
      if (params.soundPath) {
        await first(
          options.platform === 'darwin'
            ? [['afplay', params.soundPath]]
            : [
                ['paplay', params.soundPath],
                ['aplay', params.soundPath],
              ],
        )
      } else if (options.platform === 'darwin')
        await first([['afplay', '/System/Library/Sounds/Glass.aiff']])
      else
        await first([
          ['canberra-gtk-play', '-i', 'message-new-instant'],
          ['paplay', '/usr/share/sounds/freedesktop/stereo/message.oga'],
        ])
    },
  }
}

export const systemIntegration = createSystemIntegration({
  platform: process.platform,
  wayland: !!process.env.WAYLAND_DISPLAY,
  exists: (path) => Bun.file(path).exists(),
  async run(command, input) {
    const child = Bun.spawn(command, {
      stdin: input === undefined ? 'ignore' : 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
    })
    if (input !== undefined && child.stdin) {
      await child.stdin.write(input)
      await child.stdin.end()
    }
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
    return { code, output }
  },
})
