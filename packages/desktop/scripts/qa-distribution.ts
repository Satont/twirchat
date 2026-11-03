import { mkdir } from 'node:fs/promises'
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
const emptyVulkanDrivers = join(session, 'empty-vulkan-drivers')
await mkdir(emptyVulkanDrivers, { mode: 0o700 })

const runtimeFailurePattern =
  /Invalid hook call|React render failed|Minified React error|Maximum update depth|cannot update GpuixView|panicked at|error while loading shared libraries|Segmentation fault|jsxDEV.*(?:not a function|not callable)/iu
const log = Bun.file(join(session, 'distribution-app.log')).writer()
let failure: Error | undefined
let runtimeFailure = false
let output = ''
let screenshot: string | undefined
const child = Bun.spawn([executable], {
  env: {
    ...process.env,
    APPIMAGE_EXTRACT_AND_RUN: '1',
    APPIMAGELAUNCHER_DISABLE: '1',
    VK_ICD_FILENAMES: emptyVulkanDrivers,
    VK_DRIVER_FILES: emptyVulkanDrivers,
    LIBGL_ALWAYS_SOFTWARE: 'true',
    GALLIUM_DRIVER: 'llvmpipe',
    RUST_LOG: 'gpui_wgpu=info,wgpu_hal=info,wgpu_core=warn',
  },
  detached: true,
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
})

async function collectOutput(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let tail = ''
  for await (const bytes of stream) {
    await log.write(bytes)
    await log.flush()
    tail = (tail + decoder.decode(bytes, { stream: true })).slice(-65_536)
    runtimeFailure ||= runtimeFailurePattern.test(tail)
  }
  return tail + decoder.decode()
}

function signalDistributionGroup(signal: 'SIGTERM' | 'SIGKILL'): void {
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return
    failure ??= error instanceof Error ? error : new Error(String(error))
  }
}

const streams = Promise.all([collectOutput(child.stdout), collectOutput(child.stderr)])
streams.catch((error: unknown) => {
  failure ??= error instanceof Error ? error : new Error(String(error))
})

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
  signalDistributionGroup('SIGTERM')
  const forceKill = setTimeout(() => signalDistributionGroup('SIGKILL'), 2000)
  try {
    const [, [stdout, stderr]] = await Promise.all([child.exited, streams])
    output = `${stdout}\n${stderr}`
  } finally {
    clearTimeout(forceKill)
    await log.end()
  }
}

if (runtimeFailure)
  failure ??= new Error('Distribution reported a JavaScript or native rendering failure.')
if (failure)
  throw new Error(`${failure.message}\nDistribution logs:\n${output.slice(-12_000)}`, {
    cause: failure,
  })
console.log(JSON.stringify({ screenshot, windowVisible: true, appImage: executable }))
