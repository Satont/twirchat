import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { westonArguments, parseGuiQaArguments, sandboxArguments } from '../scripts/qa-gui'
import { assertGuiQaEnvironment, assertGuiQaPrivateBus } from '../src/services/gui-qa'
import { decodeQaFramebuffer } from '../src/services/gui-qa-screenshot'
import { required } from './fixture-values'

test.skipIf(process.platform !== 'linux')(
  'GUI QA never accepts an ambient desktop environment as isolated',
  () => {
    expect(() => assertGuiQaEnvironment({})).toThrow('isolation markers')
    expect(() => assertGuiQaEnvironment({ GPUIX_BACKGROUND: '1' })).toThrow('isolation markers')
    expect(() =>
      assertGuiQaEnvironment({
        TWIRCHAT_GUI_QA: '1',
        GPUIX_BACKGROUND: '1',
        TWIRCHAT_QA_SESSION_DIR: '/tmp/qa',
        TWIRCHAT_QA_RUNTIME: '/run/user/1000',
        XDG_RUNTIME_DIR: '/run/user/1000',
      }),
    ).toThrow('isolation markers')
  },
)

test('GUI QA arguments retain literal command arguments and require an explicit separator', () => {
  expect(parseGuiQaArguments(['--dbus', '--', '/usr/bin/true']).dbus).toBe(true)
  expect(
    parseGuiQaArguments(['--timeout', '12', '--keep', '--', 'bun', 'qa.ts', '$(echo bad)']),
  ).toEqual({
    seconds: 12,
    keep: true,
    command: ['bun', 'qa.ts', '$(echo bad)'],
    nodeEnv: 'development',
  })
  expect(() => parseGuiQaArguments(['--timeout', '0'])).toThrow('at most 600')
  expect(() => parseGuiQaArguments(['--timeout', 'Infinity'])).toThrow('at most 600')
  expect(() => parseGuiQaArguments(['bun', 'qa.ts'])).toThrow('Put the command after --')
  expect(parseGuiQaArguments(['--node-env', 'production']).nodeEnv).toBe('production')
  expect(() => parseGuiQaArguments(['--node-env', 'staging'])).toThrow('development or production')
  expect(() => parseGuiQaArguments(['--node-env'])).toThrow('development or production')
})

test('GUI QA React mode defaults never inherit the host NODE_ENV', () => {
  const previous = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'production'
    expect(parseGuiQaArguments([]).nodeEnv).toBe('development')
    expect(parseGuiQaArguments(['--node-env', 'production']).nodeEnv).toBe('production')
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
})

test('Weston controls require the private Weston backend and preserve the child command', () => {
  expect(() => parseGuiQaArguments(['--weston-controls'])).toThrow('--compositor weston')
  expect(() => parseGuiQaArguments(['--weston-controls', '--compositor', 'xvfb'])).toThrow(
    '--compositor weston',
  )
  const options = parseGuiQaArguments([
    '--weston-controls',
    '--dbus',
    '--compositor',
    'weston',
    '--',
    'bun',
    'probe.ts',
    '--weston-controls',
  ])
  expect(options.compositor).toBe('weston')
  expect(options.westonControls).toBe(true)
  expect(options.dbus).toBe(true)
  expect(options.command).toEqual(['bun', 'probe.ts', '--weston-controls'])
})

test('private QA bus rejects host addresses, alternate transports and unowned sockets', async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'qa-bus-'))
  const socket = join(runtime, 'bus')
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socket, resolve)
    })
    const address = `unix:path=${socket}`
    expect(() => assertGuiQaPrivateBus({}, runtime)).not.toThrow()
    expect(() =>
      assertGuiQaPrivateBus({ TWIRCHAT_QA_DBUS: '1', DBUS_SESSION_BUS_ADDRESS: address }, runtime),
    ).not.toThrow()
    for (const invalid of [
      'unix:path=/run/user/1000/bus',
      `${address}-host`,
      `${address},guid=0123456789abcdef`,
      `${address};unix:path=/run/user/1000/bus`,
      `unix:path=${runtime}/../bus`,
      'tcp:host=localhost,port=1234',
    ])
      expect(() =>
        assertGuiQaPrivateBus(
          { TWIRCHAT_QA_DBUS: '1', DBUS_SESSION_BUS_ADDRESS: invalid },
          runtime,
        ),
      ).toThrow('explicitly enabled private')
    expect(() => assertGuiQaPrivateBus({ DBUS_SESSION_BUS_ADDRESS: address }, runtime)).toThrow()
    expect(() => assertGuiQaPrivateBus({ TWIRCHAT_QA_DBUS: '1' }, runtime)).toThrow()
    expect(() =>
      assertGuiQaPrivateBus(
        { TWIRCHAT_QA_DBUS: '1', DBUS_SESSION_BUS_ADDRESS: address },
        runtime,
        () => ({ uid: Number(process.getuid?.()) + 1, isSocket: () => true }),
      ),
    ).toThrow('owned private Unix socket')
    expect(() =>
      assertGuiQaPrivateBus(
        { TWIRCHAT_QA_DBUS: '1', DBUS_SESSION_BUS_ADDRESS: address },
        runtime,
        () => ({ uid: Number(process.getuid?.()), isSocket: () => false }),
      ),
    ).toThrow('owned private Unix socket')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(runtime, { recursive: true, force: true })
  }
})

test('GUI QA sandbox cannot inherit host sockets, environment, network, or physical display devices', () => {
  const args = sandboxArguments('/tmp/session', '/workspace/chat', '/usr/bin/bun')
  expect(args).toContain('--unshare-all')
  expect(args).not.toContain('--share-net')
  expect(args).toContain('--clearenv')
  expect(args).toContain('--new-session')
  expect(args).toContain('--die-with-parent')
  expect(args.join(' ')).toContain('--tmpfs /run --tmpfs /tmp')
  expect(args.join(' ')).toContain('--ro-bind /workspace/chat /workspace/chat')
  expect(
    args
      .filter((value) => value.startsWith('/dev/dri/'))
      .every((value) => /\/renderD\d+$/u.test(value)),
  ).toBe(true)
  expect(args).not.toContain('/run/user/1000')
  expect(args).not.toContain('/tmp/.X11-unix')
})

test('headless GPU QA requires an explicit compositor and cannot choose a physical backend', () => {
  expect(parseGuiQaArguments(['--compositor', 'weston', '--', 'bun', 'probe.ts'])).toEqual({
    command: ['bun', 'probe.ts'],
    seconds: 30,
    keep: false,
    compositor: 'weston',
    nodeEnv: 'development',
  })
  expect(() => parseGuiQaArguments(['--compositor', 'drm'])).toThrow('xvfb or weston')
  expect(() => parseGuiQaArguments(['--compositor'])).toThrow('xvfb or weston')
  const args = westonArguments()
  expect(args.slice(0, 3)).toEqual([
    '--backend=headless',
    '--renderer=gl',
    '--shell=kiosk-shell.so',
  ])
  expect(args).not.toContain('drm')
  expect(args).not.toContain('auto')
  expect(args).toContain('--no-config')
  expect(args).toContain('--socket=twirchat-qa')
})

test('private framebuffer decoder handles byte order and rejects truncated buffers', () => {
  for (const order of [0, 1]) {
    const frame = Buffer.alloc(116)
    const fields: Record<number, number> = {
      0: 104,
      1: 7,
      2: 2,
      3: 24,
      4: 2,
      5: 1,
      7: order,
      11: 32,
      12: 12,
      13: 4,
      14: 0xff0000,
      15: 0xff00,
      16: 0xff,
    }
    for (const [index, value] of Object.entries(fields))
      frame.writeUInt32BE(value, Number(index) * 4)
    if (order === 0) {
      frame.writeUInt32LE(0xff002a, 104)
      frame.writeUInt32LE(0x2266aa, 108)
    } else {
      frame.writeUInt32BE(0xff002a, 104)
      frame.writeUInt32BE(0x2266aa, 108)
    }
    expect(decodeQaFramebuffer(frame)).toEqual({
      width: 2,
      height: 1,
      pixels: Buffer.from([255, 0, 42, 255, 34, 102, 170, 255]),
    })
    expect(() => decodeQaFramebuffer(frame.subarray(0, 115))).toThrow('incomplete')
  }
  expect(() => decodeQaFramebuffer(Buffer.alloc(10))).toThrow('Truncated')
})

test.skipIf(
  process.platform !== 'linux' ||
    !['/usr/bin/bwrap', '/usr/bin/Xvfb', '/usr/bin/xauth'].every(existsSync),
)('parallel virtual displays isolate sessions and preserve command failures', async () => {
  const launcher = join(import.meta.dir, '../scripts/qa-gui.ts')
  const run = async () => {
    const child = Bun.spawn(
      [process.execPath, launcher, '--timeout', '10', '--keep', '--', '/usr/bin/false'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const output = await new Response(child.stdout).text()
    const errors = await new Response(child.stderr).text()
    const code = await child.exited
    const session = output.match(/GUI QA isolated session: (.+)/u)?.[1]
    try {
      expect(errors).toContain('command failed')
      expect(code).toBe(1)
      expect(session).toBeDefined()
      const guard = await Bun.file(join(required(session), 'guard-passed.json')).json()
      expect(guard.compositor).toBe('xvfb')
      expect(guard.display).toBe(':99')
      expect(guard.runtime).toBe(join(required(session), 'runtime'))
      expect(guard.displayCards).toBe(false)
      expect(guard.virtualTerminals).toBe(false)
      return session
    } finally {
      if (session) rmSync(session, { recursive: true, force: true })
    }
  }
  const sessions = await Promise.all([run(), run()])
  expect(sessions[0]).not.toBe(sessions[1])
})

test.skipIf(
  process.platform !== 'linux' ||
    ![
      '/usr/bin/bwrap',
      '/usr/bin/Xvfb',
      '/usr/bin/xauth',
      '/usr/bin/dbus-daemon',
      '/usr/bin/dbus-send',
    ].every(existsSync),
)(
  'optional QA bus starts only inside the private namespace and discards host bus addresses',
  async () => {
    const launcher = join(import.meta.dir, '../scripts/qa-gui.ts')
    const child = Bun.spawn(
      [
        process.execPath,
        launcher,
        '--dbus',
        '--timeout',
        '10',
        '--keep',
        '--',
        '/usr/bin/dbus-send',
        '--session',
        '--print-reply',
        '--dest=org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        'org.freedesktop.DBus.ListNames',
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
          HYPRLAND_INSTANCE_SIGNATURE: 'host-compositor-must-not-be-inherited',
        },
      },
    )
    const output = await new Response(child.stdout).text()
    const errors = await new Response(child.stderr).text()
    const code = await child.exited
    const session = output.match(/GUI QA isolated session: (.+)/u)?.[1]
    try {
      expect(errors).toBe('')
      expect(code).toBe(0)
      const directory = required(session)
      const guard = await Bun.file(join(directory, 'guard-passed.json')).json()
      expect(guard.privateBus).toBe(`unix:path=${directory}/runtime/bus`)
      const log = await Bun.file(join(directory, 'compositor.log')).text()
      expect(log).toContain('org.freedesktop.DBus')
      expect(log).not.toContain('host-compositor-must-not-be-inherited')
    } finally {
      if (session) rmSync(session, { recursive: true, force: true })
    }
  },
)
