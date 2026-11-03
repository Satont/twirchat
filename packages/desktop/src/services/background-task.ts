import { logger } from '@twirchat/shared/logger'

const log = logger('background-task')
export function runInBackground(task: Promise<unknown>, context: string): void {
  task.catch((error: unknown) => log.error(context, { error: String(error) }))
}
