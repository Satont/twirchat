import { buildRelease } from './build-release'

await buildRelease([
  process.env.RELEASE_VERSION ?? '0.0.1-local',
  process.env.BACKEND_URL ?? process.env.CHATRIX_BACKEND_URL ?? 'http://127.0.0.1:3000',
])
