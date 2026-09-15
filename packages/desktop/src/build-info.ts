/**
 * Values injected by CI via `bun build --compile --define` (see
 * .github/workflows/release.yml). Local/dev builds fall back to
 * 'dev' / the CHATRIX_BACKEND_URL env var / localhost.
 */

declare const __APP_VERSION__: string | undefined
declare const __BACKEND_URL__: string | undefined

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : 'dev'

export const BACKEND_URL: string =
  typeof __BACKEND_URL__ === 'string' && __BACKEND_URL__.length > 0
    ? __BACKEND_URL__
    : (process.env.CHATRIX_BACKEND_URL ?? 'http://127.0.0.1:3000')
