import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { NormalizedChatMessage, WatchedChannel } from '@twirchat/shared/types'
import { z } from 'zod'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import type { TwirNowPlaying } from '../src/services/twir-now-playing'
import { focusNativeQaWindow, getNativeQaWindowGeometry } from './qa-x11'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { ChatImageWindow } = await import('../src/gpuix/components/ChatImagePreview')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { registerHotkeyActions } = await import('../src/gpuix/state/hotkeys')
const { chatPauseStore } = await import('../src/gpuix/state/chat-pause')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const app = await import('../src/gpuix/state/app')
const accountState = await import('../src/gpuix/state/accounts')

interface AutomationNode {
  id: number
  testId?: string
  text?: string
  children: AutomationNode[]
}

const nodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    text: z.string().optional(),
    children: z.array(nodeSchema).default([]),
  }),
)
const channel: WatchedChannel = {
  id: 'image-preview-qa',
  platform: 'twitch',
  channelSlug: 'image-preview-qa',
  displayName: 'Image Preview QA',
  createdAt: 0,
}
const backend = getDesktopBackend()
const { createChatImagePreviewCache } = await import('../src/services/chat-image-preview-cache')
const { default: sharp } = await import('sharp')
const bytes = await sharp({
  create: { width: 480, height: 270, channels: 3, background: '#2aab95' },
})
  .png()
  .toBuffer()
const tallBytes = await sharp({
  create: { width: 270, height: 480, channels: 3, background: '#2aab95' },
})
  .png()
  .toBuffer()
const artworkUrl = 'https://i.scdn.co/image/now-playing-qa'
const { getDbPath } = await import('../src/runtime-config')
const imageCache = join(dirname(getDbPath()), 'image-cache')
await mkdir(imageCache, { recursive: true })
const artworkHash = createHash('sha256').update(artworkUrl).digest('hex').slice(0, 32)
await Bun.write(join(imageCache, `${artworkHash}.png`), bytes)
let track: TwirNowPlaying = { title: 'Track without artwork', artist: 'Twir QA' }
const previewRequests: string[] = []
backend.api.getChatImagePreview = createChatImagePreviewCache({
  load: async (url) => {
    previewRequests.push(url)
    if (url === 'https://example.com/tall') return tallBytes
    return url === 'https://example.com/short' || url === artworkUrl ? bytes : undefined
  },
})
backend.api.getTwirNowPlaying = async () => track
backend.api.getChannelEmotes = async () => []
backend.api.getModerationCapabilities = async () => ({ canModerate: false })
accountState.accountsStore.set([
  {
    id: 'qa-account',
    platform: 'twitch',
    platformUserId: 'owner',
    username: 'owner',
    displayName: 'Owner',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
])
app.watchedChannelsStore.set([channel])
app.watchedStatusesStore.set(
  new Map([[channel.id, { platform: 'twitch', status: 'connected', mode: 'authenticated' }]]),
)
chatPauseStore.update({ value: { hoverSeconds: 0, modifier: 'none', doubleClickLinks: false } })
app.settingsStore.set({ ...DEFAULT_SETTINGS, chatTheme: 'modern', showAvatars: false })
const stopMessages = app.wireBackendToStores(backend)
const stopHotkeys = registerHotkeyActions({ openAddChannel() {}, openTabSelector() {} })
let renderer: ReturnType<typeof useGpuixRequired> | undefined

function Content() {
  const active = useGpuixRequired()
  React.useEffect(() => {
    renderer = active
  }, [active])
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ChatView paneId="image-preview-qa" watchedChannel={channel} />
    </div>
  )
}
let viewer: typeof renderer
function Viewer({ src }: { src: string }) {
  const active = useGpuixRequired()
  React.useEffect(() => {
    viewer = active
  }, [active])
  return <ChatImageWindow src={src} />
}
const manager = new DesktopWindowManager(
  backend,
  (descriptor) => (descriptor.kind === 'image' ? <Viewer src={descriptor.src} /> : <Content />),
  () => {},
)

function current() {
  assert(renderer)
  return renderer
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function nodes(): AutomationNode[] {
  return flatten(nodeSchema.parse(JSON.parse(current().getAutomationTree())))
}
const find = (testId: string) => nodes().find((node) => node.testId === testId)
const painted = (text: string) =>
  current()
    .getPaintedText()
    .some((run) => run.includes(text))

async function until(check: () => unknown, label: string): Promise<void> {
  const end = performance.now() + 5000
  while (performance.now() < end) {
    if (check()) return
    // eslint-disable-next-line no-await-in-loop -- Allow native frames to repaint.
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}

function input(...args: string[]): void {
  const result = Bun.spawnSync(['/usr/bin/xdotool', ...args], { env: process.env, timeout: 5000 })
  assert.equal(result.exitCode, 0, result.stderr.toString())
}
function bounds(testId: string) {
  const node = find(testId)
  assert(node, testId)
  const result = current().getElementBounds(node.id)
  assert(result, testId)
  return result
}
function click(testId: string, button = 1, repeat = 1): void {
  const target = bounds(testId)
  const window = getNativeQaWindowGeometry('TwirChat')
  input(
    'mousemove',
    '--sync',
    String(Math.round(window.x + target.x + target.width / 2)),
    String(Math.round(window.y + target.y + target.height / 2)),
    'click',
    '--repeat',
    String(repeat),
    String(button),
  )
}
let timestamp = Date.now()
function incoming(id: string, text: string) {
  const message: NormalizedChatMessage = {
    id,
    text,
    platform: 'twitch',
    channelId: channel.channelSlug,
    type: 'message',
    timestamp: new Date(timestamp++),
    author: { id: 'viewer', username: 'viewer', displayName: 'Viewer', badges: [] },
    emotes: [],
  }
  backend.events.emit('watched_channel_message', { channelId: channel.id, message })
  return message
}

async function verifyViewer(screenshotName: string) {
  await until(
    () =>
      viewer &&
      nativeWindow(viewer).isWindowOpen() &&
      viewer.getAutomationTree().includes('chat-image-viewer'),
    'native floating image viewer',
  )
  await focusNativeQaWindow('TwirChat — Image preview')
  await Bun.sleep(250)
  const screenshot = await captureGuiQaDisplay(screenshotName)
  const { x, y, width, height } = getNativeQaWindowGeometry('TwirChat — Image preview')
  const center = await sharp(screenshot)
    .extract({
      left: Math.round(x + width / 2),
      top: Math.round(y + height / 2),
      width: 1,
      height: 1,
    })
    .raw()
    .toBuffer()
  assert((center[1] ?? 0) > 130 && (center[0] ?? 255) < 75, 'viewer paints the test image')
  input('key', 'Escape')
  await until(() => viewer && !nativeWindow(viewer).isWindowOpen(), 'close image window')
}

try {
  await manager.start()
  await until(() => renderer && find('chat-input'), 'normal chat pane')
  await focusNativeQaWindow('TwirChat')
  incoming('disabled', 'https://example.com/disabled')
  await until(() => painted('https://example.com/disabled'), 'original link with previews off')
  assert.equal(previewRequests.length, 0)

  const artworkId = 'chat-twir-now-playing-artwork'
  const nowPlayingSettings = { ...DEFAULT_SETTINGS, showAvatars: false }
  app.settingsStore.set({ ...nowPlayingSettings, twirNowPlayingEnabled: true })
  await until(() => painted('Track without artwork'), 'track without artwork')
  click(artworkId)
  app.settingsStore.set({ ...nowPlayingSettings, twirNowPlayingEnabled: false })
  await until(() => !find(artworkId), 'now playing banner unmounted')
  assert.equal(previewRequests.length, 0)
  assert.equal(viewer, undefined)

  track = { title: 'Track with artwork', artist: 'Twir QA', imageUrl: artworkUrl }
  app.settingsStore.set({ ...nowPlayingSettings, twirNowPlayingEnabled: true })
  await until(() => painted('Track with artwork'), 'track with artwork')
  click('chat-twir-now-playing')
  click(artworkId, 3)
  await captureGuiQaDisplay('twir-now-playing-banner')
  assert.equal(previewRequests.length, 0)
  click(artworkId)
  await until(() => previewRequests.includes(artworkUrl), 'request track artwork preview')
  await verifyViewer('twir-now-playing-artwork')
  assert.deepEqual(previewRequests, [artworkUrl])

  await nativeWindow(current()).setWindowBounds({ width: 320, height: 300 })
  await focusNativeQaWindow('TwirChat')
  for (let index = 0; index < 60; index++) incoming(`artwork-traffic-${index}`, `ARTWORK_${index}`)
  await until(() => painted('ARTWORK_59'), 'live chat in small viewport')
  const artwork = find(artworkId)
  assert(artwork)
  current().focusElement(artwork.id)
  await until(() => current().getFocusedElementId() === artwork.id, 'focus track artwork')
  input('key', 'space')
  await verifyViewer('twir-now-playing-artwork-keyboard')

  await nativeWindow(current()).setWindowBounds({ width: 900, height: 600 })
  await focusNativeQaWindow('TwirChat')
  const enablePreviews = (chatTheme: 'modern' | 'compact') =>
    app.settingsStore.set({
      ...DEFAULT_SETTINGS,
      chatTheme,
      showAvatars: false,
      showChatImagePreviews: true,
    })
  enablePreviews('modern')
  incoming('modern', 'https://example.com/short https://example.com/short')
  incoming('page', 'https://example.com/page')
  await until(
    () =>
      find('chat-image-thumbnail-modern') && previewRequests.includes('https://example.com/page'),
    'only image links produce thumbnails',
  )
  assert(!find('chat-image-thumbnail-page'))
  assert.equal(previewRequests.filter((url) => url.endsWith('/short')).length, 1)
  assert.equal(nodes().filter(({ testId }) => testId === 'chat-image-thumbnail-modern').length, 1)
  await captureGuiQaDisplay('chat-image-preview-modern')
  click('chat-image-thumbnail-modern')
  await verifyViewer('chat-image-preview-window')

  enablePreviews('compact')
  await nativeWindow(current()).setWindowBounds({ width: 320, height: 300 })
  await focusNativeQaWindow('TwirChat')
  for (let index = 0; index < 60; index++) incoming(`traffic-${index}`, `LIVE_${index}`)
  incoming('compact', 'https://example.com/short')
  await until(() => find('chat-image-thumbnail-compact'), 'compact thumbnail in live chat')
  const thumbnail = bounds('chat-image-thumbnail-compact')
  const chat = bounds('chat-messages')
  assert(thumbnail.width <= chat.width && thumbnail.x + thumbnail.width <= chat.x + chat.width)
  assert.equal(thumbnail.width, 244, 'preview uses the fixed slot width')
  assert.equal(thumbnail.height, 164, 'preview uses the fixed slot height')
  await captureGuiQaDisplay('chat-image-preview-compact')

  incoming('tall', 'https://example.com/tall')
  await until(() => find('chat-image-thumbnail-tall'), 'tall thumbnail in live chat')
  const tallThumbnail = bounds('chat-image-thumbnail-tall')
  assert.equal(tallThumbnail.width, thumbnail.width, 'tall preview keeps the slot width')
  assert.equal(tallThumbnail.height, thumbnail.height, 'tall preview keeps the slot height')

  const trigger = find('chat-image-thumbnail-tall')
  assert(trigger)
  current().focusElement(trigger.id)
  await until(() => current().getFocusedElementId() === trigger.id, 'focus preview thumbnail')
  input('key', 'Return')
  await until(() => viewer && nativeWindow(viewer).isWindowOpen(), 'open image with keyboard')
  console.log('Native chat image preview QA passed.')
} finally {
  stopHotkeys()
  stopMessages()
  await manager.quit()
  backend.dispose?.()
}
process.exit(0)
