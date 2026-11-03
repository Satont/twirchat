import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { captureGuiQaDisplay } from '../src/services/gui-qa-screenshot'
import { clickPrivateTrayMenu, privateTrayBus, privateTrayNames } from './qa-tray-dbus'
import { closeNativeQaWindow, focusNativeQaWindow, getNativeQaWindowGeometry } from './qa-x11'

assertGuiQaEnvironment()
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
const executable = resolve(process.argv[2] ?? join(import.meta.dir, '../dist/twirchat'))
assert(await Bun.file(executable).exists(), 'Build the executable before running this probe.')
const cwd = join(session, 'built-app-cwd')
await mkdir(cwd)
const child = Bun.spawn([executable], {
  cwd,
  env: process.env,
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
  timeout: 35_000,
})
const output = new Response(child.stdout).text()
const errors = new Response(child.stderr).text()
let screenshot: string | undefined
const privateBus = process.env.TWIRCHAT_QA_DBUS === '1'
let closeRestoreCycles = 0
async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!(await check())) {
    assert.equal(child.exitCode, null, `The packaged app exited while waiting for ${label}.`)
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(30)
  }
}
async function visible(): Promise<boolean> {
  const result = Bun.spawn(
    ['/usr/bin/xdotool', 'search', '--onlyvisible', '--name', '^TwirChat$'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 5000,
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ])
  assert(code === 0 || code === 1, `Could not inspect the private X11 window: ${stderr}`)
  return code === 0 && stdout.trim().length > 0
}
try {
  const deadline = performance.now() + 10_000
  let mapped = false
  while (performance.now() < deadline) {
    if (child.exitCode !== null) break
    try {
      const bounds = getNativeQaWindowGeometry('TwirChat')
      mapped = bounds.width >= 320 && bounds.height >= 240
    } catch {
      await Bun.sleep(30)
    }
    if (mapped) break
  }
  assert(mapped, 'The packaged app did not create its native main window.')
  await focusNativeQaWindow('TwirChat')
  await Bun.sleep(800)
  screenshot = await captureGuiQaDisplay('built-app')
  if (privateBus) {
    let item = ''
    await until(async () => {
      item =
        (await privateTrayNames()).find((name) => name.startsWith('org.kde.StatusNotifierItem-')) ??
        ''
      return item.length > 0
    }, 'the packaged app tray')
    for (let cycle = 0; cycle < 3; cycle++) {
      closeNativeQaWindow('TwirChat')
      await until(async () => !(await visible()), 'WM close hides the packaged app')
      await Bun.sleep(250)
      assert.equal(child.exitCode, null, 'The packaged process must stay alive in its tray.')
      assert((await privateTrayNames()).includes(item), 'Closing must retain the same tray item.')
      if (cycle % 2 === 0)
        await privateTrayBus(item, '/StatusNotifierItem', 'org.kde.StatusNotifierItem.Activate', [
          '0',
          '0',
        ])
      else await clickPrivateTrayMenu(item, 'Open TwirChat')
      await until(visible, 'tray activation restores the packaged app')
      await focusNativeQaWindow('TwirChat')
      closeRestoreCycles++
    }
    screenshot = await captureGuiQaDisplay('built-app-restored')
    closeNativeQaWindow('TwirChat')
    await until(async () => !(await visible()), 'the app hides before Quit')
    await clickPrivateTrayMenu(item, 'Quit TwirChat')
  } else closeNativeQaWindow('TwirChat')
  const code = await child.exited
  assert.equal(
    code,
    0,
    privateBus
      ? 'The packaged app did not exit cleanly through its tray menu.'
      : 'Without a tray, the packaged app must exit cleanly after its last window closes.',
  )
} finally {
  if (child.exitCode === null) child.kill()
  await child.exited
  const stdout = await output
  const stderr = await errors
  await Bun.write(join(session, 'built-app-stdout.log'), stdout)
  await Bun.write(join(session, 'built-app-stderr.log'), stderr)
  assert(!stderr.includes('Invalid hook call'), 'The packaged app emitted an invalid-hook warning.')
  assert(!stderr.includes('[windows] React render failed'), 'The packaged React tree failed.')
  await Bun.write(
    join(session, 'built-app-result.json'),
    JSON.stringify(
      { code: child.exitCode, executable, cwd, screenshot, privateBus, closeRestoreCycles },
      null,
      2,
    ),
  )
}
