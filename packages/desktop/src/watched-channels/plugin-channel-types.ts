import type { WatchedChannel } from '@twirchat/shared/types'
import { z } from 'zod'

import type { PluginPlatform } from '../plugins/api'

export const pluginPlatformSchema = z
  .templateLiteral(['plugin:', z.string(), ':', z.string()])
  .refine(
    (id) => /^plugin:[a-z][a-z\d-]{0,47}:[a-z][a-z\d-]{0,31}$/u.test(id),
    'Invalid plugin transport identifier',
  )

export type { PluginPlatform } from '../plugins/api'
export type WatchedPlatform = WatchedChannel['platform'] | PluginPlatform

export interface PluginWatchedChannel extends Omit<WatchedChannel, 'platform'> {
  kind: 'plugin'
  platform: PluginPlatform
  transportName: string
}

export type DesktopWatchedChannel = WatchedChannel | PluginWatchedChannel

export function isPluginPlatform(platform: WatchedPlatform): platform is PluginPlatform {
  return platform.startsWith('plugin:')
}

export function isPluginWatchedChannel(
  channel: DesktopWatchedChannel,
): channel is PluginWatchedChannel {
  return 'kind' in channel && channel.kind === 'plugin'
}
