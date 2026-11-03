import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type {
  NormalizedChatMessage,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'
import { z } from 'zod'

import { inlineEmoteImageSource } from '../src/services/emote-image-source'
import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { captureGuiQaDisplay, decodeQaFramebuffer } from '../src/services/gui-qa-screenshot'
import { readWindowScale } from '../src/services/window-scale'
import {
  benchmarkProvenanceSchema,
  gpuMeasurements,
  percentile,
  readDrmSnapshot,
  verifyBenchmarkReactMode,
  type ResourceSample,
} from './bench-metrics'
import { focusNativeQaWindow, getNativeQaWindowGeometry } from './qa-x11'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { nativeWindow } = await import('../src/gpuix/native-window')
const app = await import('../src/gpuix/state/app')
const { layoutStore } = await import('../src/gpuix/state/layout')
const { getDbPath, getBackendUrl } = await import('../src/runtime-config')
const { imageSnapshot } = await import('../src/gpuix/state/image-cache')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const sharp = (await import('sharp')).default

const configurationSchema = z.object({
  case: z.enum(['idle', 'churn', 'functional']).default('idle'),
  source: z.enum(['synthetic', 'seventv']).default('synthetic'),
  durationSeconds: z.number().min(4).max(30).default(12),
  warmupSeconds: z.number().min(2).max(10).default(3),
  delayMs: z.number().int().min(20).max(1000).default(100),
  rate: z.number().int().min(1).max(20).default(20),
  backgroundAnimation: z.boolean().default(false),
})
const imageResourceStatsSchema = z.object({
  entries: z.number().int().nonnegative(),
  loading: z.number().int().nonnegative(),
  decodedBytes: z.number().nonnegative(),
  evictions: z.number().int().nonnegative(),
  decodes: z.number().int().nonnegative(),
  maxEntries: z.number().int().nonnegative(),
  maxDecodedBytes: z.number().nonnegative(),
})
type ImageResourceStats = z.infer<typeof imageResourceStatsSchema>
const config = configurationSchema.parse(JSON.parse(process.argv[2] ?? '{}'))
const provenance = benchmarkProvenanceSchema.parse(JSON.parse(process.argv[3] ?? '{}'))
const session = z.string().min(1).parse(process.env.TWIRCHAT_QA_SESSION_DIR)
if (config.case === 'functional' && process.env.TWIRCHAT_QA_COMPOSITOR !== 'xvfb')
  throw new Error('Functional focus/pixel checks require the isolated Xvfb compositor.')
if (config.source === 'seventv' && config.case !== 'functional')
  throw new Error(
    '7TV sizing checks are a separate functional case; resource comparisons use synthetic sources.',
  )

const backend = getDesktopBackend()
const renderers = new Map<string, GpuixRenderer>()
const channels: WatchedChannel[] = Array.from({ length: 10 }, (_, index) => ({
  id: `emote-${index}`,
  platform: 'kick',
  channelSlug: `emote-${index}`,
  displayName: `Emote resource channel ${index + 1}`,
  createdAt: 0,
}))
function firstChannel(): WatchedChannel {
  const channel = channels[0]
  assert(channel)
  return channel
}
const visibleChannel = firstChannel()
const tabId = 'emote-resources'
const panelId = 'emote-resources-panel'
const layout: WatchedChannelsLayout = {
  version: 2,
  root: {
    type: 'panel',
    id: panelId,
    flex: 100,
    content: { type: 'watched', channelId: visibleChannel.id },
  },
}
app.settingsStore.set({ ...DEFAULT_SETTINGS, chatTheme: 'compact' })
app.accountsStore.set([])
app.watchedChannelsStore.set(channels)
app.watchedStatusesStore.set(
  new Map(
    channels.map((channel) => [
      channel.id,
      { platform: 'kick', status: 'connected', mode: 'anonymous' },
    ]),
  ),
)
layoutStore.set(new Map([[tabId, { layout, isLoading: false, error: null }]]))

interface Fixture {
  url: string
  path: string
  sha256: string
  encodedBytes: number
  delayMs: number
  frames: number
  variants?: FixtureVariant[]
}
interface FixtureVariant {
  url: string
  path: string
  width: number
  height: number
  variant: number
  sha256: string
}
interface AutomationNode {
  id: number
  type: string
  bounds?: { x: number; y: number; width: number; height: number }
  children: AutomationNode[]
}
const automationSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    type: z.string(),
    bounds: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .optional(),
    children: z.array(automationSchema).default([]),
  }),
)
const nativeSources = new Map<GpuixRenderer, Map<number, string>>()
const mutationsSchema = z.array(z.array(z.unknown()))
const animationMetadataSchema = z.object({
  width: z.number().int().positive(),
  pageHeight: z.number().int().positive(),
  pages: z.number().int().positive(),
  delay: z.array(z.number().int().positive()),
})
const cache = join(dirname(getDbPath()), 'image-cache')
await mkdir(cache, { recursive: true })
const fixtureCount =
  config.case === 'churn' ? Math.ceil(config.durationSeconds * config.rate) + 8 : 8
const fixtures: Fixture[] = []
const frameWidth = 96
const frameHeight = 96
const frameCount = 32
async function animation(
  delayMs: number,
  width = frameWidth,
  height = frameHeight,
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * frameCount * 4)
  for (let frame = 0; frame < frameCount; frame++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = ((frame * height + y) * width + x) * 4
        const stripe = Math.floor((x + frame * 7) / 12) % 2 === 0
        pixels[offset] = stripe ? 230 : 40
        pixels[offset + 1] = ((frame * 13 + y * 2) % 200) + 30
        pixels[offset + 2] = stripe ? 60 : 235
        pixels[offset + 3] = 255
      }
    }
  }
  const bytes = await sharp(pixels, {
    raw: {
      width,
      height: height * frameCount,
      channels: 4,
      pageHeight: height,
    },
  })
    .webp({
      lossless: true,
      effort: 0,
      loop: 0,
      delay: Array.from({ length: frameCount }, () => delayMs),
    })
    .toBuffer()
  const metadata = await sharp(bytes, { animated: true }).metadata()
  assert.equal(metadata.pages, frameCount)
  assert.equal(metadata.pageHeight, height)
  assert(metadata.delay?.every((delay) => delay === delayMs))
  return bytes
}
if (config.source === 'seventv') {
  const encodedVariants = new Map<string, Buffer>()
  for (const variant of [1, 2, 3, 4]) {
    for (const delayMs of new Set([config.delayMs, 20]))
      encodedVariants.set(
        `${variant}:${delayMs}`,
        await animation(delayMs, variant * 32, variant * 32),
      )
  }
  for (let index = 0; index < fixtureCount; index++) {
    const delayMs = index % 2 === 1 ? 20 : config.delayMs
    const variants: FixtureVariant[] = []
    for (const variant of [1, 2, 3, 4]) {
      const url = `https://cdn.7tv.app/emote/01GBFAYKGR000FWWN7MDZZ8XQN/${variant}x.webp?qa-fixture=${index}`
      const path = join(
        cache,
        `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.webp`,
      )
      const bytes = encodedVariants.get(`${variant}:${delayMs}`)
      assert(bytes)
      await Bun.write(path, bytes)
      variants.push({
        url,
        path,
        width: variant * 32,
        height: variant * 32,
        variant,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    }
    const original = variants.find((variant) => variant.variant === 4)
    assert(original)
    fixtures.push({
      url: original.url,
      path: original.path,
      sha256: original.sha256,
      encodedBytes: Bun.file(original.path).size,
      delayMs,
      frames: frameCount,
      variants,
    })
  }
} else {
  const encoded = await animation(config.delayMs)
  const fast = config.case === 'functional' ? await animation(20) : encoded
  for (let index = 0; index < fixtureCount; index++) {
    const url = `https://emote-qa.invalid/emote/${index}/2x.webp`
    const path = join(cache, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.webp`)
    const bytes = config.case === 'functional' && index % 2 === 1 ? fast : encoded
    await Bun.write(path, bytes)
    fixtures.push({
      url,
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      encodedBytes: bytes.length,
      delayMs: config.case === 'functional' && index % 2 === 1 ? 20 : config.delayMs,
      frames: frameCount,
    })
  }
}
const firstFixture = fixtures[0]
assert(firstFixture)
let sequence = 0
function inject(channel: WatchedChannel, fixture: Fixture): void {
  const id = sequence++
  const message: NormalizedChatMessage = {
    id: `emote-message-${id}`,
    platform: 'kick',
    channelId: channel.channelSlug,
    type: 'message',
    timestamp: new Date(),
    text: `EmoteQA ${id}: repeated image EmoteQA`,
    author: {
      id: 'viewer',
      username: 'viewer',
      displayName: 'Viewer',
      color: '#c084fc',
      badges: [],
    },
    emotes: [
      {
        id: fixture.url,
        name: 'EmoteQA',
        imageUrl: fixture.url,
        provider: 'seventv',
        source: 'seventv',
        animated: true,
        aspectRatio: 1,
        positions: [
          { start: 0, end: 6 },
          {
            start: `EmoteQA ${id}: repeated image `.length,
            end: `EmoteQA ${id}: repeated image `.length + 6,
          },
        ],
      },
    ],
  }
  backend.events.emit('watched_channel_message', { channelId: channel.id, message })
}
function processed(): number {
  return channels.reduce(
    (total, channel) => total + (app.chatActivityStore.get().get(channel.id)?.total ?? 0),
    0,
  )
}
function retained(): number {
  return channels.reduce(
    (total, channel) => total + (app.watchedMessagesStore.get().get(channel.id)?.length ?? 0),
    0,
  )
}
function current(): GpuixRenderer {
  const renderer = renderers.get('main')
  assert(renderer)
  return renderer
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(20)
  }
}
function imageStats(renderer: GpuixRenderer): ImageResourceStats | null {
  const method: unknown = Reflect.get(renderer, 'getImageResourceStats')
  if (typeof method !== 'function') return null
  const raw: unknown = Reflect.apply(method, renderer, [])
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
  return value === null ? null : imageResourceStatsSchema.parse(value)
}
async function waitForImageStats(
  renderer: GpuixRenderer,
  check: (stats: ImageResourceStats) => boolean,
  label: string,
): Promise<ImageResourceStats | null> {
  if (typeof Reflect.get(renderer, 'getImageResourceStats') !== 'function') return null
  const deadline = performance.now() + 8000
  let last: ImageResourceStats | null = null
  while (performance.now() < deadline) {
    const stats = imageStats(renderer)
    if (stats) {
      last = stats
      if (check(stats)) return stats
    }
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label} (${JSON.stringify(last)}).`)
}
function recordNativeSources(renderer: GpuixRenderer): () => void {
  const sources = new Map<number, string>()
  const previous = renderer.applyBatch
  const descriptor = Object.getOwnPropertyDescriptor(renderer, 'applyBatch')
  const capture: typeof previous = (json) => {
    for (const [operation, id, property, value] of mutationsSchema.parse(JSON.parse(json))) {
      if (
        operation === 'setCustomProp' &&
        typeof id === 'number' &&
        property === 'src' &&
        typeof value === 'string'
      )
        sources.set(id, value)
    }
    const destroyed = previous.call(renderer, json)
    for (const id of destroyed) sources.delete(id)
    return destroyed
  }
  Object.defineProperty(renderer, 'applyBatch', { configurable: true, value: capture })
  nativeSources.set(renderer, sources)
  return () => {
    if (renderer.applyBatch === capture) {
      if (descriptor) Object.defineProperty(renderer, 'applyBatch', descriptor)
      else Reflect.deleteProperty(renderer, 'applyBatch')
    }
    nativeSources.delete(renderer)
  }
}
function Content({ windowId, layoutId }: { windowId: string; layoutId: string }) {
  const renderer = useGpuixRequired()
  React.useEffect(() => {
    assert(renderer instanceof NativeRenderer)
    renderers.set(windowId, renderer)
    const stopSources = config.source === 'seventv' ? recordNativeSources(renderer) : undefined
    return () => {
      stopSources?.()
      renderers.delete(windowId)
    }
  }, [renderer, windowId])
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#16161c',
      }}
    >
      <ChatView
        paneId={`${windowId}:emote-pane`}
        layoutTabId={layoutId}
        layoutPanelId={panelId}
        watchedChannel={visibleChannel}
      />
    </div>
  )
}
const manager = new DesktopWindowManager(
  backend,
  (descriptor) => (
    <Content windowId={descriptor.id} layoutId={'tabId' in descriptor ? descriptor.tabId : tabId} />
  ),
  () => {},
)
const stopMessages = app.wireBackendToStores(backend)
async function activateMain(): Promise<void> {
  if (process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb') await focusNativeQaWindow('TwirChat')
  else current().activateWindow()
  await until(() => nativeWindow(current()).isWindowActive(), 'active animation window')
}
async function measure() {
  const renderer = current()
  const initialProcessed = processed()
  const initialMemory = process.memoryUsage()
  const initialGpu = readDrmSnapshot()
  const initialFrames = renderer.getDebugFrameOverlayStats().frames
  const initialStats = imageStats(renderer)
  const samples: ResourceSample[] = []
  const lags: number[] = []
  let lastGpu = initialGpu
  let generated = 0
  let offered = 0
  let previous = performance.now()
  let fractional = 0
  let nextFixture = 8
  const start = performance.now()
  const cpuStart = process.cpuUsage()
  let expected = start + 50
  const lagTimer = setInterval(() => {
    const now = performance.now()
    lags.push(Math.max(0, now - expected))
    expected = now + 50
  }, 50)
  const sample = () => {
    const memory = process.memoryUsage()
    const nextGpu = readDrmSnapshot()
    samples.push({
      elapsedMs: performance.now() - start,
      rssBytes: memory.rss,
      heapBytes: memory.heapUsed,
      processed: processed() - initialProcessed,
      gpu: gpuMeasurements(lastGpu, nextGpu),
    })
    lastGpu = nextGpu
  }
  const sampleTimer = setInterval(sample, 250)
  const generator =
    config.case === 'churn'
      ? setInterval(() => {
          const now = performance.now()
          fractional += ((now - previous) * config.rate) / 1000
          previous = now
          const count = Math.floor(fractional)
          fractional -= count
          offered += count
          for (let index = 0; index < count; index++) {
            const fixture = fixtures[nextFixture++]
            if (!fixture) continue
            inject(visibleChannel, fixture)
            generated++
          }
        }, 20)
      : undefined
  await Bun.sleep(config.durationSeconds * 1000)
  if (generator) clearInterval(generator)
  clearInterval(sampleTimer)
  clearInterval(lagTimer)
  const wallMs = performance.now() - start
  const cpu = process.cpuUsage(cpuStart)
  sample()
  const frames = renderer.getDebugFrameOverlayStats().frames - initialFrames
  const stats = imageStats(renderer)
  await Bun.sleep(500)
  const count = processed() - initialProcessed
  assert.equal(
    retained(),
    channels.length * 200,
    'Message retention must not shrink during measurement.',
  )
  if (config.case === 'churn') {
    assert.equal(count, generated, 'Every generated message must be processed.')
    assert(
      generated >= Math.floor((config.rate * wallMs) / 1000) * 0.99,
      'Churn must preserve the offered message rate.',
    )
  }
  return {
    wallMs,
    cpuPercent: ((cpu.user + cpu.system) / (wallMs * 1000)) * 100,
    nativeFrames: frames,
    nativeFramesPerSecond: frames / (wallMs / 1000),
    initialRssBytes: initialMemory.rss,
    rssMedianBytes: percentile(
      samples.map((entry) => entry.rssBytes),
      0.5,
    ),
    rssPeakBytes: Math.max(initialMemory.rss, ...samples.map((entry) => entry.rssBytes)),
    heapPeakBytes: Math.max(initialMemory.heapUsed, ...samples.map((entry) => entry.heapBytes)),
    eventLoopLagP50Ms: percentile(lags, 0.5),
    eventLoopLagP95Ms: percentile(lags, 0.95),
    eventLoopLagMaxMs: Math.max(0, ...lags),
    offeredMessages: offered,
    generatedMessages: generated,
    processedMessages: count,
    actualRate: count / (wallMs / 1000),
    retainedMessages: retained(),
    imageStatsBefore: initialStats,
    imageStatsAfter: stats,
    gpu: gpuMeasurements(initialGpu, readDrmSnapshot()),
    samples,
  }
}
async function crop(): Promise<Buffer> {
  const geometry = getNativeQaWindowGeometry('TwirChat')
  const frame = decodeQaFramebuffer(
    Buffer.from(await Bun.file(join(session, 'framebuffer', 'Xvfb_screen0')).arrayBuffer()),
  )
  return sharp(frame.pixels, { raw: { width: frame.width, height: frame.height, channels: 4 } })
    .extract({ left: geometry.x + 20, top: geometry.y + 100, width: 280, height: 100 })
    .raw()
    .toBuffer()
}
function changedPixels(a: Buffer, b: Buffer): number {
  assert.equal(a.length, b.length)
  let count = 0
  for (let index = 0; index < a.length; index += 4) {
    if (
      [0, 1, 2].some(
        (channel) => Math.abs((a[index + channel] ?? 0) - (b[index + channel] ?? 0)) > 15,
      )
    )
      count++
  }
  return count
}
async function verifyMotion(label: string): Promise<number> {
  const before = await crop()
  let difference = 0
  for (let attempt = 0; attempt < 6; attempt++) {
    await Bun.sleep(Math.max(70, config.delayMs + 17))
    difference = Math.max(difference, changedPixels(before, await crop()))
    if (difference > 100) return difference
  }
  throw new Error(`Animated emotes did not change pixels: ${label} (${difference}).`)
}
function allNodes(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(allNodes)]
}
async function verifySevenTvSources() {
  if (config.source !== 'seventv') return null
  const renderer = current()
  const scale = readWindowScale(renderer)
  const logicalHeight = Math.round(DEFAULT_SETTINGS.fontSize * 2)
  const expectedPaths = new Set<string>()
  const selection: Array<{
    originalUrl: string
    selectedUrl: string
    expectedVariant: number
    width: number
    height: number
    pages: number
    delayMs: number
    previewWidth: number
    nativeSourceObserved: boolean
  }> = []
  for (const fixture of fixtures) {
    const expectedUrl = inlineEmoteImageSource(fixture.url, {
      height: logicalHeight,
      scale,
      backendUrl: getBackendUrl(),
    })
    const expected = fixture.variants?.find((variant) => variant.url === expectedUrl)
    assert(expected, 'The selected 7TV variant must have a frozen local fixture.')
    await until(
      () => typeof imageSnapshot(expectedUrl) === 'string',
      'selected 7TV image cache source',
    )
    const path = imageSnapshot(expectedUrl)
    assert.equal(path, expected.path, 'The actual image cache must resolve the selected URL.')
    const metadata = animationMetadataSchema.parse(
      await sharp(expected.path, { animated: true }).metadata(),
    )
    assert.equal(metadata.width, expected.width)
    assert.equal(metadata.pageHeight, expected.height)
    assert.equal(metadata.pages, frameCount)
    assert.equal(metadata.delay.length, frameCount)
    assert(
      metadata.delay.every((delay) => delay === fixture.delayMs),
      'Sizing must retain every frame delay.',
    )
    const preview = animationMetadataSchema.parse(
      await sharp(fixture.path, { animated: true }).metadata(),
    )
    assert.equal(preview.width, 128, 'The original 4x preview must keep its full raster.')
    assert.equal(preview.pageHeight, 128)
    assert.equal(preview.pages, frameCount)
    expectedPaths.add(expected.path)
    selection.push({
      originalUrl: fixture.url,
      selectedUrl: expectedUrl,
      expectedVariant: expected.variant,
      width: metadata.width,
      height: expected.height,
      pages: metadata.pages,
      delayMs: fixture.delayMs,
      previewWidth: preview.width,
      nativeSourceObserved: false,
    })
  }
  const sources = nativeSources.get(renderer)
  assert(sources)
  const tree = automationSchema.parse(JSON.parse(renderer.getAutomationTree()))
  const paintedSources = new Set(
    allNodes(tree)
      .filter(
        (node) =>
          node.type === 'img' && node.bounds && node.bounds.width > 0 && node.bounds.height > 0,
      )
      .flatMap((node) => {
        const source = sources.get(node.id)
        return source ? [source] : []
      }),
  )
  assert(paintedSources.size > 0, 'Actual painted native images must use a selected local source.')
  for (const path of paintedSources)
    assert(
      expectedPaths.has(path),
      'Inline native images must not load the original oversized preview.',
    )
  for (const selected of selection) {
    const fixture = fixtures.find((entry) => entry.url === selected.originalUrl)
    const variant = fixture?.variants?.find((entry) => entry.url === selected.selectedUrl)
    selected.nativeSourceObserved = variant !== undefined && paintedSources.has(variant.path)
  }
  assert(selection.some((entry) => entry.nativeSourceObserved))
  const retainedSources =
    app.watchedMessagesStore
      .get()
      .get(visibleChannel.id)
      ?.flatMap((message) => message.emotes.map((emote) => emote.imageUrl)) ?? []
  assert(retainedSources.length > 0)
  assert(
    retainedSources.every((url) => fixtures.some((fixture) => fixture.url === url)),
    'Inline sizing must not mutate authoritative message URLs.',
  )
  return {
    scale,
    logicalHeight,
    physicalHeight: scale * logicalHeight,
    selection,
    nativePaintedSources: [...paintedSources],
  }
}
async function functional() {
  const evidence: Array<{
    width: number
    motionPixels: number
    resumedPixels: number
    frozenPixels: number
    focusedFrames: number
    blurredFrames: number
    sourceSelection: Awaited<ReturnType<typeof verifySevenTvSources>>
  }> = []
  const secondId = await manager.openChat(tabId)
  await until(() => renderers.has(secondId), 'second image window mounted')
  const second = renderers.get(secondId)
  assert(second)
  await nativeWindow(second).setWindowBounds({ x: 650, y: 20, width: 320, height: 260 })
  for (const width of [420, 900]) {
    await nativeWindow(current()).setWindowBounds({
      x: 20,
      y: 20,
      width,
      height: width === 420 ? 300 : 600,
    })
    await activateMain()
    await Bun.sleep(200)
    const sourceSelection = await verifySevenTvSources()
    const motionPixels = await verifyMotion(`${width}px focused`)
    const startFrames = current().getDebugFrameOverlayStats().frames
    await Bun.sleep(500)
    const focusedFrames = current().getDebugFrameOverlayStats().frames - startFrames
    await focusNativeQaWindow('TwirChat chat')
    await until(() => !nativeWindow(current()).isWindowActive(), 'main window deactivated')
    await Bun.sleep(200)
    const before = await crop()
    const blurredStart = current().getDebugFrameOverlayStats().frames
    await Bun.sleep(600)
    const frozenPixels = changedPixels(before, await crop())
    const blurredFrames = current().getDebugFrameOverlayStats().frames - blurredStart
    if (config.backgroundAnimation) {
      assert(frozenPixels > 100, 'Unfocused animations must continue changing pixels.')
      assert(blurredFrames > 0, 'Unfocused animations must continue requesting their due frames.')
    } else {
      assert.equal(frozenPixels, 0, 'Baseline unfocused animation pixels must remain still.')
      assert(blurredFrames <= 2, 'Baseline unfocused animations must not keep requesting redraws.')
    }
    await activateMain()
    const resumedPixels = await verifyMotion(`${width}px refocused`)
    evidence.push({
      width,
      motionPixels,
      resumedPixels,
      frozenPixels,
      focusedFrames,
      blurredFrames,
      sourceSelection,
    })
    await captureGuiQaDisplay(`emote-resources-${width}`)
  }
  const beforeClose = imageStats(second)
  await manager.close(secondId)
  await until(() => !nativeWindow(second).isWindowOpen(), 'second image window closed')
  const afterClose = await waitForImageStats(
    second,
    (stats) => stats.entries === 0 && stats.loading === 0 && stats.decodedBytes === 0,
    'closed renderer releases its image resources while its JS object remains referenced',
  )
  await activateMain()
  const afterCloseMotionPixels = await verifyMotion('other window closed')
  return {
    evidence,
    sharedImagesPerMessage: 2,
    secondWindowStatsBeforeClose: beforeClose,
    secondWindowStatsAfterClose: afterClose,
    afterCloseMotionPixels,
  }
}

let report: unknown
try {
  await manager.start()
  await until(() => renderers.has('main'), 'native chat mounted')
  await nativeWindow(current()).setWindowBounds({ width: 1200, height: 800 })
  assert.equal(
    (await backend.api.getAccounts()).length,
    0,
    'Only the isolated empty profile may be used.',
  )
  for (const channel of channels) {
    for (let index = 0; index < 200; index++) inject(channel, fixtures[index % 8] ?? firstFixture)
  }
  await until(() => retained() === channels.length * 200, 'all ten retained histories filled')
  await until(
    () =>
      current()
        .getPaintedText()
        .some((text) => text.includes('Viewer')),
    'real chat text painted',
  )
  await until(
    () =>
      typeof imageSnapshot(
        config.source === 'seventv'
          ? inlineEmoteImageSource(firstFixture.url, {
              height: Math.round(DEFAULT_SETTINGS.fontSize * 2),
              scale: readWindowScale(current()),
              backendUrl: getBackendUrl(),
            })
          : firstFixture.url,
      ) === 'string',
    'local animated image ready',
  )
  await activateMain()
  await Bun.sleep(config.warmupSeconds * 1000)
  const reactMode = verifyBenchmarkReactMode({
    requested: 'production',
    nodeEnv: process.env.NODE_ENV,
    hasCaptureOwnerStack: typeof React.captureOwnerStack === 'function',
    loadedModules: Object.keys(require.cache),
  })
  const measurement = config.case === 'functional' ? await functional() : await measure()
  const settledStats = await waitForImageStats(
    current(),
    (stats) => stats.loading === 0,
    'all image decodes settle',
  )
  if (settledStats && config.case === 'idle' && config.source === 'synthetic') {
    assert.equal(
      settledStats.entries,
      8,
      'Repeated inline emotes must share eight image resources.',
    )
    assert.equal(settledStats.decodes, 8, 'Repeated inline emotes must decode each resource once.')
    assert.equal(
      settledStats.decodedBytes,
      8 * frameWidth * frameHeight * frameCount * 4,
      'The byte budget must count every decoded frame of each shared animation.',
    )
  }
  const churnBounds =
    config.case === 'churn' && settledStats
      ? {
          label: 'conservative cold budget plus all 200 retained resources in the visible channel',
          retainedResourcesUpperBound: 200,
          entriesUpperBound: settledStats.maxEntries + 200,
          decodedBytesUpperBound:
            settledStats.maxDecodedBytes + 200 * frameWidth * frameHeight * frameCount * 4,
        }
      : null
  if (churnBounds && settledStats) {
    assert(
      settledStats.entries <= churnBounds.entriesUpperBound,
      'Churn image entries must remain bounded by cold cache plus retained identities.',
    )
    assert(
      settledStats.decodedBytes <= churnBounds.decodedBytesUpperBound,
      'Churn decoded pixels must remain bounded by cold cache plus retained identities.',
    )
  }
  app.watchedMessagesStore.set(new Map(channels.map((channel) => [channel.id, []])))
  await until(
    () =>
      !current()
        .getPaintedText()
        .some((text) => text.includes('Viewer')),
    'chat image rows removed',
  )
  await Bun.sleep(1000)
  const afterRemovalStats = await waitForImageStats(
    current(),
    (stats) =>
      stats.loading === 0 &&
      stats.entries <= stats.maxEntries &&
      stats.decodedBytes <= stats.maxDecodedBytes,
    'removed chat rows leave only the bounded cold image cache',
  )
  const nativeManifest: unknown = await Bun.file(
    resolve(import.meta.dir, '../dist/native/gpuix.linux-x64.node.json'),
  ).json()
  report = {
    ok: true,
    config,
    reactMode,
    bunVersion: Bun.version,
    compositor: process.env.TWIRCHAT_QA_COMPOSITOR,
    provenance,
    scriptSha256: createHash('sha256')
      .update(await Bun.file(import.meta.path).bytes())
      .digest('hex'),
    nativeManifest,
    nativeWindow: nativeWindow(current()).getWindowBounds(),
    channels: channels.length,
    initialRetainedMessages: channels.length * 200,
    sourceWidth: config.source === 'seventv' ? 128 : frameWidth,
    sourceHeight: config.source === 'seventv' ? 128 : frameHeight,
    framesPerImage: frameCount,
    uniqueFixtureUrls: fixtures.length,
    fixtures: fixtures.map(({ path: _path, ...fixture }) => fixture),
    measurement,
    settledImageStats: settledStats,
    churnCacheBounds: churnBounds,
    afterRemoval: {
      memory: process.memoryUsage(),
      imageStats: afterRemovalStats,
      retainedMessages: retained(),
    },
    timestamp: new Date().toISOString(),
  }
  await Bun.write(join(session, 'emote-resources-result.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      ok: true,
      case: config.case,
      result: join(session, 'emote-resources-result.json'),
    }),
  )
} catch (error) {
  await Bun.write(
    join(session, 'emote-resources-failure.json'),
    JSON.stringify({ error: String(error), report }, null, 2),
  )
  throw error
} finally {
  stopMessages()
  await manager.quit()
  backend.dispose?.()
}
process.exit(0)
