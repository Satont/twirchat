import type {
  StreamerMode,
  StreamerModeService,
  StreamerModeSettings,
  StreamerModeStatus,
} from '../../services/streamer-mode'

export interface StreamerModeApi {
  getStreamerMode(): Promise<StreamerModeStatus>
  setStreamerMode(params: { mode: StreamerMode | 'toggle' }): Promise<StreamerModeStatus>
  getStreamerModeSettings(): Promise<StreamerModeSettings>
  setStreamerModeSettings(params: { settings: StreamerModeSettings }): Promise<StreamerModeStatus>
}

export function createStreamerModeApi(service: StreamerModeService | undefined): StreamerModeApi {
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
