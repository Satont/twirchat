/** bun packages/backend/tests/run-multi-account-postgres.ts — never uses the project database. */
import { chmodSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.platform !== 'linux')
  throw new Error('This isolated PostgreSQL fixture requires a local Linux Docker socket.')
const docker = ['docker', '-H', 'unix:///var/run/docker.sock']
const image = 'postgres:17-alpine'
const directory = mkdtempSync(join(tmpdir(), 'twirchat-backend-pg-'))
const socket = join(directory, 'socket')
mkdirSync(socket)
chmodSync(socket, 0o777)
await Bun.write(
  join(directory, 'isolation.json'),
  JSON.stringify({ purpose: 'twirchat-backend-accounts' }),
)
let container = ''
async function command(
  args: string[],
  allowFailure = false,
): Promise<{ code: number; output: string }> {
  const child = Bun.spawn([...docker, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code && !allowFailure)
    throw new Error(`Local PostgreSQL test container failed: ${error.trim()}`)
  return { code, output: output.trim() }
}
try {
  if ((await command(['image', 'inspect', image], true)).code)
    throw new Error(
      `A preloaded ${image} image is required; this fixture never pulls or installs images.`,
    )
  const started = await command([
    'run',
    '-d',
    '--rm',
    '--network',
    'none',
    '--cpus',
    '1',
    '--memory',
    '512m',
    '--pids-limit',
    '128',
    '--tmpfs',
    '/var/lib/postgresql/data:rw,size=134217728',
    '--mount',
    `type=bind,source=${socket},target=/var/run/postgresql`,
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e',
    'POSTGRES_USER=twirchat_test',
    '-e',
    'POSTGRES_DB=twirchat_multi_account_test',
    image,
  ])
  container = started.output
  if (!/^[a-f0-9]{64}$/.test(container))
    throw new Error('Docker returned an invalid test container ID.')
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    // initdb briefly starts a temporary server; wait for the final PID 1 server instead.
    const processName = await command(['exec', container, 'cat', '/proc/1/comm'], true)
    if (
      processName.output === 'postgres' &&
      !(
        await command(
          [
            'exec',
            container,
            'pg_isready',
            '-U',
            'twirchat_test',
            '-d',
            'twirchat_multi_account_test',
          ],
          true,
        )
      ).code
    ) {
      ready = true
      break
    }
    await Bun.sleep(100)
  }
  if (!ready) throw new Error('The isolated PostgreSQL fixture did not become ready in time.')
  const child = Bun.spawn(
    [process.execPath, 'test', join(import.meta.dir, 'multi-account-postgres.test.ts')],
    {
      cwd: join(import.meta.dir, '..'),
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        TWIRCHAT_TEST_PG_SOCKET: socket,
        DATABASE_URL: `postgres://twirchat_test@localhost/twirchat_multi_account_test?path=${encodeURIComponent(socket)}`,
      },
    },
  )
  process.exitCode = await child.exited
} finally {
  if (/^[a-f0-9]{64}$/.test(container)) {
    await command(['exec', container, 'chmod', '777', '/var/run/postgresql'], true)
    await command(['stop', '--time', '2', container], true)
    await command(['rm', '--force', container], true)
  }
  rmSync(directory, { recursive: true, force: true })
}
