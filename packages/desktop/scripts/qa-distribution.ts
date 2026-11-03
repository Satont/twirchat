import { isAbsolute, join } from 'node:path'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { captureGuiQaDisplay, decodeQaFramebuffer } from '../src/services/gui-qa-screenshot'
import { distributionFrameHasPaint } from './qa-distribution-frame'
import { closeNativeQaWindow, focusNativeQaWindow, getNativeQaWindowGeometry } from './qa-x11'

assertGuiQaEnvironment()
const executable = process.argv[2]
if (process.argv.length !== 3 || !executable || !isAbsolute(executable))
  throw new Error('Usage inside qa:gui: bun scripts/qa-distribution.ts /absolute/path.AppImage')
const session = process.env.TWIRCHAT_QA_SESSION_DIR
if (!session) throw new Error('Missing private GUI QA session directory.')

const child = Bun.spawn([executable], {
  env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', APPIMAGELAUNCHER_DISABLE: '1' },
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
})
const stdout = new Response(child.stdout).text()
const stderr = new Response(child.stderr).text()
let failure: Error | undefined
let screenshot: string | undefined

try {
  const deadline = performance.now() + 20_000
  let visible = false
  while (performance.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Distribution exited before opening its private window (${child.exitCode}).`)
    try {
      const geometry = getNativeQaWindowGeometry('TwirChat')
      visible = geometry.width >= 300 && geometry.height >= 200
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/^Private X11 window (?:lookup failed|not found)/u.test(error.message)
      )
        throw error
      // Xvfb is already verified; the application may still be creating its first window.
    }
    if (visible) break
    await Bun.sleep(100)
  }
  if (!visible)
    throw new Error('Distribution did not show a private test window within 20 seconds.')
  await focusNativeQaWindow('TwirChat')
  const paintDeadline = performance.now() + 10_000
  let painted = false
  while (performance.now() < paintDeadline) {
    if (child.exitCode !== null)
      throw new Error(`Distribution exited before painting its window (${child.exitCode}).`)
    const frame = decodeQaFramebuffer(
      Buffer.from(await Bun.file(join(session, 'framebuffer', 'Xvfb_screen0')).arrayBuffer()),
    )
    painted = distributionFrameHasPaint(frame)
    if (painted) break
    await Bun.sleep(150)
  }
  if (!painted) {
    screenshot = await captureGuiQaDisplay('distribution-app')
    throw new Error(
      'Distribution window stayed blank: no meaningful painted frame within 10 seconds.',
    )
  }
  await Bun.sleep(1500)
  if (child.exitCode !== null)
    throw new Error(`Distribution exited immediately after opening its window (${child.exitCode}).`)
  screenshot = await captureGuiQaDisplay('distribution-app')
  const settledFrame = decodeQaFramebuffer(
    Buffer.from(await Bun.file(join(session, 'framebuffer', 'Xvfb_screen0')).arrayBuffer()),
  )
  if (!distributionFrameHasPaint(settledFrame))
    throw new Error('Distribution became blank after its initial painted frame.')
  closeNativeQaWindow('TwirChat')
  await Promise.race([child.exited, Bun.sleep(2000)])
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error))
  if (!screenshot)
    try {
      screenshot = await captureGuiQaDisplay('distribution-app')
    } catch (captureError) {
      failure = new AggregateError([failure, captureError], failure.message)
    }
} finally {
  if (child.exitCode === null) child.kill('SIGTERM')
  const forceKill = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, 2000)
  try {
    await child.exited
  } finally {
    clearTimeout(forceKill)
  }
}

const output = `${await stdout}\n${await stderr}`
await Bun.write(join(session, 'distribution-app.log'), output)
if (
  /Invalid hook call|React render failed|Minified React error|Maximum update depth|cannot update GpuixView|panicked at|error while loading shared libraries|Segmentation fault|jsxDEV.*(?:not a function|not callable)/iu.test(
    output,
  )
)
  failure ??= new Error('Distribution reported a JavaScript or native rendering failure.')
if (failure)
  throw new Error(`${failure.message}\nDistribution logs:\n${output.slice(-12_000)}`, {
    cause: failure,
  })
console.log(JSON.stringify({ screenshot, windowVisible: true, appImage: executable }))
