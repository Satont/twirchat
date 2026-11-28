import { PLATFORMS } from '@twirchat/shared/platform'
import { z } from 'zod'

export const platformSchema = z.enum(PLATFORMS)
