import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { z } from 'zod'

import {
  assertGuiQaEnvironment,
  assertGuiQaSandbox,
  privateWestonDesktopConfig,
} from '../src/services/gui-qa'
import { prepareQaWeston, prepareQaWestonControls } from './qa-weston'

interface Options {
  command: string[]
  seconds: number
  keep: boolean
  artifacts?: string
  compositor?: 'xvfb' | 'weston'
  dbus?: boolean
  westonControls?: boolean
  westonShell?: 'kiosk' | 'desktop'
  displayWidth?: number
  displayHeight?: number
  nodeEnv: 'development' | 'production'
}

const commandResultSchema = z.object({ code: z.number().int() })

export function parseGuiQaArguments(args: string[]): Options {
  const options: Options = { command: [], seconds: 30, keep: false, nodeEnv: 'development' }
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === '--') {
      options.command = args.slice(index + 1)
      break
    }
    if (argument === '--keep') {
      options.keep = true
      continue
    }
    if (argument === '--dbus') {
      options.dbus = true
      continue
    }
    if (argument === '--weston-controls') {
      options.westonControls = true
      continue
    }
    if (argument === '--weston-shell') {
      const shell = args[++index]
      if (shell !== 'kiosk' && shell !== 'desktop')
        throw new Error('--weston-shell must be kiosk or desktop.')
      options.westonShell = shell
      continue
    }
    if (argument === '--node-env') {
      const nodeEnv = args[++index]
      if (nodeEnv !== 'development' && nodeEnv !== 'production')
        throw new Error('--node-env must be development or production.')
      options.nodeEnv = nodeEnv
      continue
    }
    if (argument === '--compositor') {
      const compositor = args[++index]
      if (compositor !== 'xvfb' && compositor !== 'weston')
        throw new Error('--compositor must be xvfb or weston.')
      options.compositor = compositor
      continue
    }
    if (argument === '--timeout') {
      const seconds = Number(args[++index])
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600)
        throw new Error('--timeout must be greater than zero and at most 600 seconds.')
      options.seconds = seconds
      continue
    }
    if (argument === '--display-width' || argument === '--display-height') {
      const dimension = Number(args[++index])
      const minimum = argument === '--display-width' ? 320 : 240
      if (!Number.isInteger(dimension) || dimension < minimum || dimension > 4096)
        throw new Error(`${argument} must be an integer between ${minimum} and 4096.`)
      if (argument === '--display-width') options.displayWidth = dimension
      else options.displayHeight = dimension
      continue
    }
    if (argument === '--artifacts') {
      const path = args[++index]
      if (!path) throw new Error('--artifacts requires a directory.')
      options.artifacts = resolve(path)
      options.keep = true
      continue
    }
    throw new Error(`Unknown GUI QA argument: ${argument}. Put the command after --.`)
  }
  if (options.westonControls && options.compositor !== 'weston')
    throw new Error('--weston-controls requires --compositor weston.')
  if (options.westonShell && options.compositor !== 'weston')
    throw new Error('--weston-shell requires --compositor weston.')
  return options
}

export function sandboxArguments(
  session: string,
  repository: string,
  bun: string,
  command: string[] = [],
): string[] {
  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-all',
    '--ro-bind',
    '/usr',
    '/usr',
    '--ro-bind',
    '/etc',
    '/etc',
    '--ro-bind',
    '/sys',
    '/sys',
    '--symlink',
    'usr/bin',
    '/bin',
    '--symlink',
    'usr/lib',
    '/lib',
    '--symlink',
    'usr/lib64',
    '/lib64',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/run',
    '--tmpfs',
    '/tmp',
    '--dir',
    '/dev/dri',
    '--ro-bind',
    repository,
    repository,
    '--ro-bind',
    bun,
    bun,
    '--bind',
    session,
    session,
    '--chdir',
    repository,
    '--clearenv',
  ]
  for (const name of (existsSync('/dev/dri') ? readdirSync('/dev/dri') : []).filter((entry) =>
    /^renderD\d+$/u.test(entry),
  ))
    args.push('--dev-bind', join('/dev/dri', name), join('/dev/dri', name))
  for (const path of new Set(command)) {
    if (
      !path.startsWith('/') ||
      path.startsWith(`${repository}/`) ||
      path.startsWith('/usr/') ||
      path === bun
    )
      continue
    if (existsSync(path) && statSync(path).isFile()) args.push('--ro-bind', path, path)
  }
  return args
}

async function guardedChild(args: string[]): Promise<number> {
  assertGuiQaEnvironment()
  if (process.env.TWIRCHAT_QA_DBUS_REQUESTED === '1') {
    delete process.env.TWIRCHAT_QA_DBUS_REQUESTED
    return await privateBusSession(args)
  }
  const { configureNativeRuntime } = await import('../src/services/native-runtime')
  configureNativeRuntime()
  const session = process.env.TWIRCHAT_QA_SESSION_DIR!
  await Bun.write(
    join(session, 'guard-passed.json'),
    JSON.stringify({
      compositor: process.env.TWIRCHAT_QA_COMPOSITOR,
      display: process.env.DISPLAY,
      runtime: process.env.XDG_RUNTIME_DIR,
      displayCards: false,
      virtualTerminals: false,
      privateBus: process.env.DBUS_SESSION_BUS_ADDRESS ?? null,
      pid: process.pid,
    }),
  )
  if (!args.length) throw new Error('No GUI QA command supplied after the child guard.')
  const child = Bun.spawn(args, {
    cwd: process.env.TWIRCHAT_QA_CWD,
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await child.exited
  await Bun.write(join(session, 'command-result.json'), JSON.stringify({ code }))
  return code
}

async function privateBusSession(command: string[]): Promise<number> {
  const runtime = process.env.TWIRCHAT_QA_RUNTIME
  if (!runtime) throw new Error('Private desktop bus runtime is missing.')
  const socket = join(runtime, 'bus')
  const xmlSocket = socket.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const config = join(runtime, 'dbus.conf')
  // No host service directories or TCP listeners are configured. The sole
  // transport and every activated client stay within the existing namespace.
  await Bun.write(
    config,
    `<busconfig><type>session</type><listen>unix:path=${xmlSocket}</listen><auth>EXTERNAL</auth><policy context="default"><allow user="${process.getuid?.()}"/><allow own="*"/><allow send_destination="*"/><allow receive_sender="*"/></policy></busconfig>`,
  )
  chmodSync(config, 0o600)
  const log = Bun.file(join(runtime, 'dbus.log'))
  const server = Bun.spawn(
    ['/usr/bin/dbus-daemon', '--nofork', '--nopidfile', `--config-file=${config}`],
    { stdin: 'ignore', stdout: log, stderr: log },
  )
  try {
    const deadline = Date.now() + 5000
    while (!existsSync(socket)) {
      if (server.exitCode !== null || Date.now() > deadline)
        throw new Error('Private desktop bus did not start.')
      await Bun.sleep(20)
    }
    process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${socket}`
    process.env.TWIRCHAT_QA_DBUS = '1'
    return await guardedChild(command)
  } finally {
    delete process.env.DBUS_SESSION_BUS_ADDRESS
    delete process.env.TWIRCHAT_QA_DBUS
    if (server.exitCode === null) server.kill('SIGTERM')
    await server.exited
  }
}

const displayDimensionsSchema = z.object({
  width: z.coerce.number().int().min(320).max(4096),
  height: z.coerce.number().int().min(240).max(4096),
})
function childDisplayDimensions(compositor: 'xvfb' | 'weston') {
  return displayDimensionsSchema.parse({
    width: process.env.TWIRCHAT_QA_DISPLAY_WIDTH ?? (compositor === 'xvfb' ? 1280 : 1200),
    height: process.env.TWIRCHAT_QA_DISPLAY_HEIGHT ?? (compositor === 'xvfb' ? 900 : 800),
  })
}
export function xvfbScreenSize(width = 1280, height = 900): string {
  const dimensions = displayDimensionsSchema.parse({ width, height })
  return `${dimensions.width}x${dimensions.height}x24`
}
export function westonArguments(
  width = 1200,
  height = 800,
  shell: 'kiosk' | 'desktop' = 'kiosk',
): string[] {
  const dimensions = displayDimensionsSchema.parse({ width, height })
  return [
    '--backend=headless',
    '--renderer=gl',
    `--shell=${shell}-shell.so`,
    '--socket=twirchat-qa',
    `--width=${dimensions.width}`,
    `--height=${dimensions.height}`,
    '--fake-seat',
    '--idle-time=0',
    '--no-config',
  ]
}

async function westonSession(command: string[]): Promise<number> {
  assertGuiQaSandbox()
  if (
    process.env.TWIRCHAT_QA_COMPOSITOR !== 'weston' ||
    process.env.DISPLAY ||
    process.env.WAYLAND_DISPLAY
  )
    throw new Error('Private Weston must start without an ambient display.')
  const runtime = process.env.TWIRCHAT_QA_RUNTIME
  const root = process.env.TWIRCHAT_QA_WESTON_ROOT
  if (!runtime || !root) throw new Error('Private Weston runtime or tool directory is missing.')
  const binary = join(root, 'usr/bin/weston')
  const module = process.env.TWIRCHAT_QA_WESTON_CONTROLS
  const dimensions = childDisplayDimensions('weston')
  const shell = z.enum(['kiosk', 'desktop']).parse(process.env.TWIRCHAT_QA_WESTON_SHELL ?? 'kiosk')
  const compositorArguments = westonArguments(dimensions.width, dimensions.height, shell)
  if (shell === 'desktop') {
    const config = join(runtime, 'weston-desktop.ini')
    await Bun.write(config, privateWestonDesktopConfig(root))
    chmodSync(config, 0o600)
    const noConfig = compositorArguments.indexOf('--no-config')
    compositorArguments.splice(noConfig, 1, `--config=${config}`)
  }
  const server = Bun.spawn(
    [binary, ...compositorArguments, ...(module ? [`--modules=${module}`] : [])],
    {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'ignore',
      env: {
        ...process.env,
        LD_LIBRARY_PATH: `${root}/usr/lib:${root}/usr/lib/weston`,
        WESTON_MODULE_MAP: [
          `headless-backend.so=${root}/usr/lib/libweston-15/headless-backend.so`,
          `gl-renderer.so=${root}/usr/lib/libweston-15/gl-renderer.so`,
          `kiosk-shell.so=${root}/usr/lib/weston/kiosk-shell.so`,
          `desktop-shell.so=${root}/usr/lib/weston/desktop-shell.so`,
        ].join(';'),
      },
    },
  )
  try {
    const socket = join(runtime, 'twirchat-qa')
    const deadline = Date.now() + 10000
    while (!existsSync(socket)) {
      if (server.exitCode !== null || Date.now() > deadline)
        throw new Error('Private headless Weston did not start.')
      await Bun.sleep(20)
    }
    const marker = join(runtime, 'weston.json')
    const temporary = `${marker}.pending`
    await Bun.write(temporary, JSON.stringify({ pid: server.pid, binary }))
    chmodSync(temporary, 0o600)
    renameSync(temporary, marker)
    process.env.WAYLAND_DISPLAY = 'twirchat-qa'
    return await guardedChild(command)
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM')
      await server.exited
    }
  }
}

async function xvfbSession(command: string[]): Promise<number> {
  assertGuiQaSandbox()
  mkdirSync('/tmp/.X11-unix', { mode: 0o1777 })
  const runtime = process.env.TWIRCHAT_QA_RUNTIME!
  const framebuffer = join(process.env.TWIRCHAT_QA_SESSION_DIR!, 'framebuffer')
  mkdirSync(framebuffer, { mode: 0o700 })
  const auth = join(runtime, 'xauthority')
  await Bun.write(auth, '')
  chmodSync(auth, 0o600)
  const cookie = randomBytes(16).toString('hex')
  const dimensions = childDisplayDimensions('xvfb')
  const authorization = Bun.spawn(['/usr/bin/xauth', '-f', auth, 'add', ':99', '.', cookie], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await authorization.exited) !== 0)
    throw new Error('Could not create private Xvfb authorization.')
  const server = Bun.spawn(
    [
      '/usr/bin/Xvfb',
      ':99',
      '-screen',
      '0',
      xvfbScreenSize(dimensions.width, dimensions.height),
      '-nolisten',
      'tcp',
      '-auth',
      auth,
      '-fbdir',
      framebuffer,
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  try {
    const deadline = Date.now() + 5000
    while (!existsSync('/tmp/.X11-unix/X99')) {
      if (server.exitCode !== null || Date.now() > deadline)
        throw new Error('Private Xvfb did not start.')
      await Bun.sleep(20)
    }
    await Bun.write(join(runtime, 'xvfb.json'), JSON.stringify({ pid: server.pid }))
    process.env.DISPLAY = ':99'
    process.env.XAUTHORITY = auth
    return await guardedChild(command)
  } finally {
    server.kill('SIGTERM')
    await server.exited
  }
}

async function run(options: Options): Promise<number> {
  if (process.platform !== 'linux')
    throw new Error('Isolated GUI QA requires Linux with bwrap and Xvfb.')
  const compositor = options.compositor ?? 'xvfb'
  const dimensions = displayDimensionsSchema.parse({
    width: options.displayWidth ?? (compositor === 'xvfb' ? 1280 : 1200),
    height: options.displayHeight ?? (compositor === 'xvfb' ? 900 : 800),
  })
  const tools =
    compositor === 'weston'
      ? ['/usr/bin/bwrap', '/usr/bin/bsdtar']
      : ['/usr/bin/bwrap', '/usr/bin/Xvfb', '/usr/bin/xauth']
  if (options.dbus) tools.push('/usr/bin/dbus-daemon')
  for (const path of tools)
    if (!existsSync(path)) throw new Error(`Required GUI QA isolation tool is missing: ${path}`)
  const westonRoot = compositor === 'weston' ? await prepareQaWeston() : undefined
  const repository = resolve(import.meta.dir, '../../..')
  const desktop = resolve(import.meta.dir, '..')
  const artifactRoot = options.artifacts ?? tmpdir()
  mkdirSync(artifactRoot, { recursive: true })
  const session = mkdtempSync(join(artifactRoot, 'twirchat-gui-qa-'))
  chmodSync(session, 0o700)
  for (const directory of ['runtime', 'home', 'profile', 'config', 'cache'])
    mkdirSync(join(session, directory), { mode: 0o700 })
  const westonControls =
    options.westonControls && westonRoot
      ? await prepareQaWestonControls(westonRoot, session)
      : undefined
  const nonce = randomBytes(12).toString('hex')
  await Bun.write(join(session, 'isolation.json'), JSON.stringify({ version: 1, nonce }))
  chmodSync(join(session, 'isolation.json'), 0o600)
  const env: Record<string, string> = {
    PATH: `${dirname(process.execPath)}:/usr/bin`,
    HOME: join(session, 'home'),
    XDG_RUNTIME_DIR: join(session, 'runtime'),
    XDG_CONFIG_HOME: join(session, 'config'),
    XDG_CACHE_HOME: join(session, 'cache'),
    XDG_SESSION_TYPE: compositor === 'weston' ? 'wayland' : 'x11',
    TWIRCHAT_GUI_QA: '1',
    GPUIX_BACKGROUND: '1',
    TWIRCHAT_QA_APP_ID: `dev.twirchat.qa.${nonce}`,
    TWIRCHAT_QA_SESSION_DIR: session,
    TWIRCHAT_QA_RUNTIME: join(session, 'runtime'),
    TWIRCHAT_QA_NONCE: nonce,
    TWIRCHAT_QA_COMPOSITOR: compositor,
    TWIRCHAT_QA_WESTON_SHELL: options.westonShell ?? 'kiosk',
    TWIRCHAT_QA_DISPLAY_WIDTH: String(dimensions.width),
    TWIRCHAT_QA_DISPLAY_HEIGHT: String(dimensions.height),
    TWIRCHAT_QA_HOST_MOUNT_NS: readlinkSync('/proc/self/ns/mnt'),
    TWIRCHAT_QA_CWD: process.cwd(),
    DB_PATH: join(session, 'profile', 'db.sqlite'),
    LANG: process.env.LANG ?? 'C.UTF-8',
    NODE_ENV: options.nodeEnv,
  }
  const command = options.command.length
    ? options.command
    : [process.execPath, join(desktop, 'src/gpuix/main.tsx')]
  if (westonRoot) env.TWIRCHAT_QA_WESTON_ROOT = westonRoot
  if (westonControls) env.TWIRCHAT_QA_WESTON_CONTROLS = westonControls
  if (options.dbus) env.TWIRCHAT_QA_DBUS_REQUESTED = '1'
  const args = sandboxArguments(session, repository, process.execPath, command)
  if (westonRoot) args.push('--ro-bind', westonRoot, westonRoot)
  for (const [key, value] of Object.entries(env)) args.push('--setenv', key, value)
  args.push(
    '--',
    process.execPath,
    import.meta.path,
    compositor === 'weston' ? '--weston-session' : '--xvfb-session',
    ...command,
  )
  const log = Bun.file(join(session, 'compositor.log'))
  const child = Bun.spawn(['/usr/bin/bwrap', ...args], {
    stdout: log,
    stderr: log,
    stdin: 'ignore',
  })
  let timedOut = false
  let forceKill: ReturnType<typeof setTimeout> | undefined
  const terminate = () => {
    child.kill('SIGTERM')
    forceKill ??= setTimeout(() => child.kill('SIGKILL'), 1000)
  }
  const timeout = setTimeout(() => {
    timedOut = true
    terminate()
  }, options.seconds * 1000)
  process.once('SIGINT', terminate)
  process.once('SIGTERM', terminate)
  console.log(`GUI QA isolated session: ${session}`)
  let code: number
  try {
    code = await child.exited
  } finally {
    clearTimeout(timeout)
    if (forceKill) clearTimeout(forceKill)
    process.removeListener('SIGINT', terminate)
    process.removeListener('SIGTERM', terminate)
  }
  const passed = existsSync(join(session, 'guard-passed.json'))
  const rawResult: unknown = existsSync(join(session, 'command-result.json'))
    ? await Bun.file(join(session, 'command-result.json')).json()
    : null
  const result = commandResultSchema.safeParse(rawResult)
  if (!passed || code !== 0 || !result.success || result.data.code !== 0 || timedOut) {
    console.error(await log.text())
    console.error(
      `GUI QA ${!passed ? 'refused to launch the command' : timedOut ? 'timed out' : 'command failed'}; artifacts: ${session}`,
    )
    return timedOut ? 124 : (result.success ? result.data.code : undefined) || code || 1
  }
  console.log('GUI QA passed on its private virtual display.')
  if (!options.keep) rmSync(session, { recursive: true, force: true })
  return 0
}

if (import.meta.main) {
  try {
    switch (process.argv[2]) {
      case '--xvfb-session':
        process.exitCode = await xvfbSession(process.argv.slice(3))
        break
      case '--weston-session':
        process.exitCode = await westonSession(process.argv.slice(3))
        break
      default:
        process.exitCode = await run(parseGuiQaArguments(process.argv.slice(2)))
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
