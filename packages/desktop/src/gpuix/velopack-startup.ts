import { VelopackApp } from 'velopack'

import { APP_VERSION } from '../build-info'

export function runVelopackStartup(): void {
  if (APP_VERSION === 'dev') return
  VelopackApp.build().setAutoApplyOnStartup(true).run()
}
