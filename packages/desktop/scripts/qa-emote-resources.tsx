import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
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
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const app = await import('../src/gpuix/state/app')
const { layoutStore } = await import('../src/gpuix/state/layout')
const { getDbPath, getBackendUrl } = await import('../src/runtime-config')
const { imageSnapshot } = await import('../src/gpuix/state/image-cache')
const { composerStore } = await import('../src/gpuix/state/composer')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const sharp = (await import('sharp')).default

const configurationSchema = z.object({
  case: z.enum(['idle', 'churn', 'functional']).default('idle'),
  source: z.enum(['synthetic', 'seventv']).default('synthetic'),
  preset: z.enum(['standard', 'dense']).default('standard'),
  activation: z.enum(['focused', 'unfocused']).default('focused'),
  pointerMotion: z.enum(['none', 'same-row', 'cross-rows']).default('none'),
  pointerSweepSeconds: z.number().min(0.25).max(4).default(2),
  durationSeconds: z.number().min(4).max(30).default(12),
  warmupSeconds: z.number().min(2).max(10).default(3),
  delayMs: z.number().int().min(20).max(1000).default(100),
  rate: z.number().int().min(1).max(20).default(20),
  backgroundAnimation: z.boolean().default(false),
  sampleGpuDuringMeasurement: z.boolean().default(true),
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
if (config.source === 'seventv' && config.case !== 'functional' && config.preset !== 'dense')
  throw new Error(
    '7TV sizing checks are a separate functional case; resource comparisons use synthetic sources.',
  )
if (config.preset === 'dense' && config.case === 'churn')
  throw new Error(
    'The dense preset measures idle rendering; use the standard preset for image churn.',
  )
if (config.pointerMotion !== 'none')
  assert(
    config.preset === 'dense' && config.case === 'idle' && config.activation === 'focused',
    'Pointer measurements require the focused dense idle fixture.',
  )
const dense = config.preset === 'dense'
const usesSevenTvSources = config.source === 'seventv' || dense
const initialWindow = dense ? { width: 770, height: 1300 } : { width: 1200, height: 800 }
const denseDelays = [40, 50, 70, 90, 110, 130, 60, 80, 100, 120, 140, 150]
const imageAnimationStatsSchema = z.object({
  fullDraws: z.number().int().nonnegative(),
  animationOnlyPresents: z.number().int().nonnegative(),
  slotUploads: z.number().int().nonnegative(),
  liveSlots: z.number().int().nonnegative(),
  fallbacks: z.number().int().nonnegative(),
})
type ImageAnimationStats = z.infer<typeof imageAnimationStatsSchema>
const animationCounterKeys: Array<keyof ImageAnimationStats> = [
  'fullDraws',
  'animationOnlyPresents',
  'slotUploads',
  'liveSlots',
  'fallbacks',
]

const backend = getDesktopBackend()
const renderers = new Map<string, GpuixRenderer>()
const channels: WatchedChannel[] = Array.from({ length: dense ? 23 : 10 }, (_, index) => ({
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
app.settingsStore.set({
  ...DEFAULT_SETTINGS,
  chatTheme: 'compact',
  ...(dense
    ? {
        showTimestamp: true,
        showBadges: true,
        showAvatars: true,
      }
    : {}),
})
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
  testId?: string
  text?: string
  bounds?: { x: number; y: number; width: number; height: number }
  children: AutomationNode[]
}
const automationSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    type: z.string(),
    testId: z.string().optional(),
    text: z.string().optional(),
    bounds: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .optional(),
    children: z.array(automationSchema).default([]),
  }),
)
const nativeSources = new Map<GpuixRenderer, Map<number, string>>()
const nativeMutationCounts = new Map<GpuixRenderer, { batches: number; operations: number }>()
const mutationsSchema = z.array(z.array(z.unknown()))
const animationMetadataSchema = z.object({
  width: z.number().int().positive(),
  pageHeight: z.number().int().positive(),
  pages: z.number().int().positive(),
  delay: z.array(z.number().int().positive()),
})
const cache = join(dirname(getDbPath()), 'image-cache')
await mkdir(cache, { recursive: true })
const fixtureCount = dense
  ? denseDelays.length
  : config.case === 'churn'
    ? Math.ceil(config.durationSeconds * config.rate) + 8
    : 8
const initialFixtureCount = dense ? denseDelays.length : 8
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
if (usesSevenTvSources) {
  const encodedVariants = new Map<string, Buffer>()
  for (const variant of [1, 2, 3, 4]) {
    for (const delayMs of new Set(dense ? denseDelays : [config.delayMs, 20]))
      encodedVariants.set(
        `${variant}:${delayMs}`,
        await animation(delayMs, variant * 32, variant * 32),
      )
  }
  for (let index = 0; index < fixtureCount; index++) {
    const delayMs = dense
      ? (denseDelays[index % denseDelays.length] ?? config.delayMs)
      : index % 2 === 1
        ? 20
        : config.delayMs
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
const denseAvatarUrls: string[] = []
const denseBadgeUrls: string[] = []
if (dense) {
  for (let index = 0; index < 16; index++) {
    const url = `https://emote-qa.invalid/avatar/dense-${index}.png`
    const path = join(cache, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.png`)
    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: {
          r: ((index * 37) % 210) + 30,
          g: ((index * 53) % 210) + 30,
          b: 170,
          alpha: 1,
        },
      },
    })
      .png()
      .toFile(path)
    denseAvatarUrls.push(url)
  }
  for (let index = 0; index < 3; index++) {
    const url = `https://emote-qa.invalid/badge/dense-${index}.png`
    const path = join(cache, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.png`)
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 100 + index * 60, g: 210 - index * 45, b: 80 + index * 55, alpha: 1 },
      },
    })
      .png()
      .toFile(path)
    denseBadgeUrls.push(url)
  }
}
const firstFixture = fixtures[0]
assert(firstFixture)
let sequence = 0
function inject(channel: WatchedChannel, fixture: Fixture): void {
  const id = sequence++
  const secondary = fixtures[(id + 5) % initialFixtureCount] ?? fixture
  const denseText = `EmoteQA dense_${id} EmoteQB EmoteQA — This message includes several words and punctuation to wrap naturally in a busy chat pane. Продолжаем обсуждать стрим, интерфейс и анимированные смайлы! ${id % 7 === 0 ? 'One more sentence makes this particular row taller than its neighbors.' : ''}`
  const message: NormalizedChatMessage = {
    id: `emote-message-${id}`,
    platform: 'kick',
    channelId: channel.channelSlug,
    type: 'message',
    timestamp: new Date(Date.UTC(2026, 10, 4, 0, 0, 0)),
    text: dense ? denseText : `EmoteQA ${id}: repeated image EmoteQA`,
    author: {
      id: dense ? `viewer-${id % 16}` : 'viewer',
      username: dense ? `viewer${id % 16}` : 'viewer',
      displayName: dense ? `Viewer ${id % 16} streaming enthusiast` : 'Viewer',
      color: '#c084fc',
      ...(dense ? { avatarUrl: denseAvatarUrls[id % denseAvatarUrls.length] } : {}),
      badges: dense
        ? [
            {
              id: 'subscriber',
              type: 'subscriber',
              text: 'Subscriber',
              imageUrl: denseBadgeUrls[id % denseBadgeUrls.length],
            },
            {
              id: 'moderator',
              type: 'moderator',
              text: 'Moderator',
              imageUrl: denseBadgeUrls[(id + 1) % denseBadgeUrls.length],
            },
          ]
        : [],
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
        positions: dense
          ? [
              { start: 0, end: 6 },
              {
                start: denseText.lastIndexOf('EmoteQA'),
                end: denseText.lastIndexOf('EmoteQA') + 6,
              },
            ]
          : [
              { start: 0, end: 6 },
              {
                start: `EmoteQA ${id}: repeated image `.length,
                end: `EmoteQA ${id}: repeated image `.length + 6,
              },
            ],
      },
      ...(dense
        ? [
            {
              id: secondary.url,
              name: 'EmoteQB',
              imageUrl: secondary.url,
              provider: 'seventv',
              source: 'seventv',
              animated: true,
              aspectRatio: 1,
              positions: [
                { start: denseText.indexOf('EmoteQB'), end: denseText.indexOf('EmoteQB') + 6 },
              ],
            } satisfies NormalizedChatMessage['emotes'][number],
          ]
        : []),
    ],
    ...(dense && id % 3 === 0
      ? {
          reply: {
            parentMessageId: `emote-message-${Math.max(0, id - 2)}`,
            parentMessageText:
              'A previous viewer asked about the new animation and native chat renderer.',
            parentAuthor: {
              id: `viewer-${(id + 2) % 16}`,
              username: `viewer${(id + 2) % 16}`,
              displayName: 'Previous Viewer',
            },
          },
        }
      : {}),
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
  const counts = { batches: 0, operations: 0 }
  nativeMutationCounts.set(renderer, counts)
  const previous = renderer.applyBatch
  const descriptor = Object.getOwnPropertyDescriptor(renderer, 'applyBatch')
  const capture: typeof previous = (json) => {
    const mutations = mutationsSchema.parse(JSON.parse(json))
    counts.batches++
    counts.operations += mutations.length
    for (const [operation, id, property, value] of mutations) {
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
    nativeMutationCounts.delete(renderer)
  }
}
function Content({ windowId, layoutId }: { windowId: string; layoutId: string }) {
  const renderer = useGpuixRequired()
  React.useEffect(() => {
    assert(renderer instanceof NativeRenderer)
    renderers.set(windowId, renderer)
    const stopSources = usesSevenTvSources ? recordNativeSources(renderer) : undefined
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
let focusSink: GpuixRenderer | undefined
async function getFocusSink(): Promise<GpuixRenderer> {
  if (focusSink) return focusSink
  const renderer = new NativeRenderer()
  initializeManagedRenderer(renderer, {
    title: 'Emote resource focus sink',
    appName: 'TwirChat',
    appId: process.env.TWIRCHAT_QA_APP_ID,
    width: 320,
    height: 240,
    x: 900,
    y: 20,
    focus: false,
  })
  renderer.applyBatch(
    JSON.stringify([
      ['createElement', 1, 'div'],
      ['setStyle', 1, { width: '100%', height: '100%', backgroundColor: '#22222a' }],
      ['createElement', 2, 'text'],
      ['setText', 2, 'Private focus sink'],
      ['appendChild', 1, 2],
      ['setRoot', 1],
    ]),
  )
  focusSink = renderer
  await until(() => nativeWindow(renderer).isWindowOpen(), 'private focus sink opened')
  await until(
    () => renderer.getPaintedText().includes('Private focus sink'),
    'private focus sink first mapped paint',
  )
  return renderer
}
async function activateMain(): Promise<void> {
  if (process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb') await focusNativeQaWindow('TwirChat')
  else if (process.env.TWIRCHAT_QA_WESTON_CONTROLS) await focusPrivateWestonWindow('TwirChat')
  else current().activateWindow()
  await until(() => nativeWindow(current()).isWindowActive(), 'active animation window')
}
async function deactivateMain(): Promise<void> {
  const sink = await getFocusSink()
  if (process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb')
    await focusNativeQaWindow('Emote resource focus sink')
  else if (process.env.TWIRCHAT_QA_WESTON_CONTROLS)
    await focusPrivateWestonWindow('Emote resource focus sink')
  else sink.activateWindow()
  await until(() => !nativeWindow(current()).isWindowActive(), 'visible main window is unfocused')
  assert.notEqual(
    nativeWindow(current()).getWindowVisibility(),
    'hidden',
    'Unfocused measurement must retain the visible chat window.',
  )
}
async function focusPrivateWestonWindow(title: string): Promise<void> {
  assertGuiQaEnvironment()
  assert.equal(process.env.TWIRCHAT_QA_COMPOSITOR, 'weston')
  assert(
    process.env.TWIRCHAT_QA_WESTON_CONTROLS,
    'Use --weston-controls for deterministic Wayland focus.',
  )
  const runtime = z.string().min(1).parse(process.env.TWIRCHAT_QA_RUNTIME)
  const command = join(runtime, 'weston-command')
  const reply = join(runtime, 'weston-reply')
  await rm(reply, { force: true })
  await Bun.write(`${command}.pending`, `focus\n${title}\n`)
  await rename(`${command}.pending`, command)
  const deadline = performance.now() + 5000
  while (!(await Bun.file(reply).exists())) {
    assert(performance.now() < deadline, 'Private Weston focus command timed out.')
    await Bun.sleep(20)
  }
  assert.equal(
    (await Bun.file(reply).text()).trim(),
    '1',
    'The private compositor must find the requested mapped surface.',
  )
}
function nativeRenderCounters(renderer: GpuixRenderer): ImageAnimationStats | null {
  const getter: unknown = Reflect.get(renderer, 'getImageAnimationStats')
  if (typeof getter !== 'function') return null
  const raw: unknown = Reflect.apply(getter, renderer, [])
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
  return value === null ? null : imageAnimationStatsSchema.parse(value)
}
function counterDeltas(before: ImageAnimationStats, after: ImageAnimationStats) {
  return Object.fromEntries(animationCounterKeys.map((key) => [key, after[key] - before[key]]))
}
async function frameSnapshot(renderer: GpuixRenderer) {
  let stats = nativeRenderCounters(renderer)
  if (typeof Reflect.get(renderer, 'getImageAnimationStats') === 'function') {
    const deadline = performance.now() + 2000
    while (stats === null) {
      assert(performance.now() < deadline, 'Native animation counters must eventually be readable.')
      await Bun.sleep(10)
      stats = nativeRenderCounters(renderer)
    }
  }
  const fullDraws = stats?.fullDraws ?? renderer.getDebugFrameOverlayStats().frames
  const animationOnlyPresents = stats?.animationOnlyPresents ?? 0
  return {
    statsAvailable: stats !== null,
    fullDraws,
    animationOnlyPresents,
    slotUploads: stats?.slotUploads ?? 0,
    liveSlots: stats?.liveSlots ?? 0,
    totalPresents: fullDraws + animationOnlyPresents,
  }
}
type FrameSnapshot = Awaited<ReturnType<typeof frameSnapshot>>
interface PointerPath {
  viewport: NonNullable<AutomationNode['bounds']>
  from: { x: number; y: number }
  to: { x: number; y: number }
  visibleRows: number
}
async function preparePointerPath(renderer: GpuixRenderer): Promise<PointerPath | null> {
  if (config.pointerMotion === 'none') return null
  const nodes = allNodes(automationSchema.parse(JSON.parse(renderer.getAutomationTree())))
  const viewport = nodes.find((node) => node.testId === 'chat-messages')?.bounds
  assert(viewport && viewport.width > 300 && viewport.height > 200)
  const rows = nodes
    .filter((node) => node.testId?.startsWith('chat-timestamp-'))
    .flatMap((node) => (node.bounds ? [node.bounds] : []))
    .filter(
      (bounds) =>
        bounds.y > viewport.y + 10 && bounds.y + bounds.height < viewport.y + viewport.height - 10,
    )
    .sort((left, right) => left.y - right.y)
  const first = rows[0]
  const second = rows[1]
  const last = rows.at(-1)
  assert(first && second && last, 'Motion must traverse laid-out chat rows.')
  const from = {
    x: viewport.x + viewport.width - 220,
    y: first.y + first.height / 2,
  }
  const to =
    config.pointerMotion === 'same-row'
      ? { x: viewport.x + viewport.width - 140, y: from.y }
      : { x: from.x, y: last.y + last.height / 2 }
  renderer.simulateMouseMove(0, 0)
  await Bun.sleep(100)
  const before = nativeMutationCounts.get(renderer)?.batches ?? 0
  renderer.simulateMouseMove(from.x, from.y)
  await until(
    () => (nativeMutationCounts.get(renderer)?.batches ?? 0) > before,
    'pointer enter updates row hover',
  )
  const actions = allNodes(automationSchema.parse(JSON.parse(renderer.getAutomationTree())))
    .filter((node) => node.testId === 'msg-reply' || node.testId === 'msg-copy')
    .flatMap((node) => (node.bounds ? [node.bounds] : []))
    .filter((bounds) => bounds.y >= first.y - 10 && bounds.y < second.y - 10)
  assert(actions.length >= 2, 'Hovered row must retain its reply/copy controls.')
  assert(
    actions.every((bounds) => Math.max(from.x, to.x) < bounds.x),
    'Motion must stay to the left of row action controls.',
  )
  await Bun.sleep(300)
  return { viewport, from, to, visibleRows: rows.length }
}
async function measure() {
  const renderer = current()
  const pointerPath = await preparePointerPath(renderer)
  const measuredBounds = nativeWindow(renderer).getWindowBounds()
  assert.equal(
    measuredBounds?.width,
    initialWindow.width,
    'The compositor must preserve the measured client width after warmup.',
  )
  assert.equal(
    measuredBounds?.height,
    initialWindow.height,
    'The compositor must preserve the measured client height after warmup.',
  )
  assert.equal(
    nativeWindow(renderer).isWindowActive(),
    config.activation === 'focused',
    'Resource case must start in its declared activation state.',
  )
  const initialProcessed = processed()
  const initialMemory = process.memoryUsage()
  const initialGpu = readDrmSnapshot()
  const initialFrames = renderer.getDebugFrameOverlayStats().frames
  const initialStats = imageStats(renderer)
  const countersBefore = nativeRenderCounters(renderer)
  const initiallyActive = nativeWindow(renderer).isWindowActive()
  const mutationsBefore = { ...nativeMutationCounts.get(renderer) }
  const samples: ResourceSample[] = []
  const lags: number[] = []
  let lastGpu = initialGpu
  let generated = 0
  let offered = 0
  let previous = performance.now()
  let fractional = 0
  let nextFixture = 8
  const start = performance.now()
  const measurementStartedAtNs = process.hrtime.bigint()
  const cpuStart = process.cpuUsage()
  let expected = start + 50
  const lagTimer = setInterval(() => {
    const now = performance.now()
    lags.push(Math.max(0, now - expected))
    expected = now + 50
  }, 50)
  const sample = () => {
    const memory = process.memoryUsage()
    const nextGpu = config.sampleGpuDuringMeasurement ? readDrmSnapshot() : undefined
    samples.push({
      elapsedMs: performance.now() - start,
      rssBytes: memory.rss,
      heapBytes: memory.heapUsed,
      processed: processed() - initialProcessed,
      gpu: nextGpu ? gpuMeasurements(lastGpu, nextGpu) : [],
    })
    if (nextGpu) lastGpu = nextGpu
  }
  const sampleTimer = setInterval(sample, 250)
  let pointerCalls = 0
  const pointerRate = 120
  const pointerTimer = pointerPath
    ? setInterval(() => {
        const due = Math.floor(((performance.now() - start) * pointerRate) / 1000)
        while (pointerCalls < due) {
          const phase = ((performance.now() - start) / (config.pointerSweepSeconds * 1000)) % 2
          const position = phase <= 1 ? phase : 2 - phase
          renderer.simulateMouseMove(
            pointerPath.from.x + (pointerPath.to.x - pointerPath.from.x) * position,
            pointerPath.from.y + (pointerPath.to.y - pointerPath.from.y) * position,
          )
          pointerCalls++
        }
      }, 8)
    : undefined
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
  if (pointerTimer) clearInterval(pointerTimer)
  clearInterval(sampleTimer)
  clearInterval(lagTimer)
  const wallMs = performance.now() - start
  const cpu = process.cpuUsage(cpuStart)
  const measurementEndedAtNs = process.hrtime.bigint()
  sample()
  const frames = renderer.getDebugFrameOverlayStats().frames - initialFrames
  const stats = imageStats(renderer)
  const countersAfter = nativeRenderCounters(renderer)
  const mutationsAfter = { ...nativeMutationCounts.get(renderer) }
  const purePresents =
    countersBefore && countersAfter
      ? (countersAfter.animationOnlyPresents ?? 0) - (countersBefore.animationOnlyPresents ?? 0)
      : typeof Reflect.get(renderer, 'getImageAnimationStats') === 'function'
        ? null
        : 0
  let pointerLeaveBatches = 0
  if (pointerPath) {
    assert(
      pointerCalls >= Math.floor((wallMs * pointerRate) / 1000) * 0.99,
      'Pointer generator must preserve at least 99% of the offered native calls.',
    )
    const before = nativeMutationCounts.get(renderer)?.batches ?? 0
    renderer.simulateMouseMove(0, 0)
    await until(
      () => (nativeMutationCounts.get(renderer)?.batches ?? 0) > before,
      'pointer leave clears row hover',
    )
    pointerLeaveBatches = (nativeMutationCounts.get(renderer)?.batches ?? 0) - before
  }
  await Bun.sleep(500)
  const count = processed() - initialProcessed
  assert.equal(
    nativeWindow(renderer).isWindowActive(),
    initiallyActive,
    'Window activation must not change during a resource sample.',
  )
  const gpu = gpuMeasurements(initialGpu, readDrmSnapshot())
  if (dense && !gpu.some((device) => (device.engines.gfx ?? 0) > 0))
    await Bun.write(
      join(session, 'emote-resources-invalid-gpu.json'),
      JSON.stringify(
        {
          config,
          wallMs,
          cpuPercent: ((cpu.user + cpu.system) / (wallMs * 1000)) * 100,
          nativeFrames: frames,
          imageStats: stats,
          gpu,
          samples,
          nativeWindow: nativeWindow(renderer).getWindowBounds(),
          initiallyActive,
          finallyActive: nativeWindow(renderer).isWindowActive(),
        },
        null,
        2,
      ),
    )
  if (dense)
    assert(
      gpu.some((device) => (device.engines.gfx ?? 0) > 0),
      'Dense resource measurements require active hardware GPU counters; a software Vulkan run is not a valid comparison.',
    )
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
    label: config.sampleGpuDuringMeasurement
      ? 'primary resource measurement'
      : 'observer-overhead experiment',
    pointer: pointerPath
      ? {
          kind: config.pointerMotion,
          sweepSeconds: config.pointerSweepSeconds,
          path: pointerPath,
          offeredCalls: Math.floor((wallMs * pointerRate) / 1000),
          dispatchedNativeCalls: pointerCalls,
          actualCallsPerSecond: pointerCalls / (wallMs / 1000),
          hoverLeaveBatches: pointerLeaveBatches,
        }
      : null,
    measurementStartedAtNs: measurementStartedAtNs.toString(),
    measurementEndedAtNs: measurementEndedAtNs.toString(),
    nativeMutationBatches: (mutationsAfter.batches ?? 0) - (mutationsBefore.batches ?? 0),
    nativeMutationOperations: (mutationsAfter.operations ?? 0) - (mutationsBefore.operations ?? 0),
    wallMs,
    cpuPercent: ((cpu.user + cpu.system) / (wallMs * 1000)) * 100,
    nativeFrames: frames,
    nativeFramesPerSecond: frames / (wallMs / 1000),
    animationOnlyPresents: purePresents,
    totalPresents: purePresents === null ? null : frames + purePresents,
    totalPresentsPerSecond:
      purePresents === null ? null : (frames + purePresents) / (wallMs / 1000),
    initiallyActive,
    finallyActive: nativeWindow(renderer).isWindowActive(),
    nativeRenderCountersBefore: countersBefore,
    nativeRenderCountersAfter: countersAfter,
    nativeRenderCounterDeltas:
      countersBefore && countersAfter ? counterDeltas(countersBefore, countersAfter) : null,
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
    gpu,
    samples,
  }
}
async function crop(): Promise<Buffer> {
  const geometry = getNativeQaWindowGeometry('TwirChat')
  const frame = decodeQaFramebuffer(
    Buffer.from(await Bun.file(join(session, 'framebuffer', 'Xvfb_screen0')).arrayBuffer()),
  )
  return sharp(frame.pixels, { raw: { width: frame.width, height: frame.height, channels: 4 } })
    .extract(motionCrop(geometry))
    .raw()
    .toBuffer()
}
let denseMotionBounds: AutomationNode['bounds']
function prepareMotionCrop(): void {
  if (dense) denseMotionBounds = denseImageSlots()[0]?.bounds
}
function motionCrop(geometry: { x: number; y: number }) {
  if (!dense) return { left: geometry.x + 20, top: geometry.y + 100, width: 280, height: 100 }
  const bounds = denseMotionBounds
  assert(bounds, 'A fully visible painted animated image is required for motion checks.')
  return {
    left: Math.ceil(geometry.x + bounds.x),
    top: Math.ceil(geometry.y + bounds.y),
    width: Math.floor(bounds.width) - 1,
    height: Math.floor(bounds.height) - 1,
  }
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
  await captureGuiQaDisplay(`motion-failure-${label.replaceAll(/[^a-z0-9]/gi, '-')}`)
  await Bun.write(
    join(session, 'motion-failure.json'),
    JSON.stringify(
      {
        label,
        difference,
        slots: dense ? denseImageSlots() : [],
        counters: await frameSnapshot(current()),
      },
      null,
      2,
    ),
  )
  throw new Error(`Animated emotes did not change pixels: ${label} (${difference}).`)
}
function allNodes(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(allNodes)]
}
function denseImageSlots() {
  const paths = new Set(
    fixtures.flatMap((fixture) => fixture.variants?.map((variant) => variant.path) ?? []),
  )
  const sources = nativeSources.get(current())
  assert(sources)
  return allNodes(automationSchema.parse(JSON.parse(current().getAutomationTree()))).flatMap(
    (node) => {
      const source = sources.get(node.id)
      const bounds = node.bounds
      return node.type === 'img' &&
        source &&
        paths.has(source) &&
        bounds &&
        bounds.y > 80 &&
        bounds.y + bounds.height < 1200
        ? [{ source, bounds, id: node.id }]
        : []
    },
  )
}
async function stableFramebuffer() {
  const path = join(session, 'framebuffer', 'Xvfb_screen0')
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = Buffer.from(await Bun.file(path).arrayBuffer())
    const second = Buffer.from(await Bun.file(path).arrayBuffer())
    if (first.equals(second)) return decodeQaFramebuffer(second)
  }
  throw new Error('Could not capture a stable private framebuffer for shared-source pixel checks.')
}
async function verifyDenseSync() {
  const groups = new Map<string, ReturnType<typeof denseImageSlots>>()
  for (const slot of denseImageSlots()) {
    const group = groups.get(slot.source) ?? []
    group.push(slot)
    groups.set(slot.source, group)
  }
  assert(groups.size >= 12, 'Dense chat must paint all twelve distinct animated sources.')
  const geometry = getNativeQaWindowGeometry('TwirChat')
  let worstColorDifference = 0
  for (let sample = 0; sample < 6; sample++) {
    const frame = await stableFramebuffer()
    const color = (bounds: { x: number; y: number; width: number; height: number }) => {
      const x = Math.round(geometry.x + bounds.x + bounds.width / 2)
      const y = Math.round(geometry.y + bounds.y + bounds.height / 2)
      const rgb = [0, 0, 0]
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const offset = ((y + dy) * frame.width + x + dx) * 4
          for (let channel = 0; channel < 3; channel++)
            rgb[channel] = (rgb[channel] ?? 0) + (frame.pixels[offset + channel] ?? 0) / 25
        }
      return rgb
    }
    for (const group of groups.values()) {
      const first = group[0]
      assert(first)
      const reference = color(first.bounds)
      for (const slot of group.slice(1)) {
        const actual = color(slot.bounds)
        worstColorDifference = Math.max(
          worstColorDifference,
          reference.reduce(
            (total, value, channel) => total + Math.abs(value - (actual[channel] ?? 0)),
            0,
          ) / 3,
        )
      }
    }
    await Bun.sleep(37)
  }
  if (worstColorDifference > 30) {
    await captureGuiQaDisplay('dense-sync-failure')
    await Bun.write(
      join(session, 'dense-sync-failure.json'),
      JSON.stringify(
        { worstColorDifference, groups: [...groups], counters: await frameSnapshot(current()) },
        null,
        2,
      ),
    )
  }
  assert(
    worstColorDifference <= 30,
    'Copies of a shared emote source must display synchronized frames.',
  )
  return {
    distinctVisibleAnimatedSources: groups.size,
    slots: [...groups.values()].reduce((total, group) => total + group.length, 0),
    samples: 6,
    worstColorDifference,
  }
}
async function verifyDenseHoverText() {
  const renderer = current()
  await until(
    () => renderer.getPaintedText().includes('0.0 msg/s'),
    'the initial injected message rate ages out before hover text comparison',
  )
  renderer.blur()
  renderer.clearSelection()
  const nodes = allNodes(automationSchema.parse(JSON.parse(renderer.getAutomationTree())))
  const viewport = nodes.find((node) => node.testId === 'chat-messages')?.bounds
  assert(viewport)
  const target = nodes.find((node) => {
    const box = node.bounds
    return (
      node.children.length === 0 &&
      node.text &&
      /^\p{L}[\p{L} ]{3,24}$/u.test(node.text) &&
      box &&
      box.width > 12 &&
      box.height > 8 &&
      box.x > viewport.x + 8 &&
      box.x + box.width < viewport.x + viewport.width - 90 &&
      box.y > viewport.y + 8 &&
      box.y + box.height < viewport.y + viewport.height - 8
    )
  })
  assert(target?.bounds, 'A fully visible ordinary text run must be available for selection.')
  const box = target.bounds
  const windowGeometry = getNativeQaWindowGeometry('TwirChat')
  const windowScale = readWindowScale(renderer)
  const start = { x: box.x + 0.1, y: box.y + box.height / 2 }
  const end = { x: box.x + box.width + 1, y: start.y }
  const select = async () => {
    renderer.simulateMouseDown(start.x, start.y, 0)
    for (let step = 1; step <= 8; step++) {
      renderer.simulateMouseMove(start.x + ((end.x - start.x) * step) / 8, start.y, 0)
      await Bun.sleep(12)
    }
    renderer.simulateMouseUp(end.x, end.y, 0)
    await Bun.sleep(80)
    return renderer.getSelectedText()
  }
  const baselineSelection = await select()
  assert(baselineSelection?.trim(), 'The baseline native drag must select visible text.')
  renderer.clearSelection()
  renderer.simulateMouseMove(start.x, start.y)
  await Bun.sleep(250)
  const paintedBefore = renderer.getPaintedText()
  const window = nativeWindow(renderer)
  const paintedBoundsBefore = window.getPaintedElementBounds(target.id)
  assert(paintedBoundsBefore)
  const glyphCrop = {
    left: Math.ceil(windowGeometry.x + paintedBoundsBefore.x * windowScale),
    top: Math.ceil(windowGeometry.y + paintedBoundsBefore.y * windowScale),
    width:
      Math.floor(
        windowGeometry.x + (paintedBoundsBefore.x + paintedBoundsBefore.width) * windowScale,
      ) - Math.ceil(windowGeometry.x + paintedBoundsBefore.x * windowScale),
    height:
      Math.floor(
        windowGeometry.y + (paintedBoundsBefore.y + paintedBoundsBefore.height) * windowScale,
      ) - Math.ceil(windowGeometry.y + paintedBoundsBefore.y * windowScale),
  }
  const glyphPixels = async () => {
    const frame = await stableFramebuffer()
    assert(
      glyphCrop.left >= 0 &&
        glyphCrop.top >= 0 &&
        glyphCrop.width > 0 &&
        glyphCrop.height > 0 &&
        glyphCrop.left + glyphCrop.width <= frame.width &&
        glyphCrop.top + glyphCrop.height <= frame.height,
      'The fully visible text crop must fit inside the private framebuffer.',
    )
    return sharp(frame.pixels, {
      raw: { width: frame.width, height: frame.height, channels: 4 },
    })
      .extract(glyphCrop)
      .raw()
      .toBuffer()
  }
  const glyphPixelsBefore = await glyphPixels()
  const glyphPatchBefore = join(session, `hover-text-${windowGeometry.width}-before.png`)
  await sharp(glyphPixelsBefore, {
    raw: { width: glyphCrop.width, height: glyphCrop.height, channels: 4 },
  })
    .png()
    .toFile(glyphPatchBefore)
  const glyphColorsBefore = new Set<number>()
  for (let offset = 0; offset < glyphPixelsBefore.length; offset += 4)
    glyphColorsBefore.add(glyphPixelsBefore.readUIntBE(offset, 3))
  assert(
    glyphColorsBefore.size > 2,
    'The baseline text crop must contain visible antialiased glyphs.',
  )
  const visibleTextBoundsBefore = nodes.flatMap((node) => {
    const hasText =
      node.text?.trim() ||
      (node.type === 'text' && node.children.some((child) => child.text?.trim()))
    if (!hasText) return []
    const bounds = window.getPaintedElementBounds(node.id)
    return bounds &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.x >= viewport.x &&
      bounds.x + bounds.width <= viewport.x + viewport.width &&
      bounds.y >= viewport.y &&
      bounds.y + bounds.height <= viewport.y + viewport.height
      ? [{ id: node.id, bounds }]
      : []
  })
  assert(visibleTextBoundsBefore.length > 0, 'Visible text must have painted bounds snapshots.')
  const framesBefore = await frameSnapshot(renderer)
  const hoverStarted = performance.now()
  const hoverCalls = 240
  for (let index = 0; index < hoverCalls; index++) {
    const phase = (index % 60) / 30
    const position = phase <= 1 ? phase : 2 - phase
    renderer.simulateMouseMove(
      viewport.x + viewport.width - 140,
      viewport.y + 8 + (viewport.height - 16) * position,
    )
    await Bun.sleep(Math.max(0, hoverStarted + ((index + 1) * 1000) / 120 - performance.now()))
  }
  renderer.simulateMouseMove(start.x, start.y)
  await Bun.sleep(200)
  const paintedAfter = renderer.getPaintedText()
  const paintedBoundsAfter = window.getPaintedElementBounds(target.id)
  const visibleTextBoundsAfter = visibleTextBoundsBefore.map(({ id }) => ({
    id,
    bounds: window.getPaintedElementBounds(id),
  }))
  const framesAfter = await frameSnapshot(renderer)
  const hoverWallMs = performance.now() - hoverStarted
  const glyphPixelsAfter = await glyphPixels()
  const glyphPatchAfter = join(session, `hover-text-${windowGeometry.width}-after.png`)
  await sharp(glyphPixelsAfter, {
    raw: { width: glyphCrop.width, height: glyphCrop.height, channels: 4 },
  })
    .png()
    .toFile(glyphPatchAfter)
  assert.deepEqual(
    glyphPixelsAfter,
    glyphPixelsBefore,
    'Hover reuse must preserve the actual visible glyph pixels before any selection or full repaint.',
  )
  assert.deepEqual(
    paintedAfter,
    paintedBefore,
    'Hover reuse must preserve painted text order and multiplicity without a fresh geometry query.',
  )
  assert.deepEqual(
    paintedBoundsAfter,
    paintedBoundsBefore,
    'Hover reuse must replay the painted text bounds snapshot.',
  )
  assert.deepEqual(
    visibleTextBoundsAfter,
    visibleTextBoundsBefore,
    'Hover reuse must preserve every fully visible text host and raw text bounds snapshot.',
  )
  // No invalidate or geometry query may precede this mouse-down: it must use the replayed registry.
  const selectionAfterHover = await select()
  assert.equal(
    selectionAfterHover,
    baselineSelection,
    'Replayed text must retain native hit testing.',
  )
  renderer.clearSelection()
  await Bun.sleep(150)
  return {
    target: { id: target.id, text: target.text, bounds: box },
    baselineSelection,
    selectionAfterHover,
    paintedTextBefore: paintedBefore.length,
    paintedTextAfter: paintedAfter.length,
    paintedTextSha256: createHash('sha256').update(JSON.stringify(paintedAfter)).digest('hex'),
    paintedBoundsBefore,
    paintedBoundsAfter,
    visibleTextBoundsCount: visibleTextBoundsAfter.length,
    visibleTextBoundsSha256: createHash('sha256')
      .update(JSON.stringify(visibleTextBoundsAfter))
      .digest('hex'),
    glyphPixels: {
      crop: glyphCrop,
      pixelCount: glyphCrop.width * glyphCrop.height,
      baselineDistinctRgbColors: glyphColorsBefore.size,
      beforeSha256: createHash('sha256').update(glyphPixelsBefore).digest('hex'),
      afterSha256: createHash('sha256').update(glyphPixelsAfter).digest('hex'),
      changedPixels: 0,
      beforePatch: glyphPatchBefore,
      afterPatch: glyphPatchAfter,
    },
    hoverCalls,
    hoverWallMs,
    hoverFullDraws: framesAfter.fullDraws - framesBefore.fullDraws,
  }
}
async function denseFunctional() {
  await getFocusSink()
  await activateMain()
  const sourceSelection = await verifySevenTvSources()
  await Bun.sleep(250)
  prepareMotionCrop()
  await Bun.sleep(150)
  const foregroundStart = await frameSnapshot(current())
  const foregroundAt = performance.now()
  const foregroundPixels = await verifyMotion('dense foreground')
  const foregroundEnd = await frameSnapshot(current())
  const foregroundRendering = animationRenderingEvidence(
    foregroundStart,
    foregroundEnd,
    performance.now() - foregroundAt,
  )
  const foregroundSync = await verifyDenseSync()
  await deactivateMain()
  await Bun.sleep(350)
  prepareMotionCrop()
  await Bun.sleep(150)
  const backgroundStart = await frameSnapshot(current())
  const backgroundAt = performance.now()
  const backgroundPixels = await verifyMotion('dense unfocused background')
  const backgroundEnd = await frameSnapshot(current())
  const backgroundRendering = animationRenderingEvidence(
    backgroundStart,
    backgroundEnd,
    performance.now() - backgroundAt,
  )
  const backgroundSync = await verifyDenseSync()
  await activateMain()
  const interactions: Array<{
    width: number
    height: number
    draftLatencyMs: number
    scrollChanged: boolean
    hoverActionVisible: boolean
    motionPixels: number
    hoverText: Awaited<ReturnType<typeof verifyDenseHoverText>>
  }> = []
  for (const size of [{ width: 420, height: 300 }, initialWindow]) {
    await nativeWindow(current()).setWindowBounds(size)
    await until(
      () =>
        nativeWindow(current()).getWindowBounds()?.width === size.width &&
        nativeWindow(current()).getWindowBounds()?.height === size.height,
      'dense window resize observed',
    )
    await Bun.sleep(150)
    const nodes = () => allNodes(automationSchema.parse(JSON.parse(current().getAutomationTree())))
    const input = nodes().find((node) => node.testId === 'chat-input')
    assert(input)
    current().focusElement(input.id)
    const inputBefore = await frameSnapshot(current())
    const start = performance.now()
    current().simulateKeystrokes('d e n s e space q a')
    await until(
      () => [...composerStore.get().values()].some((composer) => composer.text === 'dense qa'),
      'native dense composer input',
    )
    const draftLatencyMs = performance.now() - start
    const inputAfter = await frameSnapshot(current())
    assert(
      inputAfter.fullDraws > inputBefore.fullDraws,
      'Native input must resume a complete draw.',
    )
    current().simulateKeystrokes('ctrl-a backspace')
    await until(
      () => [...composerStore.get().values()].every((composer) => composer.text !== 'dense qa'),
      'native dense composer clear',
    )
    const list = nodes().find((node) => node.type === 'virtual-list')
    const viewport = nodes().find((node) => node.testId === 'chat-messages')?.bounds
    assert(list && viewport)
    current().scrollToItem(list.id, 100, 0)
    await Bun.sleep(150)
    const beforeScroll = JSON.stringify(current().getListScrollTop(list.id))
    current().simulateScrollWheel(
      viewport.x + viewport.width / 2,
      viewport.y + viewport.height / 2,
      0,
      -180,
    )
    await until(
      () => JSON.stringify(current().getListScrollTop(list.id)) !== beforeScroll,
      'native dense scroll input',
    )
    const timestamp = nodes().find(
      (node) =>
        node.testId?.startsWith('chat-timestamp-') &&
        node.bounds &&
        node.bounds.y > viewport.y + 5 &&
        node.bounds.y + node.bounds.height < viewport.y + viewport.height - 10,
    )
    assert(timestamp?.bounds)
    current().simulateMouseMove(
      viewport.x + viewport.width - 20,
      timestamp.bounds.y + timestamp.bounds.height / 2,
    )
    await until(
      () =>
        nodes().some((node) => node.testId === 'msg-reply' && node.bounds && node.bounds.width > 0),
      'dense row hover actions',
    )
    current().simulateMouseMove(0, 0)
    current().scrollToItem(list.id, 199, 0)
    await Bun.sleep(150)
    prepareMotionCrop()
    interactions.push({
      ...size,
      draftLatencyMs,
      scrollChanged: true,
      hoverActionVisible: true,
      motionPixels: await verifyMotion(`dense after input ${size.width}`),
      hoverText: await verifyDenseHoverText(),
    })
    await captureGuiQaDisplay(`dense-emotes-${size.width}`)
  }
  return {
    sourceSelection,
    foregroundPixels,
    foregroundRendering,
    backgroundPixels,
    backgroundRendering,
    foregroundSync,
    backgroundSync,
    interactions,
    visibility: await verifyDenseVisibility(),
  }
}
async function verifyDenseVisibility() {
  const original = app.watchedMessagesStore.get().get(visibleChannel.id)
  assert(original && original.length === 200)
  const history = original.map((message, index) =>
    index < 50
      ? message
      : {
          ...message,
          text: `Static retained history ${index}: visible ordinary chat text.`,
          emotes: [],
          reply: undefined,
        },
  )
  app.watchedMessagesStore.set(
    new Map(app.watchedMessagesStore.get()).set(visibleChannel.id, history),
  )
  await Bun.sleep(250)
  const pauseButton = allNodes(
    automationSchema.parse(JSON.parse(current().getAutomationTree())),
  ).find((node) => node.testId === 'chat-pause-button')
  assert(pauseButton?.bounds)
  current().simulateClick(
    pauseButton.bounds.x + pauseButton.bounds.width / 2,
    pauseButton.bounds.y + pauseButton.bounds.height / 2,
  )
  current().simulateMouseMove(0, 0)
  await Bun.sleep(150)
  const list = allNodes(automationSchema.parse(JSON.parse(current().getAutomationTree()))).find(
    (node) => node.type === 'virtual-list',
  )
  assert(list)
  const staticEvidence = async (label: string) => {
    await until(() => denseImageSlots().length === 0, `${label}: no visible animated image`)
    await Bun.sleep(400)
    const before = await frameSnapshot(current())
    if (before.statsAvailable)
      assert.equal(before.liveSlots, 0, `${label}: no live animation slots`)
    await Bun.sleep(650)
    const after = await frameSnapshot(current())
    if (after.statsAvailable) {
      assert.equal(after.liveSlots, 0, `${label}: animation slots remain released`)
      assert.equal(
        after.animationOnlyPresents,
        before.animationOnlyPresents,
        `${label}: presentations stop`,
      )
      assert.equal(after.slotUploads, before.slotUploads, `${label}: frame uploads stop`)
    }
    return { before, after }
  }
  current().scrollToItem(list.id, 199, 0)
  const firstStatic = await staticEvidence('scrolled past animated history')
  current().scrollToItem(list.id, 15, 0)
  const viewport = allNodes(automationSchema.parse(JSON.parse(current().getAutomationTree()))).find(
    (node) => node.testId === 'chat-messages',
  )?.bounds
  assert(viewport)
  current().simulateScrollWheel(
    viewport.x + viewport.width / 2,
    viewport.y + viewport.height / 2,
    0,
    -40,
  )
  await Bun.sleep(600)
  await captureGuiQaDisplay('visibility-scroll-in')
  await Bun.write(
    join(session, 'visibility-scroll-in.json'),
    JSON.stringify(
      {
        tree: JSON.parse(current().getAutomationTree()),
        scrollTop: current().getListScrollTop(list.id),
        painted: current().getPaintedText(),
        slots: denseImageSlots(),
        nativeSources: [...(nativeSources.get(current()) ?? new Map())],
      },
      null,
      2,
    ),
  )
  await until(() => denseImageSlots().length > 0, 'animated retained history becomes visible')
  await Bun.sleep(250)
  prepareMotionCrop()
  await Bun.sleep(150)
  const resumedBefore = await frameSnapshot(current())
  const resumedPixels = await verifyMotion('retained animation scrolled into view')
  const resumedAfter = await frameSnapshot(current())
  if (resumedAfter.statsAvailable) {
    assert(resumedAfter.liveSlots > 0)
    assert(resumedAfter.animationOnlyPresents > resumedBefore.animationOnlyPresents)
  }
  current().scrollToItem(list.id, 199, 0)
  const secondStatic = await staticEvidence('scrolled away again')
  assert.equal(app.watchedMessagesStore.get().get(visibleChannel.id)?.length, 200)
  current().simulateClick(
    pauseButton.bounds.x + pauseButton.bounds.width / 2,
    pauseButton.bounds.y + pauseButton.bounds.height / 2,
  )
  current().simulateMouseMove(0, 0)
  await Bun.sleep(150)
  return {
    retained: 200,
    animatedHistoryRows: 50,
    firstStatic,
    resumedBefore,
    resumedAfter,
    resumedPixels,
    secondStatic,
  }
}
function animationRenderingEvidence(
  before: FrameSnapshot,
  after: FrameSnapshot,
  durationMs: number,
) {
  const result = {
    durationMs,
    countersAvailable: before.statsAvailable && after.statsAvailable,
    fullDraws: after.fullDraws - before.fullDraws,
    animationOnlyPresents: after.animationOnlyPresents - before.animationOnlyPresents,
    slotUploads: after.slotUploads - before.slotUploads,
    expectedUniqueFrameUploadsUpperBound:
      Math.ceil(
        (denseDelays.reduce((total, delay) => total + 1000 / delay, 0) * durationMs) / 1000,
      ) +
      denseDelays.length * 2,
  }
  if (result.countersAvailable) {
    assert.equal(
      result.fullDraws,
      0,
      'Idle animation must present new pixels without a full native draw.',
    )
    assert(result.animationOnlyPresents > 0, 'Idle animation-only presentations must advance.')
    assert(
      result.slotUploads <= result.expectedUniqueFrameUploadsUpperBound,
      'Copies of the same animated source must share frame uploads.',
    )
  }
  return result
}
async function verifySevenTvSources() {
  if (!usesSevenTvSources) return null
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
  const allVariantPaths = new Set(
    fixtures.flatMap((fixture) => fixture.variants?.map((variant) => variant.path) ?? []),
  )
  for (const path of paintedSources) {
    if (allVariantPaths.has(path))
      assert(
        expectedPaths.has(path),
        'Inline native images must not load the original oversized preview.',
      )
  }
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
    focusedFullDraws: number
    focusedAnimationOnlyPresents: number
    blurredFullDraws: number
    blurredAnimationOnlyPresents: number
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
    const startFrames = await frameSnapshot(current())
    await Bun.sleep(500)
    const focusedEnd = await frameSnapshot(current())
    const focusedFrames = focusedEnd.totalPresents - startFrames.totalPresents
    await focusNativeQaWindow('TwirChat chat')
    await until(() => !nativeWindow(current()).isWindowActive(), 'main window deactivated')
    await Bun.sleep(200)
    const before = await crop()
    const blurredStart = await frameSnapshot(current())
    await Bun.sleep(600)
    const frozenPixels = changedPixels(before, await crop())
    const blurredEnd = await frameSnapshot(current())
    const blurredFrames = blurredEnd.totalPresents - blurredStart.totalPresents
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
      focusedFullDraws: focusedEnd.fullDraws - startFrames.fullDraws,
      focusedAnimationOnlyPresents:
        focusedEnd.animationOnlyPresents - startFrames.animationOnlyPresents,
      blurredFullDraws: blurredEnd.fullDraws - blurredStart.fullDraws,
      blurredAnimationOnlyPresents:
        blurredEnd.animationOnlyPresents - blurredStart.animationOnlyPresents,
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
  await nativeWindow(current()).setWindowBounds({
    ...initialWindow,
    ...(nativeWindow(current()).getWindowCapabilities().position ? { x: 20, y: 20 } : {}),
  })
  await until(
    () =>
      nativeWindow(current()).getWindowBounds()?.width === initialWindow.width &&
      nativeWindow(current()).getWindowBounds()?.height === initialWindow.height,
    'initial native window dimensions',
  )
  assert.equal(
    (await backend.api.getAccounts()).length,
    0,
    'Only the isolated empty profile may be used.',
  )
  for (const channel of channels) {
    for (let index = 0; index < 200; index++)
      inject(channel, fixtures[index % initialFixtureCount] ?? firstFixture)
  }
  await until(() => retained() === channels.length * 200, 'all retained channel histories filled')
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
        usesSevenTvSources
          ? inlineEmoteImageSource(firstFixture.url, {
              height: Math.round(DEFAULT_SETTINGS.fontSize * 2),
              scale: readWindowScale(current()),
              backendUrl: getBackendUrl(),
            })
          : firstFixture.url,
      ) === 'string',
    'local animated image ready',
  )
  if (dense) await getFocusSink()
  await activateMain()
  if (config.activation === 'unfocused') await deactivateMain()
  await Bun.sleep(config.warmupSeconds * 1000)
  const reactMode = verifyBenchmarkReactMode({
    requested: 'production',
    nodeEnv: process.env.NODE_ENV,
    hasCaptureOwnerStack: typeof React.captureOwnerStack === 'function',
    loadedModules: Object.keys(require.cache),
  })
  const measurement =
    config.case === 'functional'
      ? dense
        ? await denseFunctional()
        : await functional()
      : await measure()
  if (config.case === 'functional')
    await Bun.write(join(session, 'functional-evidence.json'), JSON.stringify(measurement, null, 2))
  const settledStats = await waitForImageStats(
    current(),
    (stats) => stats.loading === 0,
    'all image decodes settle',
  )
  if (settledStats && !dense && config.case === 'idle' && config.source === 'synthetic') {
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
    configSha256: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
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
    sourceWidth: usesSevenTvSources ? 128 : frameWidth,
    sourceHeight: usesSevenTvSources ? 128 : frameHeight,
    effectiveSource: usesSevenTvSources ? 'seventv' : 'synthetic',
    encodedDelaysMs: [...new Set(fixtures.map((fixture) => fixture.delayMs))],
    focusSinkIncluded: focusSink !== undefined,
    display: {
      width: process.env.TWIRCHAT_QA_DISPLAY_WIDTH ?? null,
      height: process.env.TWIRCHAT_QA_DISPLAY_HEIGHT ?? null,
    },
    denseContent: dense
      ? {
          avatars: denseAvatarUrls.length,
          badgeImages: denseBadgeUrls.length,
          showTimestamp: true,
          showBadges: true,
          showAvatars: true,
          repliesEvery: 3,
          wrappingText: true,
        }
      : null,
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
  const sink = focusSink
  if (sink) {
    nativeWindow(sink).closeWindow()
    await until(() => !nativeWindow(sink).isWindowOpen(), 'private focus sink closed')
  }
  await manager.quit()
  backend.dispose?.()
}
process.exit(0)
