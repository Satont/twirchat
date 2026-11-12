import { logger } from '@twirchat/shared/logger'

import { APP_VERSION } from '../build-info'
import { flushDiagnosticLogs, installDiagnosticLogging } from '../services/diagnostic-logging'
import { runVelopackStartup } from './velopack-startup'

if (process.argv.includes('--twirchat-release-smoke')) {
  runVelopackStartup()
  const { releaseSmokeReport } = await import('./release-smoke')
  console.log(JSON.stringify(releaseSmokeReport()))
} else {
  installDiagnosticLogging()
  const log = logger('desktop')
  try {
    runVelopackStartup()
    log.info('Starting TwirChat', { version: APP_VERSION })
    await import('./main')
  } catch (error) {
    log.error('TwirChat startup failed', { error: String(error) })
    await flushDiagnosticLogs()
    throw error
  }
}
