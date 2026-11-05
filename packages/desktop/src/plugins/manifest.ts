import { z } from 'zod'

import { pluginIdSchema } from './protocol'

export const MANIFEST_FILENAME = 'manifest.json'
export const MAX_MANIFEST_BYTES = 32 * 1024
export const MAX_PACKAGE_BYTES = 16 * 1024 * 1024
export const MAX_PACKAGE_ENTRIES = 512
export const MAX_PACKAGE_DEPTH = 12

export const manifestSchema = z.object({
  id: pluginIdSchema,
  name: z.string().trim().min(1).max(100),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-[a-z\d]+(?:[.-][a-z\d]+)*)?$/iu)
    .max(80),
  apiVersion: z.number().int().positive(),
  entry: z
    .string()
    .regex(/^(?:[a-z\d_][a-z\d_-]*\/)*[a-z\d_][a-z\d_.-]*\.(?:[cm]?[jt]s)$/iu)
    .max(160),
})

export type Manifest = z.infer<typeof manifestSchema>
