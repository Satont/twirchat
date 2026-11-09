/**
 * Values injected by CI via `bun build --compile --define` (see
 * .github/workflows/release.yml). Local/dev builds fall back to
 * 'dev' / the CHATRIX_BACKEND_URL env var / localhost.
 */

declare const __APP_VERSION__: string | undefined
declare const __BACKEND_URL__: string | undefined

export function backendWebSocketUrl(backendUrl: string, override?: string): string {
  if (override) return override
  const url = new URL(backendUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('Backend URL must use HTTP or HTTPS.')
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/ws`
  url.search = ''
  url.hash = ''
  return url.toString()
}

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0
    ? __APP_VERSION__
    : (process.env.TWIRCHAT_APP_VERSION ?? 'dev')

export const BACKEND_URL: string =
  typeof __BACKEND_URL__ === 'string' && __BACKEND_URL__.length > 0
    ? __BACKEND_URL__
    : (process.env.CHATRIX_BACKEND_URL ?? 'http://127.0.0.1:3000')

export const BACKEND_WS_URL = backendWebSocketUrl(BACKEND_URL, process.env.CHATRIX_BACKEND_WS_URL)

export const APP_ENV =
  APP_VERSION === 'dev' ? (process.env.NODE_ENV ?? 'development') : 'production'
