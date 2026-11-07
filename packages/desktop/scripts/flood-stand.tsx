/**
 * Local chat flood stand. Unlike bench:chat it runs on Windows and models a real
 * busy channel: badges, emote images, avatars setting and chat history logging.
 *
 *   bun scripts/flood-stand.tsx --rate 100 --workload real --mode production
 *
 * It opens a real window on the current desktop. The profile lives in a temporary
 * directory and the backend URL points at a closed port, so real data is not touched.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: {
    rate: { type: 'string', default: '100' },
    workload: { type: 'string', default: 'real' },
    mode: { type: 'string', default: 'production' },
    channels: { type: 'string', default: '1' },
    panes: { type: 'string', default: '1' },
    warmup: { type: 'string', default: '3' },
    duration: { type: 'string', default: '15' },
    output: { type: 'string' },
    'cpu-prof': { type: 'string' },
    // none | pipeline | empty-frames | tree-frames: isolates one cost layer.
    experiment: { type: 'string', default: 'none' },
    // Real emote file served for every emote, for example a 7TV animated WebP or AVIF.
    'image-file': { type: 'string' },
    screenshot: { type: 'string' },
    theme: { type: 'string', default: 'modern' },
    // Scrolls up during the flood and reports whether older rows stay reachable and stable.
    'scroll-check': { type: 'boolean', default: false },
    // panes: bare ChatViews in one row; watched: the real WatchedView with its split layout.
    view: { type: 'string', default: 'panes' },
    // row | 2x2: split shape used by --view watched.
    grid: { type: 'string', default: 'row' },
    width: { type: 'string', default: '1200' },
    height: { type: 'string', default: '800' },
  },
})

if (process.env.TWIRCHAT_FLOOD_STAND !== '1') {
  const profile = await mkdtemp(join(tmpdir(), 'twirchat-flood-'))
  const profiler = args['cpu-prof'] ? ['--cpu-prof', `--cpu-prof-dir=${args['cpu-prof']}`] : []
  const child = Bun.spawn(['bun', ...profiler, import.meta.path, ...process.argv.slice(2)], {
    env: {
      ...process.env,
      TWIRCHAT_FLOOD_STAND: '1',
      NODE_ENV: args.mode,
      USERPROFILE: profile,
      HOME: profile,
      CHATRIX_BACKEND_URL: 'http://127.0.0.1:9',
      CHATRIX_BACKEND_WS_URL: 'ws://127.0.0.1:9/ws',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const code = await child.exited
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  process.exit(code)
}

assert.ok(homedir().includes('twirchat-flood-'), 'Refusing to run against the real profile.')

await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const sharp = (await import('sharp')).default
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { recordChatMessage } = await import('../src/gpuix/backend/chat-history')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { WatchedView } = await import('../src/gpuix/components/WatchedView')
const app = await import('../src/gpuix/state/app')
const { layoutStore } = await import('../src/gpuix/state/layout')
const { emotePreferencesStore } = await import('../src/gpuix/state/emote-preferences')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
import type { NativeRenderer } from '@gpuix/react'
import type {
  Emote,
  LayoutNode,
  NormalizedChatMessage,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'

const rate = Number(args.rate)
const workload = args.workload
assert.ok(workload === 'text' || workload === 'real' || workload === 'animated')
const realistic = workload !== 'text'
const channelCount = Number(args.channels)
const paneCount = Number(args.panes)
const experiment = args.experiment
assert.ok(['none', 'pipeline', 'empty-frames', 'tree-frames'].includes(experiment))
const mountChat = experiment === 'none' || experiment === 'tree-frames'
const tickFrames = experiment === 'empty-frames' || experiment === 'tree-frames'

async function staticImage(hue: number): Promise<Buffer> {
  const r = Math.round(127 + 127 * Math.sin(hue))
  return sharp({
    create: { width: 56, height: 56, channels: 4, background: { r, g: 120, b: 255 - r, alpha: 1 } },
  })
    .png()
    .toBuffer()
}
async function animatedImage(hue: number): Promise<Buffer> {
  const frames = await Promise.all(
    Array.from({ length: 12 }, (_, frame) => staticImage(hue + frame / 2)),
  )
  return sharp(frames, { join: { animated: true } })
    .webp({ delay: Array.from({ length: 12 }, () => 40), loop: 0 })
    .toBuffer()
}
const images = await Promise.all(
  Array.from({ length: 16 }, (_, index) =>
    workload === 'animated' ? animatedImage(index) : staticImage(index),
  ),
)
const imageFile = args['image-file']
const imageExtension = imageFile?.split('.').pop() ?? (workload === 'animated' ? 'webp' : 'png')
const fileBytes = imageFile ? Buffer.from(await Bun.file(imageFile).arrayBuffer()) : undefined
const imageServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const name = new URL(request.url).pathname.split('/').pop() ?? '0'
    const index = Number.parseInt(name, 10) % images.length
    const body = fileBytes ?? images[index]
    if (!body) return new Response('Unknown image', { status: 404 })
    return new Response(new Uint8Array(body), {
      headers: { 'content-type': `image/${imageExtension}` },
    })
  },
})
const imageUrl = (index: number) =>
  `http://127.0.0.1:${imageServer.port}/image/${index}.${imageExtension}`

const backend = getDesktopBackend()
const channels: WatchedChannel[] = Array.from({ length: channelCount }, (_, index) => ({
  id: `stand-${index}`,
  platform: 'twitch',
  channelSlug: `stand${index}`,
  displayName: `Stand ${index + 1}`,
  createdAt: 0,
}))
const visibleChannels = channels.slice(0, paneCount)
assert.ok(args.view === 'panes' || args.view === 'watched', '--view must be panes or watched')
assert.ok(
  args.grid === 'row' || (args.grid === '2x2' && paneCount === 4),
  '--grid 2x2 needs 4 panes',
)
const panel = (channel: WatchedChannel, flex: number): LayoutNode => ({
  type: 'panel',
  id: channel.id,
  flex,
  content: { type: 'watched', channelId: channel.id },
})
const columns = [visibleChannels.slice(0, 2), visibleChannels.slice(2, 4)]
const layout: WatchedChannelsLayout = {
  version: 2,
  root:
    args.grid === '2x2'
      ? {
          type: 'split',
          id: 'stand-root',
          direction: 'vertical',
          flex: 100,
          children: columns.map((column, index) => ({
            type: 'split',
            id: `stand-column-${index}`,
            direction: 'horizontal',
            flex: 50,
            children: column.map((channel) => panel(channel, 50)),
          })),
        }
      : {
          type: 'split',
          id: 'stand-root',
          direction: 'horizontal',
          flex: 100,
          children: visibleChannels.map((channel) => panel(channel, 100 / visibleChannels.length)),
        },
}
app.settingsStore.set(
  realistic
    ? { ...DEFAULT_SETTINGS, chatTheme: args.theme === 'compact' ? 'compact' : 'modern' }
    : { ...DEFAULT_SETTINGS, showAvatars: false, chatTheme: 'compact' },
)
app.accountsStore.set([])
app.watchedChannelsStore.set(channels)
app.watchedStatusesStore.set(
  new Map(
    channels.map((channel) => [
      channel.id,
      { platform: 'twitch', status: 'connected', mode: 'anonymous' },
    ]),
  ),
)
layoutStore.set(new Map([['stand', { layout, isLoading: false, error: null }]]))
// WatchedView reloads its layout from the profile when it mounts.
await backend.api.setWatchedChannelsLayout({ tabId: 'stand', layout })
if (!realistic) {
  emotePreferencesStore.update({
    value: {
      ...emotePreferencesStore.get().value,
      badges: false,
      paints: false,
      personal: false,
      enabled: { twitch: false, seventv: false, bttv: false, ffz: false },
    },
  })
}
const stopMessages = app.wireBackendToStores(backend)

let renderer: NativeRenderer | undefined
let tickListener: (() => void) | undefined
function Ticker() {
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    tickListener = () => setTick((current) => current + 1)
    return () => {
      tickListener = undefined
    }
  }, [])
  return React.createElement('div', { style: { color: '#ffffff', fontSize: 12 } }, `tick ${tick}`)
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
    ...(tickFrames ? [React.createElement(Ticker, { key: 'ticker' })] : []),
    ...(mountChat && args.view === 'watched'
      ? [React.createElement(WatchedView, { key: 'watched', tabId: 'stand' })]
      : []),
    ...(mountChat && args.view !== 'watched' ? visibleChannels : []).map((channel) =>
      React.createElement(
        'div',
        {
          key: channel.id,
          style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100%' },
        },
        React.createElement(ChatView, {
          paneId: `stand:${channel.id}`,
          layoutTabId: 'stand',
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

const phrases = [
  'Привет! Как проходит стрим?',
  'Nice play, that was a close one!',
  'Обсуждаем интерфейс и новые функции чата.',
  'A longer chat message with several words, punctuation, numbers 12345 and a question?',
  'Короткое сообщение.',
  'Thanks for the stream, see you next time.',
  'LMAO',
  'KEKW KEKW KEKW',
]
if (args['scroll-check']) {
  phrases[4] =
    'A long plain message without any emotes that has to wrap onto several lines inside the chat pane, so merged text can be checked by eye, because it is one text element now and must not overflow.'
}
let sequence = 0
function messageFor(id: number): NormalizedChatMessage {
  const channel = channels[id % channels.length]
  assert.ok(channel)
  let text = `${phrases[id % phrases.length] ?? ''} ${id % 997}`
  const emotes: Emote[] = []
  if (realistic) {
    for (let index = 0; index < id % 4; index++) {
      const image = (id + index) % images.length
      const name = `Emote${image}`
      const start = text.length + 1
      text = `${text} ${name}`
      emotes.push({
        id: `emote-${image}-${index}`,
        name,
        imageUrl: imageUrl(image),
        positions: [{ start, end: start + name.length - 1 }],
        animated: workload === 'animated' || imageFile !== undefined,
      })
    }
  }
  return {
    id: `stand-message-${id}`,
    platform: 'twitch',
    channelId: channel.channelSlug,
    type: 'message',
    timestamp: new Date(),
    text,
    author: {
      id: `viewer-${id % 256}`,
      username: `viewer${id % 256}`,
      displayName: `Viewer${id % 256}`,
      color: ['#c084fc', '#38bdf8', '#4ade80', '#fb923c'][id % 4],
      badges: realistic
        ? [{ id: 'subscriber/6', type: 'subscriber', text: 'Sub', imageUrl: imageUrl(id % 3) }]
        : [],
    },
    emotes,
  }
}
function inject(): void {
  const id = sequence++
  const channel = channels[id % channels.length]
  assert.ok(channel)
  const message = messageFor(id)
  if (realistic) recordChatMessage(message)
  backend.events.emit('watched_channel_message', { channelId: channel.id, message })
}
function animationStats(current: NativeRenderer): Record<string, number> {
  const read: unknown = Reflect.get(current, 'getImageAnimationStats')
  if (typeof read !== 'function') return {}
  const stats: unknown = Reflect.apply(read, current, [])
  if (typeof stats !== 'object' || stats === null) return {}
  return Object.fromEntries(
    Object.entries(stats).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  )
}
function generator(target: number): { stop(): void; generated(): number } {
  let generated = 0
  let fraction = 0
  let previous = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    fraction += ((now - previous) * target) / 1000
    previous = now
    const count = Math.min(250, Math.floor(fraction))
    fraction -= count
    for (let index = 0; index < count; index++) inject()
    generated += count
  }, 20)
  return { stop: () => clearInterval(timer), generated: () => generated }
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline) {
    if (check()) return
    // Polling must stay sequential.
    // eslint-disable-next-line no-await-in-loop
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}

interface ThreadTime {
  id: number
  ms: number
}
function visibleIds(current: NativeRenderer): number[] {
  const read: unknown = Reflect.get(current, 'getPaintedText')
  if (typeof read !== 'function') return []
  const texts: unknown = Reflect.apply(read, current, [])
  if (!Array.isArray(texts)) return []
  return texts.flatMap((text) => {
    const match = typeof text === 'string' ? /^Viewer(\d+)$/u.exec(text.trim()) : null
    return match ? [Number(match[1])] : []
  })
}
function scrollUp(current: NativeRenderer): void {
  const scroll: unknown = Reflect.get(current, 'simulateScrollWheel')
  if (typeof scroll !== 'function') throw new Error('Native scroll simulation unavailable.')
  Reflect.apply(scroll, current, [300, 400, 0, 120])
}
function frameCount(current: NativeRenderer): number {
  return current.getDebugFrameOverlayStats?.().frames ?? 0
}
async function scrollCheck(current: NativeRenderer): Promise<void> {
  const load = generator(rate)
  await Bun.sleep(1000)
  const following = visibleIds(current)
  for (let step = 0; step < 12; step++) {
    scrollUp(current)
    // Wheel events must be spread over frames.
    // eslint-disable-next-line no-await-in-loop
    await Bun.sleep(30)
  }
  await Bun.sleep(400)
  const scrolled = visibleIds(current)
  await Bun.sleep(2000)
  const afterFlood = visibleIds(current)
  for (let step = 0; step < 80; step++) {
    scrollUp(current)
    // Wheel events must be spread over frames.
    // eslint-disable-next-line no-await-in-loop
    await Bun.sleep(15)
  }
  await Bun.sleep(400)
  const deep = visibleIds(current)
  load.stop()
  console.log(
    `SCROLL ${JSON.stringify({ following, scrolled, afterFlood, stableWhileFlooding: JSON.stringify(scrolled) === JSON.stringify(afterFlood), deep })}`,
  )
}
async function threadTimes(): Promise<ThreadTime[]> {
  if (process.platform !== 'win32') return []
  const script = `(Get-Process -Id ${process.pid}).Threads | ForEach-Object { "$($_.Id) $($_.TotalProcessorTime.TotalMilliseconds)" }`
  const child = Bun.spawn(['powershell', '-NoProfile', '-Command', script], { stdout: 'pipe' })
  const output = await new Response(child.stdout).text()
  await child.exited
  return output
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.split(' '))
    .map(([id, ms]) => ({ id: Number(id), ms: Number.parseFloat(ms ?? '0') }))
}

try {
  await manager.start()
  await until(() => renderer !== undefined, 'native window')
  assert.ok(renderer)
  await nativeWindow(renderer).setWindowBounds({
    width: Number(args.width),
    height: Number(args.height),
  })
  assert.equal((await backend.api.getAccounts()).length, 0)
  for (let index = 0; index < channelCount * 200; index++) inject()
  await until(
    () => channels.every((c) => app.watchedMessagesStore.get().get(c.id)?.length === 200),
    'buffers filled',
  )
  const warmup = generator(rate)
  await Bun.sleep(Number(args.warmup) * 1000)
  warmup.stop()
  await Bun.sleep(100)

  if (args.screenshot && process.platform === 'win32') {
    await Bun.sleep(1500)
    const bounds = nativeWindow(renderer).getWindowBounds()
    assert.ok(bounds)
    const target = args.screenshot.replaceAll("'", "''")
    const script = [
      'Add-Type -AssemblyName System.Drawing,System.Windows.Forms',
      `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class D { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'`,
      '[D]::SetProcessDPIAware() | Out-Null',
      '$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
      '$b=New-Object System.Drawing.Bitmap $s.Width,$s.Height',
      '$g=[System.Drawing.Graphics]::FromImage($b)',
      '$g.CopyFromScreen($s.X,$s.Y,0,0,$b.Size)',
      `$b.Save('${target}')`,
    ].join(';')
    await Bun.spawn(['powershell', '-NoProfile', '-Command', script]).exited
  }
  if (args['scroll-check']) await scrollCheck(renderer)
  const threadsBefore = await threadTimes()
  const framesBefore = frameCount(renderer)
  const animationBefore = animationStats(renderer)
  const lags: number[] = []
  let expected = performance.now() + 50
  const lagTimer = setInterval(() => {
    const now = performance.now()
    lags.push(Math.max(0, now - expected))
    expected = now + 50
  }, 50)
  const cpuStart = process.cpuUsage()
  const start = performance.now()
  const load = generator(rate)
  const ticker = tickFrames ? setInterval(() => tickListener?.(), 20) : undefined
  await Bun.sleep(Number(args.duration) * 1000)
  clearInterval(ticker)
  load.stop()
  const wallMs = performance.now() - start
  const cpu = process.cpuUsage(cpuStart)
  clearInterval(lagTimer)
  const frames = frameCount(renderer) - framesBefore
  const animationAfter = animationStats(renderer)
  const animationPerSecond = Object.fromEntries(
    Object.entries(animationAfter).map(([key, value]) => [
      key,
      Math.round(((value - (animationBefore[key] ?? 0)) / wallMs) * 10_000) / 10,
    ]),
  )
  const threadsAfter = await threadTimes()
  const before = new Map(threadsBefore.map((thread) => [thread.id, thread.ms]))
  const busiestThreads = threadsAfter
    .map((thread) => ({
      id: thread.id,
      percent: ((thread.ms - (before.get(thread.id) ?? 0)) / wallMs) * 100,
    }))
    .filter((thread) => thread.percent >= 0.5)
    .toSorted((a, b) => b.percent - a.percent)
    .slice(0, 8)
    .map((thread) => Math.round(thread.percent * 10) / 10)
  const sortedLags = lags.toSorted((a, b) => a - b)
  const result = {
    workload,
    experiment,
    mode: args.mode,
    rate,
    channels: channelCount,
    panes: paneCount,
    actualRate: Math.round(load.generated() / (wallMs / 1000)),
    cpuPercent: Math.round(((cpu.user + cpu.system) / (wallMs * 1000)) * 1000) / 10,
    userPercent: Math.round((cpu.user / (wallMs * 1000)) * 1000) / 10,
    framesPerSecond: Math.round((frames / wallMs) * 10_000) / 10,
    paintedAuthors: visibleIds(renderer).length,
    // The busiest thread is the native renderer; its time per full draw approximates frame cost.
    nativeMsPerDraw:
      busiestThreads[0] !== undefined && animationPerSecond.fullDraws
        ? Math.round((busiestThreads[0] * 100) / animationPerSecond.fullDraws) / 10
        : null,
    lagP95Ms: Math.round((sortedLags[Math.floor(sortedLags.length * 0.95)] ?? 0) * 10) / 10,
    rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2),
    busiestThreads,
    animationPerSecond,
  }
  console.log(`RESULT ${JSON.stringify(result)}`)
  if (args.output) await Bun.write(args.output, JSON.stringify(result))
} finally {
  stopMessages()
  await manager.quit()
  await backend.shutdownPlugins?.()
  backend.dispose?.()
  await imageServer.stop(true)
}
process.exit(0)
