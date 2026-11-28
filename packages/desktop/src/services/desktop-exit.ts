import { logger } from '@twirchat/shared/logger'

const log = logger('desktop-exit')

export function createDesktopExit({
  closeWindows,
  shutdown,
  exit,
  updateDelayMs = 300,
  windowDeadlineMs = 5_000,
  // Leave time for the diagnostic flush before Velopack's 60-second wait expires.
  updateDeadlineMs = 50_000,
}: {
  closeWindows: () => Promise<void>
  shutdown: () => Promise<void>
  exit: () => void
  updateDelayMs?: number
  windowDeadlineMs?: number
  updateDeadlineMs?: number
}) {
  let shutdownStarted = false
  let exitStarted = false
  let delay: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let windowDeadline: ReturnType<typeof setTimeout> | undefined

  function finish(): void {
    if (exitStarted) return
    exitStarted = true
    clearTimeout(delay)
    clearTimeout(windowDeadline)
    clearTimeout(deadline)
    exit()
  }

  function quit(): void {
    if (shutdownStarted || exitStarted) return
    shutdownStarted = true
    clearTimeout(delay)
    clearTimeout(windowDeadline)
    Promise.resolve()
      .then(shutdown)
      .catch((error: unknown) => log.warn('Desktop shutdown failed', { error: String(error) }))
      .then(finish)
      .catch((error: unknown) => log.error('Desktop exit failed', { error: String(error) }))
  }

  function scheduleUpdateExit(): void {
    if (deadline || exitStarted) return
    deadline = setTimeout(() => {
      log.warn('Desktop shutdown exceeded the update deadline')
      finish()
    }, updateDeadlineMs)
    delay = setTimeout(() => {
      if (shutdownStarted || exitStarted) return
      windowDeadline = setTimeout(() => {
        log.warn('Window cleanup exceeded the update deadline')
        quit()
      }, windowDeadlineMs)
      Promise.resolve()
        .then(closeWindows)
        .catch((error: unknown) => {
          if (exitStarted) return
          log.warn('Could not close desktop windows for update', { error: String(error) })
          quit()
        })
    }, updateDelayMs)
  }

  return { quit, scheduleUpdateExit }
}
