if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()

import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { NativeRenderer } from '@gpuix/react'
import type {
  NormalizedChatMessage,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'
import { z } from 'zod'

import {
  benchmarkCaseSchema,
  benchmarkProvenanceSchema,
  benchmarkResultSchema,
  benchmarkReactModeSchema,
  gpuMeasurements,
  pluginSubscriberResultSchema,
  percentile,
  readDrmSnapshot,
  verifyBenchmarkReactMode,
  type ResourceSample,
} from './bench-metrics'

const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const app = await import('../src/gpuix/state/app')
const { layoutStore } = await import('../src/gpuix/state/layout')
const { emotePreferencesStore } = await import('../src/gpuix/state/emote-preferences')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const configuration: unknown = JSON.parse(process.argv[2] ?? '{}')
const config = benchmarkCaseSchema.parse(configuration)
const provenance = benchmarkProvenanceSchema.parse(JSON.parse(process.argv[3] ?? '{}'))
const reactMode = verifyBenchmarkReactMode({
  requested: benchmarkReactModeSchema.parse(process.argv[4] ?? 'development'),
  nodeEnv: process.env.NODE_ENV,
  hasCaptureOwnerStack: typeof React.captureOwnerStack === 'function',
  loadedModules: Object.keys(require.cache),
})
const directory = process.env.TWIRCHAT_QA_SESSION_DIR
assert.ok(directory)
const backend = getDesktopBackend()
const channels: WatchedChannel[] = Array.from({ length: config.channels }, (_, index) => ({
  id: `bench-${index}`,
  platform: 'kick',
  channelSlug: `bench-${index}`,
  displayName: `Benchmark ${index + 1}`,
  createdAt: 0,
}))
const visibleChannels = channels.slice(0, config.panes)
const layout: WatchedChannelsLayout = {
  version: 2,
  root: {
    type: 'split',
    id: 'benchmark-root',
    direction: 'horizontal',
    flex: 100,
    children: visibleChannels.map((channel) => ({
      type: 'panel',
      id: channel.id,
      flex: 100 / visibleChannels.length,
      content: { type: 'watched', channelId: channel.id },
    })),
  },
}
app.settingsStore.set({ ...DEFAULT_SETTINGS, showAvatars: false, chatTheme: 'compact' })
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
layoutStore.set(new Map([['benchmark', { layout, isLoading: false, error: null }]]))
emotePreferencesStore.update({
  value: {
    ...emotePreferencesStore.get().value,
    badges: false,
    paints: false,
    personal: false,
    enabled: { twitch: false, seventv: false, bttv: false, ffz: false },
  },
})
const stopMessages = app.wireBackendToStores(backend)
let renderer: NativeRenderer | undefined
function paintedText(current: NativeRenderer): string[] {
  const read: unknown = Reflect.get(current, 'getPaintedText')
  if (typeof read !== 'function') throw new Error('Native painted-text diagnostics unavailable.')
  return z.array(z.string()).parse(Reflect.apply(read, current, []))
}
function Content() {
  const current = useGpuixRequired()
  React.useEffect(() => {
    renderer = current
  }, [current])
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        backgroundColor: '#16161c',
      },
    },
    ...visibleChannels.map((channel) =>
      React.createElement(
        'div',
        {
          key: channel.id,
          style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100%' },
        },
        React.createElement(ChatView, {
          paneId: `benchmark:${channel.id}`,
          layoutTabId: 'benchmark',
          layoutPanelId: channel.id,
          watchedChannel: channel,
        }),
      ),
    ),
  )
}
const manager = new DesktopWindowManager(
  backend,
  () => React.createElement(Content),
  () => {},
)
let sequence = 0
const phrases = [
  'Привет! Как проходит стрим?',
  'Nice play, that was a close one!',
  'Обсуждаем интерфейс и новые функции чата.',
  'A longer chat message with several words, punctuation, numbers 12345 and a question?',
  'Короткое сообщение.',
  'Thanks for the stream, see you next time.',
]
function inject(): void {
  const channel = channels[sequence % channels.length]
  assert.ok(channel)
  const id = sequence++
  const message: NormalizedChatMessage = {
    id: `bench-message-${id}`,
    platform: 'kick',
    channelId: channel.channelSlug,
    type: 'message',
    timestamp: new Date(),
    text: `${phrases[id % phrases.length] ?? ''} ${id % 997}`,
    author: {
      id: `viewer-${id % 256}`,
      username: `viewer${id % 256}`,
      displayName: `Viewer${id % 256}`,
      color: ['#c084fc', '#38bdf8', '#4ade80', '#fb923c'][id % 4],
      badges: [],
    },
    emotes: [],
  }
  backend.events.emit('watched_channel_message', { channelId: channel.id, message })
}
function processed(): number {
  return channels.reduce(
    (total, channel) => total + (app.chatActivityStore.get().get(channel.id)?.total ?? 0),
    0,
  )
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
function generator(rate: number): { stop(): void; generated(): number } {
  let generated = 0
  let fraction = 0
  let previous = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    fraction += ((now - previous) * rate) / 1000
    previous = now
    const count = Math.min(250, Math.floor(fraction))
    fraction -= Math.floor(fraction)
    for (let index = 0; index < count; index++) inject()
    generated += count
  }, 20)
  return { stop: () => clearInterval(timer), generated: () => generated }
}

async function startPluginSubscriber() {
  const plugins = backend.plugins
  assert(plugins)
  const fixture = join(directory, 'subscriber-fixture')
  const manifest = join(fixture, 'manifest.json')
  const metricsPath = join(fixture, 'subscriber.json')
  await mkdir(fixture)
  await Bun.write(
    manifest,
    JSON.stringify({
      id: 'benchmark-subscriber',
      name: 'Benchmark subscriber',
      version: '1.0.0',
      apiVersion: 1,
      entry: 'index.ts',
    }),
  )
  await Bun.write(
    join(fixture, 'index.ts'),
    `export default function activate(api) {
      let first = Infinity
      let received = 0
      let cpuStart = process.cpuUsage()
      let start = performance.now()
      api.on('message', ({ id }) => {
        if (Number(id.slice('bench-message-'.length)) >= first) received++
      })
      api.registerCommand('benchmark-start', ({ args }) => {
        first = Number(args[0])
        start = performance.now()
        cpuStart = process.cpuUsage()
      })
      api.registerCommand('benchmark-finish', async () => {
        const cpu = process.cpuUsage(cpuStart)
        await Bun.write(${JSON.stringify(metricsPath)}, JSON.stringify({
          received, cpuMicroseconds: cpu.user + cpu.system, wallMs: performance.now() - start,
          rssBytes: process.memoryUsage.rss(),
        }))
      })
    }`,
  )
  await plugins.install(manifest)
  await plugins.setEnabled('benchmark-subscriber', true)
  assert.equal(plugins.list()[0]?.status, 'running', plugins.list()[0]?.error)
  return {
    start: () =>
      plugins.runCommand('benchmark-start', { text: '', args: [String(sequence)], channel: null }),
    async finish() {
      await plugins.runCommand('benchmark-finish', { text: '', args: [], channel: null })
      const result = pluginSubscriberResultSchema.parse(await Bun.file(metricsPath).json())
      return { ...result, warning: plugins.list()[0]?.error }
    },
  }
}

try {
  await manager.start()
  await until(() => renderer !== undefined, 'native benchmark window')
  assert.ok(renderer)
  await nativeWindow(renderer).setWindowBounds({ width: 1200, height: 800 })
  assert.equal(
    await backend.api.getAccounts().then((accounts) => accounts.length),
    0,
    'Benchmark must not read real credentials.',
  )
  for (let index = 0; index < config.channels * 200; index++) inject()
  await until(
    () =>
      channels.every((channel) => app.watchedMessagesStore.get().get(channel.id)?.length === 200),
    'all channel buffers filled',
  )
  await until(
    () => renderer !== undefined && paintedText(renderer).some((text) => text.includes('Viewer')),
    'real native message text painted',
  )
  const subscriber = config.pluginSubscriber ? await startPluginSubscriber() : undefined
  const warmup = generator(config.rate)
  await Bun.sleep(config.warmupSeconds * 1000)
  warmup.stop()
  await Bun.sleep(100)
  if (subscriber) await subscriber.start()
  if (process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb') await captureGuiQaDisplay('benchmark-before')
  const initialProcessed = processed()
  const baselineMemory = process.memoryUsage()
  const initialGpu = readDrmSnapshot()
  let lastGpu = initialGpu
  const samples: ResourceSample[] = []
  const lags: number[] = []
  const cpuStart = process.cpuUsage()
  const start = performance.now()
  const ending = Promise.withResolvers<'completed' | 'rss-limit'>()
  const deadline = setTimeout(() => ending.resolve('completed'), config.durationSeconds * 1000)
  let expected = start + 50
  const lagTimer = setInterval(() => {
    const now = performance.now()
    lags.push(Math.max(0, now - expected))
    expected = now + 50
  }, 50)
  const sample = () => {
    const memory = process.memoryUsage()
    const next = readDrmSnapshot()
    samples.push({
      elapsedMs: performance.now() - start,
      rssBytes: memory.rss,
      heapBytes: memory.heapUsed,
      processed: processed() - initialProcessed,
      gpu: gpuMeasurements(lastGpu, next),
    })
    lastGpu = next
    if (memory.rss > 2 * 1024 ** 3) ending.resolve('rss-limit')
  }
  const sampleTimer = setInterval(sample, 250)
  const load = generator(config.rate)
  const termination = await ending.promise
  load.stop()
  clearTimeout(deadline)
  clearInterval(lagTimer)
  clearInterval(sampleTimer)
  const wallMs = performance.now() - start
  const cpu = process.cpuUsage(cpuStart)
  const count = processed() - initialProcessed
  sample()
  const endGpu = readDrmSnapshot()
  const userTimingMeasureCount = performance.getEntriesByType('measure').length
  await Bun.sleep(2000)
  const pluginSubscriber = subscriber ? await subscriber.finish() : undefined
  const bounds = nativeWindow(renderer).getWindowBounds()
  assert.ok(bounds)
  assert.equal(bounds.width, 1200)
  assert.equal(bounds.height, 800)
  const requestedMessages = Math.floor((config.rate * wallMs) / 1000)
  const gpu = gpuMeasurements(initialGpu, endGpu)
  const result = benchmarkResultSchema.parse({
    config,
    pluginSubscriber,
    reactMode,
    userTimingMeasureCount,
    wallMs,
    cpuPercent: ((cpu.user + cpu.system) / (wallMs * 1000)) * 100,
    requestedMessages,
    generatedMessages: load.generated(),
    processedMessages: count,
    processedAfterDrain: processed() - initialProcessed,
    achievedRate: count / (wallMs / 1000),
    generatorMissedMessages: Math.max(0, requestedMessages - load.generated()),
    rssBaselineBytes: baselineMemory.rss,
    rssMedianBytes: percentile(
      samples.map((entry) => entry.rssBytes),
      0.5,
    ),
    rssPeakBytes: Math.max(baselineMemory.rss, ...samples.map((entry) => entry.rssBytes)),
    heapPeakBytes: Math.max(baselineMemory.heapUsed, ...samples.map((entry) => entry.heapBytes)),
    eventLoopLagP50Ms: percentile(lags, 0.5),
    eventLoopLagP95Ms: percentile(lags, 0.95),
    eventLoopLagMaxMs: Math.max(0, ...lags),
    gpu,
    samples,
    retainedMessages: channels.reduce(
      (total, channel) => total + (app.watchedMessagesStore.get().get(channel.id)?.length ?? 0),
      0,
    ),
    nativeWindow: { width: bounds.width, height: bounds.height },
    bunVersion: Bun.version,
    timestamp: new Date().toISOString(),
    compositor: process.env.TWIRCHAT_QA_COMPOSITOR,
    hardwareGpuCountersAvailable: gpu.some((device) => typeof device.engines.gfx === 'number'),
    paintedTextVerified: true,
    provenance,
    termination,
  })
  if (
    config.rate > 0 &&
    termination === 'completed' &&
    !result.gpu.some((device) => (device.engines.gfx ?? 0) > 0)
  )
    throw new Error(
      'No active per-process GPU graphics counter; refusing a software-rendered benchmark.',
    )
  await Bun.write(join(directory, 'benchmark-result.json'), JSON.stringify(result, null, 2))
  if (process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb') await captureGuiQaDisplay('benchmark-after')
  console.log(
    JSON.stringify({
      ok: true,
      channels: config.channels,
      target: config.rate,
      panes: config.panes,
      cpu: result.cpuPercent,
      rate: result.achievedRate,
      rssMiB: result.rssPeakBytes / 1024 ** 2,
      gpu: result.gpu,
      termination,
    }),
  )
} finally {
  stopMessages()
  await manager.quit()
  await backend.shutdownPlugins?.()
  backend.dispose?.()
}
process.exit(0)
