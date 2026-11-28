import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { z } from 'zod'

const sourceManifestSchema = z.strictObject({
  schema: z.literal(1),
  version: z.string().min(1),
  repository: z.url(),
  revision: z.string().regex(/^[a-f\d]{40}$/u),
  gpuiRevision: z.string().regex(/^[a-f\d]{40}$/u),
  rustToolchain: z.string().regex(/^\d+\.\d+\.\d+$/u),
  patches: z
    .array(
      z.strictObject({
        path: z.string().regex(/^patches\/[a-z\d-]+\.patch$/u),
        root: z.enum(['gpuix', 'gpui', 'cosmic-text']),
        sha256: z.string().regex(/^[a-f\d]{64}$/u),
      }),
    )
    .min(1),
  cosmicText: z.strictObject({
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    sha256: z.string().regex(/^[a-f\d]{64}$/u),
  }),
})

export type NativeSourceManifest = z.infer<typeof sourceManifestSchema>

export function parseNativeSourceManifest(value: unknown): NativeSourceManifest {
  return sourceManifestSchema.parse(value)
}

export async function readNativeSourceManifest(root: string): Promise<NativeSourceManifest> {
  return parseNativeSourceManifest(await Bun.file(join(root, 'source.json')).json())
}

export async function verifyNativeSource(
  root: string,
  manifest: NativeSourceManifest,
  { platform = process.platform, arch = process.arch } = {},
): Promise<string> {
  const patches = await Promise.all(
    manifest.patches.map(async ({ path, sha256 }) => {
      const bytes = await Bun.file(join(root, path)).bytes()
      if (createHash('sha256').update(bytes).digest('hex') !== sha256)
        throw new Error(`Native patch checksum mismatch: ${path}`)
      return bytes
    }),
  )

  // The parsed manifest's field order and the raw patch order are part of the cache key.
  const hash = createHash('sha256').update(JSON.stringify({ manifest, platform, arch }))
  for (const patch of patches) hash.update(patch)
  return hash.digest('hex').slice(0, 16)
}
