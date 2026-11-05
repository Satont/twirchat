import { z } from 'zod'

export const HOME_PLUGIN_CHANNELS_KEY = 'chat.homePluginChannels'
export const MAX_HOME_PLUGIN_CHANNELS = 32

export const homePluginChannelIdsSchema = z
  .array(z.uuid())
  .max(MAX_HOME_PLUGIN_CHANNELS)
  .transform((ids) => [...new Set(ids)])

export function readHomePluginChannelIds(raw: string | null): Set<string> {
  if (raw === null) return new Set()
  try {
    return new Set(homePluginChannelIdsSchema.parse(JSON.parse(raw)))
  } catch {
    return new Set()
  }
}
