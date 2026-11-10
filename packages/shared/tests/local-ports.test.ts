import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const snapshot = `
import { AUTH_SERVER_PORT, KICK_WEBHOOK_PORT, OVERLAY_SERVER_PORT, DEV_SERVER_PORT,
  YOUTUBE_REDIRECT_URI, KICK_REDIRECT_URI } from ${JSON.stringify(join(import.meta.dir, '../constants.ts'))}
import { DEFAULT_SETTINGS } from ${JSON.stringify(join(import.meta.dir, '../types.ts'))}
console.log(JSON.stringify({
  ports: [AUTH_SERVER_PORT, KICK_WEBHOOK_PORT, OVERLAY_SERVER_PORT, DEV_SERVER_PORT],
  callbacks: [YOUTUBE_REDIRECT_URI, KICK_REDIRECT_URI],
  overlayPort: DEFAULT_SETTINGS.overlay.port,
}))
`

function portEnvironment(overrides: Record<string, string | undefined>) {
  return {
    ...process.env,
    NODE_ENV: undefined,
    AUTH_SERVER_PORT: undefined,
    KICK_WEBHOOK_PORT: undefined,
    OVERLAY_SERVER_PORT: undefined,
    DEV_SERVER_PORT: undefined,
    ...overrides,
  }
}

function readPorts(overrides: Record<string, string | undefined>, script = snapshot): unknown {
  const result = Bun.spawnSync([process.execPath, '--no-env-file', '--eval', script], {
    cwd: tmpdir(),
    env: portEnvironment(overrides),
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return JSON.parse(result.stdout.toString())
}

function expectedPorts(auth: number, kick: number, overlay: number, dev: number) {
  return {
    ports: [auth, kick, overlay, dev],
    callbacks: [
      `http://127.0.0.1:${auth}/auth/youtube/callback`,
      `http://localhost:${auth}/auth/kick/callback`,
    ],
    overlayPort: overlay,
  }
}

test('development and plain source runs use separate listeners and matching OAuth callbacks', () => {
  for (const NODE_ENV of [undefined, 'development']) {
    expect(readPorts({ NODE_ENV })).toEqual(expectedPorts(55821, 55822, 55823, 55824))
  }
})

test('production uses the production listener ports and callback URLs', () => {
  expect(readPorts({ NODE_ENV: 'production' })).toEqual(expectedPorts(45821, 45822, 45823, 45824))
})

test('explicit ports override defaults without receiving a development offset', () => {
  for (const NODE_ENV of ['development', 'production']) {
    expect(
      readPorts({
        NODE_ENV,
        AUTH_SERVER_PORT: '60001',
        KICK_WEBHOOK_PORT: '60002',
        OVERLAY_SERVER_PORT: '60003',
        DEV_SERVER_PORT: '60004',
      }),
    ).toEqual(expectedPorts(60001, 60002, 60003, 60004))
  }
})

test('the release production define keeps packaged ports stable in a development environment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twirchat-ports-'))
  try {
    const entrypoint = join(directory, 'ports.ts')
    await Bun.write(entrypoint, snapshot)
    const build = await Bun.build({
      entrypoints: [entrypoint],
      target: 'bun',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
    expect(build.success, JSON.stringify(build.logs)).toBe(true)
    const output = build.outputs[0]
    if (!output) throw new Error('Expected a bundled port snapshot.')
    expect(readPorts({ NODE_ENV: 'development' }, await output.text())).toEqual(
      expectedPorts(45821, 45822, 45823, 45824),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
