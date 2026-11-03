import { z } from 'zod'

const trayActionSchema = z.array(z.enum(['show', 'notifications', 'quit']))

export interface TrayWindow {
  id: string
  isOpen(): boolean
  configure(enabled: boolean, notifications: boolean): Promise<void>
  takeEvents(): unknown
  activate(): void
}

export function createSystemTray(options: {
  windows(): readonly TrayWindow[]
  notificationsEnabled(): boolean
  toggleNotifications(): Promise<void>
  quit(): Promise<void>
  failed(error: unknown): void
}) {
  let owner: TrayWindow | undefined
  let enabled: boolean | undefined
  let pending = false
  let stopped = false
  let failedOwner: string | undefined

  async function refresh(): Promise<void> {
    if (pending || stopped) return
    pending = true
    try {
      const windows = options.windows().filter((window) => window.isOpen())
      const next = windows.find((window) => window.id === 'main') ?? windows[0]
      if (owner?.id !== next?.id) {
        if (owner?.isOpen()) await owner.configure(false, false)
        owner = next
        enabled = undefined
        failedOwner = undefined
      }
      if (!owner || failedOwner === owner.id) return
      const notifications = options.notificationsEnabled()
      if (enabled !== notifications) {
        await owner.configure(true, notifications)
        enabled = notifications
      }
      if (stopped) return
      for (const action of trayActionSchema.parse(owner.takeEvents())) {
        if (action === 'show') owner.activate()
        else if (action === 'notifications') await options.toggleNotifications()
        else {
          await options.quit()
          return
        }
      }
    } catch (error) {
      failedOwner = owner?.id
      options.failed(error)
    } finally {
      pending = false
    }
  }

  return {
    refresh,
    async stop(): Promise<void> {
      stopped = true
      if (owner?.isOpen()) {
        try {
          await owner.configure(false, false)
        } catch (error) {
          options.failed(error)
        }
      }
      owner = undefined
    },
  }
}
