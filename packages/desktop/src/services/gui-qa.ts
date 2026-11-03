import {
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  type Stats,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { z } from 'zod'

type QaEnvironment = Record<string, string | undefined>
type BusSocket = Pick<Stats, 'uid' | 'isSocket'>

export function assertGuiQaPrivateBus(
  env: QaEnvironment,
  runtime: string,
  socketStat: (path: string) => BusSocket = lstatSync,
): void {
  const address = env.DBUS_SESSION_BUS_ADDRESS
  if (!address && !env.TWIRCHAT_QA_DBUS) return
  const socket = join(runtime, 'bus')
  if (
    env.TWIRCHAT_QA_DBUS !== '1' ||
    address !== `unix:path=${socket}` ||
    resolve(runtime) !== runtime ||
    realpathSync(runtime) !== runtime
  )
    throw new Error('GUI QA requires only its explicitly enabled private desktop bus.')
  privateDirectory(runtime)
  const stat = socketStat(socket)
  if (!stat.isSocket() || stat.uid !== process.getuid?.())
    throw new Error('GUI QA desktop bus must be an owned private Unix socket.')
}
function privateDirectory(path: string): void {
  const stat = statSync(path)
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
    throw new Error(`GUI QA requires a private directory owned by this user: ${path}`)
}
function checkedSession(env: QaEnvironment): { session: string; runtime: string } {
  if (process.platform !== 'linux') throw new Error('Isolated GUI QA currently requires Linux.')
  const session = env.TWIRCHAT_QA_SESSION_DIR,
    runtime = env.TWIRCHAT_QA_RUNTIME,
    nonce = env.TWIRCHAT_QA_NONCE
  if (
    env.TWIRCHAT_GUI_QA !== '1' ||
    env.GPUIX_BACKGROUND !== '1' ||
    !session ||
    !isAbsolute(session) ||
    !runtime ||
    runtime !== join(session, 'runtime') ||
    env.XDG_RUNTIME_DIR !== runtime ||
    !nonce ||
    !/^[a-f0-9]{24}$/u.test(nonce) ||
    env.TWIRCHAT_QA_APP_ID !== `dev.twirchat.qa.${nonce}` ||
    env.DB_PATH !== join(session, 'profile', 'db.sqlite')
  )
    throw new Error('GUI QA isolation markers are missing or inconsistent. Use bun run qa:gui.')
  privateDirectory(session)
  privateDirectory(runtime)
  privateDirectory(join(session, 'profile'))
  const markerPath = join(session, 'isolation.json'),
    markerStat = statSync(markerPath)
  if ((markerStat.mode & 0o077) !== 0 || markerStat.uid !== process.getuid?.())
    throw new Error('GUI QA isolation marker must be private and owned by this user.')
  const marker = z
    .object({ version: z.unknown().optional(), nonce: z.unknown().optional() })
    .parse(JSON.parse(readFileSync(markerPath, 'utf8')))
  if (marker.version !== 1 || marker.nonce !== nonce)
    throw new Error('Invalid GUI QA session marker.')
  if (env.HYPRLAND_INSTANCE_SIGNATURE)
    throw new Error('GUI QA must not inherit the host compositor or desktop bus.')
  assertGuiQaPrivateBus(env, runtime)
  if (
    !env.TWIRCHAT_QA_HOST_MOUNT_NS ||
    readlinkSync('/proc/self/ns/mnt') === env.TWIRCHAT_QA_HOST_MOUNT_NS
  )
    throw new Error('GUI QA is not running in its isolated filesystem namespace.')
  if (readdirSync('/dev').some((name) => /^tty\d+$|^console$/u.test(name)))
    throw new Error('GUI QA sandbox exposes a host virtual terminal.')
  try {
    if (readdirSync('/dev/dri').some((name) => /^card\d+$/u.test(name)))
      throw new Error('GUI QA sandbox exposes a physical display card.')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  return { session, runtime }
}

/** Validate device/filesystem isolation before starting even the virtual display server. */
export function assertGuiQaSandbox(env: QaEnvironment = process.env): void {
  checkedSession(env)
}

/** Fail closed before a native window can connect to a real desktop session. */
export function assertGuiQaEnvironment(env: QaEnvironment = process.env): void {
  const { runtime } = checkedSession(env)
  if (env.TWIRCHAT_QA_COMPOSITOR === 'xvfb') {
    if (env.WAYLAND_DISPLAY || env.GAMESCOPE_WAYLAND_DISPLAY || env.DISPLAY !== ':99')
      throw new Error('GUI QA must use only its private Xvfb display.')
    const authFile = join(runtime, 'xauthority')
    if (env.XAUTHORITY !== authFile || (statSync(authFile).mode & 0o077) !== 0)
      throw new Error('GUI QA requires a private X11 authorization cookie.')
    const server = z
      .object({ pid: z.unknown().optional() })
      .parse(JSON.parse(readFileSync(join(runtime, 'xvfb.json'), 'utf8')))
    if (!Number.isSafeInteger(server.pid) || Number(server.pid) <= 1)
      throw new Error('GUI QA Xvfb process marker is invalid.')
    const command = readFileSync(`/proc/${server.pid}/cmdline`, 'utf8').split('\0')
    if (
      command[0] !== '/usr/bin/Xvfb' ||
      !command.includes(authFile) ||
      !command.includes('-nolisten')
    )
      throw new Error('GUI QA Xvfb process does not match the private session.')
    if (!statSync('/tmp/.X11-unix/X99').isSocket())
      throw new Error('Private Xvfb socket is not ready.')
  } else {
    const display = env.WAYLAND_DISPLAY
    const root = env.TWIRCHAT_QA_WESTON_ROOT
    if (
      env.TWIRCHAT_QA_COMPOSITOR !== 'weston' ||
      env.DISPLAY ||
      env.XAUTHORITY ||
      display !== 'twirchat-qa' ||
      !root ||
      !isAbsolute(root)
    )
      throw new Error('GUI QA requires a verified private virtual display.')
    const socket = resolve(runtime, display)
    if (!socket.startsWith(`${runtime}/`) || !statSync(socket).isSocket())
      throw new Error('GUI QA Wayland socket is outside the private session or is not a socket.')
    const markerPath = join(runtime, 'weston.json')
    const markerStat = statSync(markerPath)
    if ((markerStat.mode & 0o077) !== 0 || markerStat.uid !== process.getuid?.())
      throw new Error('Private Weston process marker must be owned and private.')
    const server = z
      .object({ pid: z.number().int().min(2), binary: z.string() })
      .parse(JSON.parse(readFileSync(markerPath, 'utf8')))
    const binary = join(root, 'usr/bin/weston')
    const command = readFileSync(`/proc/${server.pid}/cmdline`, 'utf8').split('\0')
    if (
      server.binary !== binary ||
      command[0] !== binary ||
      !command.includes('--backend=headless') ||
      !command.includes('--renderer=gl') ||
      !command.includes('--no-config') ||
      !command.includes('--socket=twirchat-qa') ||
      readlinkSync(`/proc/${server.pid}/ns/mnt`) !== readlinkSync('/proc/self/ns/mnt')
    )
      throw new Error('GUI QA Weston process must use its private headless GL backend.')
  }
}
