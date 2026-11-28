import type { PluginManager } from '../../plugins/manager'
import type { DesktopApi } from './api'
import type { DesktopEvents } from './events'

export interface DesktopBackend {
  api: DesktopApi
  events: Pick<DesktopEvents, 'on'>
  plugins?: Pick<
    PluginManager,
    | 'list'
    | 'install'
    | 'checkForUpdate'
    | 'setEnabled'
    | 'remove'
    | 'hasCommand'
    | 'runCommand'
    | 'commandNames'
  >
}
