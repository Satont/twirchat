import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { captureGuiQaDisplay } from '../src/services/gui-qa-screenshot'
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
  timeout: 20_000,
})
const output = new Response(child.stdout).text()
const errors = new Response(child.stderr).text()
let screenshot: string | undefined
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
  closeNativeQaWindow('TwirChat')
  const code = await child.exited
  assert.equal(code, 0, 'The packaged app did not exit cleanly after its last window closed.')
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
    JSON.stringify({ code: child.exitCode, executable, cwd, screenshot }, null, 2),
  )
}
