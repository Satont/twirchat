/**
 * Runtime configuration for backend URLs.
 * These are loaded from build.json at runtime, not baked into the build.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export interface RuntimeConfig {
  backendUrl: string
  backendWsUrl: string
  nodeEnv: string
  dbPath: string
  clientSecret: string
}

function getDefaultDbPath(nodeEnv: string): string {
  const baseDir =
    nodeEnv === 'production' ? join(homedir(), '.twirchat') : join(homedir(), '.twirchat-dev')
  return join(baseDir, 'db.sqlite')
}

const defaultConfig: RuntimeConfig = {
  backendUrl: 'http://127.0.0.1:3000',
  backendWsUrl: 'ws://127.0.0.1:3000/ws',
  clientSecret: '',
  dbPath: getDefaultDbPath('production'),
  nodeEnv: 'production',
}

let runtimeConfig: RuntimeConfig = { ...defaultConfig }

export function setRuntimeConfig(config: Partial<RuntimeConfig>): void {
  runtimeConfig = {
    ...runtimeConfig,
    ...config,
  }
  // Приоритет: 1) явно заданный dbPath, 2) process.env.DB_PATH, 3) путь по умолчанию на основе nodeEnv
  if (config.dbPath) {
    runtimeConfig.dbPath = config.dbPath
  } else if (process.env['DB_PATH']) {
    runtimeConfig.dbPath = process.env['DB_PATH']
  } else if (config.nodeEnv) {
    runtimeConfig.dbPath = getDefaultDbPath(config.nodeEnv)
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfig
}

export function getBackendUrl(): string {
  return runtimeConfig.backendUrl
}

export function getBackendWsUrl(): string {
  return runtimeConfig.backendWsUrl
}

export function getDbPath(): string {
  return runtimeConfig.dbPath
}

/**
 * Authenticated fetch to the backend.
 * Automatically prepends the backend base URL and injects X-Client-Secret.
 * Use this for every HTTP call to the backend instead of bare fetch().
 */
export function backendFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const { backendUrl, clientSecret } = runtimeConfig
  return fetch(`${backendUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string> | undefined),
      ...(clientSecret ? { 'X-Client-Secret': clientSecret } : {}),
    },
  })
}
