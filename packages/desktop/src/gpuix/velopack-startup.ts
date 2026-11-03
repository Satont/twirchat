import { VelopackApp } from 'velopack'

import { APP_VERSION } from '../build-info'

export function runVelopackStartup(): void {
  if (APP_VERSION === 'dev') return
  // Failed Linux updates must not close the app again on every shortcut launch.
  VelopackApp.build()
    .setAutoApplyOnStartup(process.platform !== 'linux')
    .run()
}
