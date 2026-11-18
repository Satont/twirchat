import type { Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { platformSchema } from '../../services/persisted-schemas'
import { persistentResource } from './persistent-resources'
import { createPreferenceStore, type PreferenceStore } from './preferences'

const disabledPlatformsSchema = z.array(platformSchema)

export function createHomeComposerPlatformPreferences(): PreferenceStore<Platform[]> {
  return createPreferenceStore<Platform[]>('ui.homeComposerDisabledPlatforms', [], (value) => [
    ...new Set(disabledPlatformsSchema.parse(value)),
  ])
}

export const homeComposerPlatformPreferences = persistentResource(
  'preference:ui.homeComposerDisabledPlatforms',
  createHomeComposerPlatformPreferences,
)

declare module './persistent-resources' {
  interface PersistentResources {
    'preference:ui.homeComposerDisabledPlatforms': PreferenceStore<Platform[]>
  }
}
