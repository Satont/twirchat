import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type { Props, PublicInstance } from '@gpuix/react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
assert.equal(process.env.TWIRCHAT_QA_COMPOSITOR, 'xvfb')
const directory = process.env.TWIRCHAT_QA_SESSION_DIR
assert(directory, 'The isolated launcher must provide an artifact directory.')
const framebuffer = join(directory, 'framebuffer/Xvfb_screen0')
let expectPaused = false
let expectUnsynchronized = false
let measure = false
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index]
  if (argument === '--expect-paused') expectPaused = true
  else if (argument === '--expect-unsynchronized') expectUnsynchronized = true
  else if (argument === '--measure') measure = true
  else if (argument === '--native' || argument === '--native-manifest') {
    const path = process.argv[++index]
    assert(path && isAbsolute(path), `${argument} requires an absolute path.`)
    assert(await Bun.file(path).exists(), `${argument} must exist in the private sandbox.`)
    if (argument === '--native') process.env.NAPI_RS_NATIVE_LIBRARY_PATH = path
  } else throw new Error(`Unknown background-image QA argument: ${argument}`)
}
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { createRenderer, createRoot, startFrameLoop, useGpuixRequired } =
  await import('@gpuix/react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { EmoteArtwork } = await import('../src/gpuix/components/ui/EmoteArtwork')
const { imageSnapshot } = await import('../src/gpuix/state/image-cache')
const { modifiedEmoteImage } = await import('../src/services/emote-image')
const { captureGuiQaDisplay, decodeQaFramebuffer } =
  await import('../src/services/gui-qa-screenshot')
const { focusNativeQaWindow, getNativeQaWindowGeometry } = await import('./qa-x11')
const sharp = (await import('sharp')).default

interface PixelEvidence {
  width: number
  phase: string
  uniqueFrames: Record<string, number>
  nativeBatches: number
  renders: number
  screenshot: string
  crossWindowTiming?: CrossWindowTiming
  synchronization: {
    samples: number
    sameWindowMismatches: number
    transformedMismatches: number
    crossWindowMismatches: number
  }
}
interface PixelPoint {
  name: string
  x: number
  y: number
}
interface PixelLayout {
  width: number
  height: number
  rowBytes: number
  pixelsOffset: number
  littleEndian: boolean
  masks: number[]
  shifts: number[]
}
interface PixelTransition {
  signature: string
  elapsedMs: number
}
interface CrossWindowTiming {
  durationMs: number
  main: PixelTransition[]
  other: PixelTransition[]
  mainToOtherSkewsMs: number[]
  otherToMainSkewsMs: number[]
  polling: { samples: number; medianMs: number; p95Ms: number; maxMs: number }
}
interface ResourceEvidence {
  repetition: number
  phase: string
  durationMs: number
  cpuPercent: number
  rssMedian: number
  rssPeak: number
  heapPeak: number
  lagP95Ms: number
  nativeBatches: number
}
type ContentMode = 'images' | 'empty'
type LifecycleEvidence =
  | {
      phase: 'empty'
      mainFrameGrowth: number
      otherFrameGrowth: number
      nativeBatches: number
      renders: number
    }
  | { phase: 'restored' }
  | { phase: 'pending-close'; closeMs: number; frameDelays: number[]; reactErrors: string[] }
const evidence: PixelEvidence[] = []
const resources: ResourceEvidence[] = []
const lifecycle: LifecycleEvidence[] = []
const reactErrors: string[] = []
const imageSize = 48
const colors = [
  Buffer.from([240, 30, 20, 255]),
  Buffer.from([20, 220, 30, 255]),
  Buffer.from([20, 30, 240, 255]),
]
const frames = colors.map((color) => {
  const frame = Buffer.alloc(imageSize * imageSize * 4)
  for (let offset = 0; offset < frame.length; offset += 4) color.copy(frame, offset)
  return frame
})
const raw = {
  width: imageSize,
  height: imageSize * frames.length,
  pageHeight: imageSize,
  channels: 4,
} satisfies import('sharp').CreateRaw
const gif = await sharp(Buffer.concat(frames), { raw })
  .gif({ delay: [100, 100, 100], loop: 0 })
  .toBuffer()
const webp = await sharp(Buffer.concat(frames), { raw })
  .webp({ lossless: true, delay: [100, 100, 100], loop: 0 })
  .toBuffer()
for (const [name, bytes] of new Map([
  ['generated.gif', gif],
  ['generated.webp', webp],
])) {
  await Bun.write(join(directory, name), bytes)
  assert.equal(
    (await sharp(bytes, { animated: true }).metadata()).pages,
    3,
    `${name} must have three frames.`,
  )
}
let slowGif: Buffer | undefined
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === '/slow.gif') {
      return slowGif
        ? new Response(new Uint8Array(slowGif), { headers: { 'content-type': 'image/gif' } })
        : new Response(null, { status: 404 })
    }
    const isGif = new URL(request.url).pathname.endsWith('.gif')
    return new Response(isGif ? gif : webp, {
      headers: { 'content-type': isGif ? 'image/gif' : 'image/webp' },
    })
  },
})
const gifUrl = `http://127.0.0.1:${server.port}/generated.gif`
const webpUrl = `http://127.0.0.1:${server.port}/generated.webp`
const elements = new Map<string, number>()
const remember = (name: string) => (element: PublicInstance | null) => {
  if (element) elements.set(name, element.id)
  else elements.delete(name)
}
const otherElements = new Map<string, number>()
let addCopies: Dispatch<SetStateAction<number>> | undefined
let setContentMode: Dispatch<SetStateAction<ContentMode>> | undefined
const mounts: Array<{ copies: number; elapsedMs: number }> = []
let renderer: GpuixRenderer | undefined
let renders = 0
let nativeBatches = 0
function host(tag: 'div' | 'text', props: Props, ...children: ReactNode[]) {
  return React.createElement<Props>(tag, props, ...children)
}
function Content() {
  renders++
  const active = useGpuixRequired()
  const [copies, setCopies] = React.useState(0)
  const [mode, setMode] = React.useState<ContentMode>('images')
  React.useEffect(() => {
    addCopies = setCopies
    setContentMode = setMode
    return () => {
      addCopies = undefined
      setContentMode = undefined
    }
  }, [])
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    renderer = active
    const apply = active.applyBatch.bind(active)
    Object.defineProperty(active, 'applyBatch', {
      configurable: true,
      value: (...args: Parameters<typeof apply>) => {
        nativeBatches++
        return apply(...args)
      },
    })
  }, [active])
  if (mode === 'empty')
    return host('div', { style: { width: '100%', height: '100%', backgroundColor: '#16161c' } })
  const artwork = (name: string, url: string, modifiers: string[] = []) =>
    host(
      'div',
      {
        key: name,
        ref: remember(name),
        style: { width: imageSize, height: imageSize, flexShrink: 0 },
      },
      React.createElement(EmoteArtwork, { url, width: imageSize, height: imageSize, modifiers }),
    )
  const row = (children: ReactNode[]) =>
    host(
      'div',
      {
        style: { display: 'flex', flexDirection: 'row', gap: 24, flexShrink: 0 },
      },
      ...children,
    )
  return host(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: 24,
        gap: 16,
        backgroundColor: '#16161c',
      },
    },
    row([
      artwork('gif', gifUrl),
      artwork('webp', webpUrl),
      artwork('transformed', gifUrl, ['flip-horizontal']),
    ]),
    row([
      copies >= 1 ? artwork('gif-late-a', gifUrl) : null,
      copies >= 2 ? artwork('gif-late-b', gifUrl) : null,
      copies >= 2 ? artwork('transformed-late', gifUrl, ['flip-horizontal']) : null,
    ]),
  )
}
const backend = getDesktopBackend()
const manager = new DesktopWindowManager(
  backend,
  () => React.createElement(Content),
  () => {},
)
const other = nativeWindow(createRenderer())
const otherTitle = 'TwirChat private background image focus target'
initializeManagedRenderer(other, { title: otherTitle, width: 260, height: 240, focus: false })
const otherRoot = createRoot(other, { onUncaughtError: (error) => reactErrors.push(String(error)) })
const otherLoop = startFrameLoop(other)
let otherClosed = false
let managerClosed = false
otherRoot.render(
  host('div', { style: { width: '100%', height: '100%', backgroundColor: '#554477' } }),
)
function renderOtherImage(url: string) {
  otherRoot.render(
    host(
      'div',
      {
        style: { width: '100%', height: '100%', padding: 24, backgroundColor: '#554477' },
      },
      host(
        'div',
        {
          ref: (element: PublicInstance | null) => {
            if (element) otherElements.set('gif', element.id)
            else otherElements.delete('gif')
          },
          style: { width: imageSize, height: imageSize },
        },
        React.createElement(EmoteArtwork, { url, width: imageSize, height: imageSize }),
      ),
    ),
  )
}
function current() {
  assert(renderer, 'The main native renderer must have mounted.')
  return nativeWindow(renderer)
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(25)
  }
}
async function focusMain() {
  await focusNativeQaWindow('TwirChat')
  await until(() => current().isWindowActive(), 'main native activation')
}
async function focusOther() {
  await focusNativeQaWindow(otherTitle)
  await until(
    () => !current().isWindowActive() && other.isWindowActive(),
    'main native deactivation',
  )
  assert.equal(current().getWindowVisibility(), 'visible', 'Unfocused window must remain visible.')
}
// Independent 30 fps inactive and 60 Hz X11 paints can differ by 50 ms; allow polling jitter.
const maximumPresentationSkewMs = 75
function validatedPixelLayout(buffer: Buffer): PixelLayout {
  const validated = decodeQaFramebuffer(buffer)
  const masks = [buffer.readUInt32BE(56), buffer.readUInt32BE(60), buffer.readUInt32BE(64)]
  return {
    width: validated.width,
    height: validated.height,
    rowBytes: buffer.readUInt32BE(48),
    pixelsOffset: buffer.readUInt32BE(0) + buffer.readUInt32BE(76) * 12,
    littleEndian: buffer.readUInt32BE(28) === 0,
    masks,
    shifts: masks.map((mask) => {
      let shift = 0
      while (shift < 32 && !((mask >>> shift) & 1)) shift++
      return shift
    }),
  }
}
function pointSignature(buffer: Buffer, layout: PixelLayout, point: PixelPoint): string {
  assert(point.x >= 0 && point.x < layout.width && point.y >= 0 && point.y < layout.height)
  const offset = layout.pixelsOffset + point.y * layout.rowBytes + point.x * 4
  const pixel = layout.littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
  return layout.masks
    .map((mask, index) =>
      ((pixel & mask) >>> (layout.shifts[index] ?? 0)).toString(16).padStart(2, '0'),
    )
    .join('')
}
function transitionSkews(
  from: PixelTransition[],
  to: PixelTransition[],
  durationMs: number,
): number[] {
  return from
    .filter(
      (transition) =>
        transition.elapsedMs >= maximumPresentationSkewMs &&
        transition.elapsedMs <= durationMs - maximumPresentationSkewMs,
    )
    .map((transition) => {
      let nearest: PixelTransition | undefined
      for (const candidate of to) {
        if (candidate.signature !== transition.signature) continue
        if (
          !nearest ||
          Math.abs(candidate.elapsedMs - transition.elapsedMs) <
            Math.abs(nearest.elapsedMs - transition.elapsedMs)
        )
          nearest = candidate
      }
      assert(nearest, `No corresponding transition for ${transition.signature}.`)
      return nearest.elapsedMs - transition.elapsedMs
    })
}
async function crossWindowTiming(main: PixelPoint, other: PixelPoint): Promise<CrossWindowTiming> {
  const initial = Buffer.from(await Bun.file(framebuffer).arrayBuffer())
  const layout = validatedPixelLayout(initial)
  let previousMain = pointSignature(initial, layout, main)
  let previousOther = pointSignature(initial, layout, other)
  const mainTransitions: PixelTransition[] = []
  const otherTransitions: PixelTransition[] = []
  const intervals: number[] = []
  const started = performance.now()
  let lastSample = started
  while (performance.now() - started < 1500) {
    await Bun.sleep(5)
    const buffer = Buffer.from(await Bun.file(framebuffer).arrayBuffer())
    const sampled = performance.now()
    intervals.push(sampled - lastSample)
    lastSample = sampled
    const currentMain = pointSignature(buffer, layout, main)
    const currentOther = pointSignature(buffer, layout, other)
    if (currentMain !== previousMain)
      mainTransitions.push({ signature: currentMain, elapsedMs: sampled - started })
    if (currentOther !== previousOther)
      otherTransitions.push({ signature: currentOther, elapsedMs: sampled - started })
    previousMain = currentMain
    previousOther = currentOther
  }
  const durationMs = lastSample - started
  const sorted = intervals.toSorted((a, b) => a - b)
  return {
    durationMs,
    main: mainTransitions,
    other: otherTransitions,
    mainToOtherSkewsMs: transitionSkews(mainTransitions, otherTransitions, durationMs),
    otherToMainSkewsMs: transitionSkews(otherTransitions, mainTransitions, durationMs),
    polling: {
      samples: intervals.length,
      medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      maxMs: Math.max(...intervals),
    },
  }
}
async function pixels(width: number, phase: string, animated: boolean) {
  await Bun.sleep(350)
  const batchesBefore = nativeBatches
  const rendersBefore = renders
  const geometry = getNativeQaWindowGeometry('TwirChat')
  const boxes = [...elements].map(([name, id]) => {
    const box = current().getPaintedElementBounds(id)
    assert(box, `${name} must have painted bounds.`)
    return {
      name,
      x: Math.round(geometry.x + box.x + box.width / 2),
      y: Math.round(geometry.y + box.y + box.height / 2),
    }
  })
  assert.equal(boxes.length, 6)
  const otherGeometry = getNativeQaWindowGeometry(otherTitle)
  const otherId = otherElements.get('gif')
  assert(otherId !== undefined, 'The second-window GIF must have mounted.')
  const otherBox = other.getPaintedElementBounds(otherId)
  assert(otherBox, 'The second-window GIF must have painted bounds.')
  boxes.push({
    name: 'other-gif',
    x: Math.round(otherGeometry.x + otherBox.x + otherBox.width / 2),
    y: Math.round(otherGeometry.y + otherBox.y + otherBox.height / 2),
  })
  const signatures = new Map(boxes.map(({ name }) => [name, new Set<string>()]))
  const synchronization = {
    samples: 21,
    sameWindowMismatches: 0,
    transformedMismatches: 0,
    crossWindowMismatches: 0,
  }
  for (let sample = 0; sample < synchronization.samples; sample++) {
    const frame = decodeQaFramebuffer(Buffer.from(await Bun.file(framebuffer).arrayBuffer()))
    const simultaneous = new Map<string, string>()
    for (const box of boxes) {
      assert(box.x >= 0 && box.x < frame.width && box.y >= 0 && box.y < frame.height)
      const offset = (box.y * frame.width + box.x) * 4
      const signature = frame.pixels.subarray(offset, offset + 3).toString('hex')
      signatures.get(box.name)?.add(signature)
      simultaneous.set(box.name, signature)
    }
    const first = simultaneous.get('gif')
    if (first !== simultaneous.get('gif-late-a') || first !== simultaneous.get('gif-late-b'))
      synchronization.sameWindowMismatches++
    if (simultaneous.get('transformed') !== simultaneous.get('transformed-late'))
      synchronization.transformedMismatches++
    if (first !== simultaneous.get('other-gif')) synchronization.crossWindowMismatches++
    await Bun.sleep(47)
  }
  const uniqueFrames = Object.fromEntries(
    [...signatures].map(([name, values]) => [name, values.size]),
  )
  for (const [name, count] of Object.entries(uniqueFrames)) {
    const shouldAnimate =
      name === 'other-gif'
        ? !expectPaused || phase.startsWith('inactive') || phase.startsWith('restored')
        : animated
    assert(
      shouldAnimate ? count > 1 : count === 1,
      `${name} ${phase} at ${width}px: ${count} unique frames; expected ${shouldAnimate ? 'animation' : 'pause'}.`,
    )
  }
  let timing: CrossWindowTiming | undefined
  if (!expectPaused && !expectUnsynchronized) {
    assert.equal(
      synchronization.sameWindowMismatches,
      0,
      `GIF copies must share the exact native frame in ${phase}.`,
    )
    assert.equal(
      synchronization.transformedMismatches,
      0,
      `Transformed copies must share the exact native frame in ${phase}.`,
    )
    const mainPoint = boxes.find((point) => point.name === 'gif')
    const otherPoint = boxes.find((point) => point.name === 'other-gif')
    assert(mainPoint && otherPoint)
    timing = await crossWindowTiming(mainPoint, otherPoint)
  }
  assert.equal(nativeBatches, batchesBefore, 'Native frames must advance without React mutations.')
  assert.equal(renders, rendersBefore, 'Focus changes must not rerender the fixture.')
  const screenshot = await captureGuiQaDisplay(`background-${width}-${phase}`)
  evidence.push({
    width,
    phase,
    uniqueFrames,
    nativeBatches: nativeBatches - batchesBefore,
    renders: renders - rendersBefore,
    screenshot,
    synchronization,
    crossWindowTiming: timing,
  })
  if (timing) {
    for (const skews of [timing.mainToOtherSkewsMs, timing.otherToMainSkewsMs]) {
      assert(
        skews.length >= 6,
        `Not enough matched cross-window transitions in ${phase}: ${JSON.stringify(timing)}`,
      )
      assert(
        skews.every((skew) => Math.abs(skew) <= maximumPresentationSkewMs),
        `Cross-window transition skew exceeds ${maximumPresentationSkewMs} ms in ${phase}: ${JSON.stringify(timing)}`,
      )
    }
  }
}
function x11(args: string[]): string {
  assertGuiQaEnvironment()
  assert.equal(process.env.DISPLAY, ':99')
  const command = Bun.spawnSync(['/usr/bin/xdotool', ...args], { timeout: 5000, env: process.env })
  assert.equal(command.exitCode, 0, command.stderr.toString())
  return command.stdout.toString().trim()
}
let mainWindowId = ''
async function mapped(visible: boolean) {
  assert(/^\d+$/u.test(mainWindowId), 'A private main window ID is required.')
  x11([visible ? 'windowmap' : 'windowunmap', '--sync', mainWindowId])
  await until(
    () => current().getWindowVisibility() === (visible ? 'visible' : 'hidden'),
    'native visibility change',
  )
}
async function sampleResources(repetition: number, phase: string) {
  await Bun.sleep(350)
  const rss: number[] = []
  const lag: number[] = []
  let heapPeak = 0
  let expected = performance.now() + 50
  const timer = setInterval(() => {
    const now = performance.now()
    lag.push(Math.max(0, now - expected))
    expected = now + 50
    const memory = process.memoryUsage()
    rss.push(memory.rss)
    heapPeak = Math.max(heapPeak, memory.heapUsed)
  }, 50)
  const batchesBefore = nativeBatches
  const cpu = process.cpuUsage()
  const started = performance.now()
  await Bun.sleep(3000)
  const durationMs = performance.now() - started
  const used = process.cpuUsage(cpu)
  clearInterval(timer)
  const sortedRss = rss.toSorted((a, b) => a - b)
  const sortedLag = lag.toSorted((a, b) => a - b)
  const rssMedian = sortedRss[Math.floor(sortedRss.length / 2)]
  const lagP95Ms = sortedLag[Math.floor(sortedLag.length * 0.95)]
  assert(rssMedian !== undefined && lagP95Ms !== undefined)
  assert.equal(nativeBatches, batchesBefore, 'Resource phases must not include React mutations.')
  resources.push({
    repetition,
    phase,
    durationMs,
    cpuPercent: (used.user + used.system) / (durationMs * 10),
    rssMedian,
    rssPeak: Math.max(...rss),
    heapPeak,
    lagP95Ms,
    nativeBatches: nativeBatches - batchesBefore,
  })
}
async function verifyLifecycle() {
  assert(setContentMode)
  setContentMode('empty')
  otherRoot.render(
    host('div', { style: { width: '100%', height: '100%', backgroundColor: '#554477' } }),
  )
  await until(() => elements.size === 0 && otherElements.size === 0, 'all image elements unmount')
  assert(
    !/"type"\s*:\s*"img"/u.test(current().getAutomationTree()),
    'Main tree must contain no images.',
  )
  assert(
    !/"type"\s*:\s*"img"/u.test(other.getAutomationTree()),
    'Other tree must contain no images.',
  )
  await Bun.sleep(350)
  const batchesBefore = nativeBatches
  const rendersBefore = renders
  const mainFrames = current().getDebugFrameOverlayStats().frames
  const otherFrames = other.getDebugFrameOverlayStats().frames
  await Bun.sleep(500)
  const mainFrameGrowth = current().getDebugFrameOverlayStats().frames - mainFrames
  const otherFrameGrowth = other.getDebugFrameOverlayStats().frames - otherFrames
  lifecycle.push({
    phase: 'empty',
    mainFrameGrowth,
    otherFrameGrowth,
    nativeBatches: nativeBatches - batchesBefore,
    renders: renders - rendersBefore,
  })
  assert.equal(nativeBatches, batchesBefore, 'Unmounted images must not cause React mutations.')
  assert.equal(renders, rendersBefore, 'Empty windows must not rerender.')
  assert(
    mainFrameGrowth <= 1 && otherFrameGrowth <= 1,
    'Empty windows must stop animation redraws.',
  )
  setContentMode('images')
  renderOtherImage(gifUrl)
  await until(() => elements.size === 6 && otherElements.size === 1, 'images remount')
  assert(
    other.isWindowActive() && !current().isWindowActive(),
    'Remounting images must not move focus.',
  )
  await pixels(420, 'restored-after-removal', !expectPaused)
  lifecycle.push({ phase: 'restored' })

  slowGif = await sharp(Buffer.concat(frames), { raw })
    .gif({ delay: [5000, 5000, 5000], loop: 0 })
    .toBuffer()
  const metadata = await sharp(slowGif, { animated: true }).metadata()
  const frameDelays = metadata.delay ?? []
  assert.deepEqual(frameDelays, [5000, 5000, 5000])
  const slowUrl = `http://127.0.0.1:${server.port}/slow.gif`
  renderOtherImage(slowUrl)
  await until(() => typeof imageSnapshot(slowUrl) === 'string', 'long-delay GIF cache')
  await Bun.sleep(150)
  const id = otherElements.get('gif')
  assert(
    id !== undefined && other.getPaintedElementBounds(id),
    'Long-delay GIF must complete a paint before close.',
  )
  const closeStarted = performance.now()
  otherRoot.unmount()
  other.closeWindow()
  otherLoop.stop()
  otherClosed = true
  await Promise.race([
    manager.quit(),
    Bun.sleep(2000).then(() => {
      throw new Error('Quitting must not wait for the pending five-second image deadline.')
    }),
  ])
  managerClosed = true
  await until(() => !other.isWindowOpen(), 'close with pending image deadline')
  const closeMs = performance.now() - closeStarted
  await Bun.sleep(150)
  lifecycle.push({ phase: 'pending-close', closeMs, frameDelays, reactErrors: [...reactErrors] })
  assert(closeMs < 2000, 'Closing must finish before the next long image deadline.')
  assert.deepEqual(reactErrors, [], 'Closing pending animation timers must not cause React errors.')
}
try {
  await manager.start()
  await until(() => !!renderer, 'main native mount')
  await current().setWindowBounds({ x: 10, y: 10, width: 900, height: 260 })
  await other.setWindowBounds({ x: 980, y: 400, width: 260, height: 240 })
  await until(
    () => typeof imageSnapshot(gifUrl) === 'string' && typeof imageSnapshot(webpUrl) === 'string',
    'remote GIF and WebP cache',
  )
  const gifPath = imageSnapshot(gifUrl)
  assert(typeof gifPath === 'string')
  const transformed = await modifiedEmoteImage(gifPath, imageSize, imageSize, ['flip-horizontal'])
  assert.equal((await sharp(transformed, { animated: true }).metadata()).pages, 3)
  await Bun.sleep(700)
  mainWindowId = x11(['search', '--onlyvisible', '--name', '^TwirChat$'])
  await focusMain()
  const initialIds = new Map(elements)
  const mountingStarted = performance.now()
  for (const copies of [1, 2]) {
    await Bun.sleep(170)
    assert(addCopies, 'The mounted fixture must expose its copy count.')
    addCopies(copies)
    await until(
      () => elements.has(copies === 1 ? 'gif-late-a' : 'gif-late-b'),
      'delayed GIF copy mount',
    )
    mounts.push({ copies, elapsedMs: performance.now() - mountingStarted })
    for (const [name, id] of initialIds)
      assert.equal(
        elements.get(name),
        id,
        `${name} must retain its native identity when later copies mount.`,
      )
  }
  renderOtherImage(gifUrl)
  await until(() => otherElements.has('gif'), 'second-window GIF mount')
  for (const width of [900, 420]) {
    await current().setWindowBounds({ width, height: 260 })
    await focusMain()
    await pixels(width, 'focused', true)
    await focusOther()
    await pixels(width, 'inactive', !expectPaused)
    await focusMain()
    await pixels(width, 'refocused', true)
    await focusOther()
    await pixels(width, 'inactive-again', !expectPaused)
  }
  await mapped(false)
  await Bun.sleep(350)
  await mapped(true)
  assert(
    other.isWindowActive() && !current().isWindowActive(),
    'Restoring visibility must not move focus.',
  )
  await pixels(420, 'restored', !expectPaused)
  if (measure) {
    for (let repetition = 1; repetition <= 3; repetition++) {
      await focusMain()
      await sampleResources(repetition, 'focused')
      await focusOther()
      await sampleResources(repetition, 'inactive')
      await mapped(false)
      await sampleResources(repetition, 'hidden')
      await mapped(true)
    }
  }
  await verifyLifecycle()
  if (expectUnsynchronized)
    assert(
      evidence.some(
        (entry) =>
          entry.phase === 'focused' &&
          entry.synchronization.sameWindowMismatches > entry.synchronization.samples / 5,
      ),
      'The baseline must reproduce drift between delayed copies of the same GIF.',
    )
  const nativePath = process.env.NAPI_RS_NATIVE_LIBRARY_PATH
  assert(nativePath)
  const manifest: unknown = await Bun.file(`${nativePath}.json`).json()
  await Bun.write(
    join(directory, 'background-images-result.json'),
    JSON.stringify(
      {
        ok: true,
        expectPaused,
        expectUnsynchronized,
        mounts,
        nativePath,
        nativeSha256: createHash('sha256')
          .update(new Uint8Array(await Bun.file(nativePath).arrayBuffer()))
          .digest('hex'),
        manifest,
        transformed,
        evidence,
        resources,
        lifecycle,
      },
      null,
      2,
    ),
  )
} catch (error) {
  await captureGuiQaDisplay('background-images-failure')
  await Bun.write(
    join(directory, 'background-images-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        evidence,
        resources,
        lifecycle,
        reactErrors,
        tree:
          renderer && nativeWindow(renderer).isWindowOpen() ? renderer.getAutomationTree() : null,
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  if (!otherClosed) {
    otherRoot.unmount()
    other.closeWindow()
    otherLoop.stop()
  }
  if (!managerClosed) await manager.quit()
  backend.dispose?.()
  await server.stop(true)
}
process.exit(0)
