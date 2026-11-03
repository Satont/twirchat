import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { createElement, isValidElement, version as reactVersion } from 'react'
import { z } from 'zod'

import { APP_ENV, APP_VERSION, BACKEND_URL, BACKEND_WS_URL } from '../build-info'
import { GPUIX_NATIVE_API_VERSION, resolveNativeRuntime } from '../services/native-runtime'

const nativeProbeSchema = z.object({ getTwirNativeApiVersion: z.function() })

export function releaseSmokeReport() {
  const directory = dirname(process.execPath)
  const binding = resolveNativeRuntime({ directories: [join(directory, 'native')] })
  const addon: unknown = createRequire(import.meta.url)(binding)
  const apiVersion: unknown = nativeProbeSchema.parse(addon).getTwirNativeApiVersion()
  if (apiVersion !== GPUIX_NATIVE_API_VERSION)
    throw new Error('Packaged native addon API version does not match this release.')
  for (const asset of ['overlay/index.html', 'fonts', 'paint-worker.js']) {
    if (!existsSync(join(directory, asset))) throw new Error(`Missing runtime asset: ${asset}`)
  }
  if (APP_ENV !== 'production' || process.env.NODE_ENV !== 'production' || APP_VERSION === 'dev')
    throw new Error('Release executable is not running in production mode.')
  if (Object.isFrozen(createElement('release-smoke')))
    throw new Error('Release executable loaded the development React runtime.')
  const jsxProbe = (
    <div>
      <div />
      <div />
    </div>
  )
  if (!isValidElement(jsxProbe) || Object.isFrozen(jsxProbe))
    throw new Error('Release executable did not load a working production JSX runtime.')
  return {
    version: APP_VERSION,
    backendUrl: BACKEND_URL,
    backendWsUrl: BACKEND_WS_URL,
    environment: APP_ENV,
    bunVersion: Bun.version,
    target: `${process.platform}-${process.arch}`,
    nativeApiVersion: apiVersion,
    reactVersion,
    reactMode: 'production',
    jsxRuntime: 'production',
    velopackStartup: true,
    executable: process.execPath,
    cwd: process.cwd(),
  }
}
