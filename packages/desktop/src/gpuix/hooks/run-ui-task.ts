import { showNotice } from '../state/app'

/** Finish an event or effect task and surface unexpected failures in its window. */
export function runUiTask(task: Promise<unknown>): void {
  task.catch((error: unknown) => {
    showNotice('error', error instanceof Error ? error.message : String(error))
  })
}
