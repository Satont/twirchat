import type { StreamerModeService } from '../../services/streamer-mode'
import type { DesktopApi } from './api'

export function createStreamerModeApi(
  service: StreamerModeService | undefined,
): Pick<
  DesktopApi,
  'getStreamerMode' | 'setStreamerMode' | 'getStreamerModeSettings' | 'setStreamerModeSettings'
> {
  function streamerMode(): StreamerModeService {
    if (!service) throw new Error('Streamer mode is unavailable.')
    return service
  }
  return {
    getStreamerMode: async () => streamerMode().getStatus(),
    setStreamerMode: async ({ mode }) => streamerMode().setMode(mode),
    getStreamerModeSettings: async () => streamerMode().getStatus().settings,
    setStreamerModeSettings: async ({ settings }) => streamerMode().setSettings(settings),
  }
}
