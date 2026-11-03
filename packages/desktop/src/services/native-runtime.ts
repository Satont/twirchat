import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const GPUIX_NATIVE_API_VERSION = 2
export const GPUIX_SOURCE_REVISION = '2e31b47ff6432ceebe70e7fc7b0f51a76d7d30cf'
export const GPUI_SOURCE_REVISION = 'f77e5cfe9dad04288566f00c66ecf3c58d6f84b3'

export interface NativeRuntimeManifest {
  apiVersion: number
  upstreamSHA: string
  gpuiSHA: string
  target: string
  size: number
  patchDigest: string
  sha256: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateNativeRuntimeManifest(
  value: unknown,
  target: string,
): NativeRuntimeManifest {
  if (!isRecord(value)) throw new Error('Invalid native runtime manifest.')
  const input = value
  if (
    input.apiVersion !== GPUIX_NATIVE_API_VERSION ||
    input.upstreamSHA !== GPUIX_SOURCE_REVISION ||
    input.gpuiSHA !== GPUI_SOURCE_REVISION ||
    input.target !== target ||
    typeof input.size !== 'number' ||
    !Number.isSafeInteger(input.size) ||
    input.size <= 0 ||
    typeof input.patchDigest !== 'string' ||
    !/^[a-f\d]{16,64}$/u.test(input.patchDigest) ||
    typeof input.sha256 !== 'string' ||
    !/^[a-f\d]{64}$/u.test(input.sha256)
  )
    throw new Error(
      'The native runtime does not match this TwirChat build. Run bun run build:native.',
    )
  return {
    apiVersion: input.apiVersion,
    upstreamSHA: input.upstreamSHA,
    gpuiSHA: input.gpuiSHA,
    target: input.target,
    size: input.size,
    patchDigest: input.patchDigest,
    sha256: input.sha256,
  }
}

export function resolveNativeRuntime(
  options: {
    platform?: string
    arch?: string
    directories?: string[]
    override?: string
  } = {},
): string {
  const target = `${options.platform ?? process.platform}-${options.arch ?? process.arch}`
  const file = `gpuix.${target}.node`
  const candidates = options.override
    ? [options.override]
    : (
        options.directories ?? [
          join(dirname(process.execPath), 'native'),
          join(import.meta.dir, '..', '..', 'dist', 'native'),
        ]
      ).map((directory) => join(directory, file))
  for (const candidate of candidates) {
    if (!existsSync(candidate) || !existsSync(`${candidate}.json`)) continue
    const manifest = validateNativeRuntimeManifest(
      JSON.parse(readFileSync(`${candidate}.json`, 'utf8')),
      target,
    )
    if (!statSync(candidate).isFile() || statSync(candidate).size !== manifest.size)
      throw new Error('The native runtime is incomplete. Run bun run build:native.')
    return candidate
  }
  throw new Error(
    'TwirChat native runtime is missing. Run bun run build:native before starting the app.',
  )
}

/** Runs before @gpuix/native is imported; no native code or window is loaded here. */
export function configureNativeRuntime(
  env: Record<string, string | undefined> = process.env,
): string {
  const path = resolveNativeRuntime({ override: env.NAPI_RS_NATIVE_LIBRARY_PATH })
  env.NAPI_RS_NATIVE_LIBRARY_PATH = path
  return path
}
