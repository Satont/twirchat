import assert from 'node:assert/strict'

import type { Account, WatchedChannel } from '@twirchat/shared/types'
import { z } from 'zod'

import type { NativeWindowControls } from '../src/gpuix/native-window'
import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { focusNativeQaWindow, getNativeQaWindowGeometry } from './qa-x11'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const { GpuixRenderer } = await import('@gpuix/native')
const { useEffect } = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { App } = await import('../src/gpuix/components/App')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { WatchedChannelStore } = await import('../src/store/watched-channels-store')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { chatTabsStore, closeChatTab, restoreClosedChatTab } =
  await import('../src/gpuix/state/chat-tabs')
const { wireActiveWatchedChannels } = await import('../src/gpuix/state/watched-subscriptions')
const { wireTabUnread } = await import('../src/gpuix/state/tab-unread')
const { composerStore } = await import('../src/gpuix/state/composer')
const app = await import('../src/gpuix/state/app')

interface AutomationNode {
  id: number
  testId?: string
  children: AutomationNode[]
}

const nodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    children: z.array(nodeSchema).default([]),
  }),
)

const backend = getDesktopBackend()
const twitch = WatchedChannelStore.upsert('twitch', 'pixelgarden', 'PixelGarden')
const kick = WatchedChannelStore.upsert('kick', 'cooplounge', 'CoopLounge')
const other = WatchedChannelStore.upsert('twitch', 'nightarcade', 'NightArcade')
const accounts = (['twitch', 'kick'] satisfies Account['platform'][]).map((platform): Account => ({
  id: `qa-${platform}`,
  platform,
  username: 'studio',
  displayName: 'Studio',
  platformUserId: `studio-${platform}`,
  scopes: [],
  createdAt: 0,
  updatedAt: 0,
}))
const sent: Parameters<typeof backend.api.sendWatchedChannelMessage>[0][] = []
let activeIds: readonly string[] = []
backend.api.setActiveWatchedChannels = async ({ ids }) => {
  activeIds = ids
  for (const channel of [twitch, kick, other]) {
    if (!ids.includes(channel.id)) continue
    backend.events.emit('watched_channel_status', {
      channelId: channel.id,
      status: {
        platform: channel.platform,
        status: 'connected',
        mode: 'authenticated',
        channelLogin: channel.channelSlug,
        channelId: channel.platform === 'kick' ? '123456' : channel.channelSlug,
      },
    })
  }
}
backend.api.getAccounts = async () => accounts
backend.api.getSavedAccounts = async () => accounts
backend.api.getChannelEmotes = async () => []
backend.api.getModerationCapabilities = async () => ({ canModerate: false })
backend.api.sendWatchedChannelMessage = async (payload) => {
  sent.push(payload)
}

let renderer: (InstanceType<typeof GpuixRenderer> & NativeWindowControls) | undefined
function Content() {
  const active = useGpuixRequired()
  useEffect(() => {
    assert(active instanceof GpuixRenderer)
    renderer = nativeWindow(active)
  }, [active])
  return <App />
}
const manager = new DesktopWindowManager(
  backend,
  () => <Content />,
  () => {},
)
const stopMessages = app.wireBackendToStores(backend)
const stopSubscriptions = wireActiveWatchedChannels(backend)
const stopUnread = wireTabUnread(backend)

function current() {
  assert(renderer)
  return renderer
}
function nodes(
  node = nodeSchema.parse(JSON.parse(current().getAutomationTree())),
): AutomationNode[] {
  return [node, ...node.children.flatMap((child) => nodes(child))]
}
function find(testId: string): AutomationNode | undefined {
  return nodes().find((node) => node.testId === testId)
}
function painted(text: string): boolean {
  return current().getPaintedText().join(' ').replaceAll(/\s+/gu, ' ').includes(text)
}
async function until(check: () => unknown, label: string): Promise<void> {
  const end = performance.now() + 5000
  while (performance.now() < end) {
    if (check()) return
    // eslint-disable-next-line no-await-in-loop -- Allow native frames to repaint.
    await Bun.sleep(25)
  }
  throw new Error(`Timed out: ${label}`)
}
function input(...args: string[]) {
  const result = Bun.spawnSync(['/usr/bin/xdotool', ...args], { env: process.env, timeout: 3000 })
  assert.equal(result.exitCode, 0, result.stderr.toString())
}
function pointAt(node: AutomationNode, press: boolean): void {
  const bounds = current().getPaintedElementBounds(node.id)
  assert(bounds, `Missing painted bounds for ${node.testId ?? node.id}`)
  const window = getNativeQaWindowGeometry('TwirChat')
  input(
    'mousemove',
    '--sync',
    String(Math.round(window.x + bounds.x + bounds.width / 2)),
    String(Math.round(window.y + bounds.y + bounds.height / 2)),
    ...(press ? ['click', '1'] : []),
  )
}
function click(testId: string): void {
  const node = find(testId)
  assert(node, testId)
  pointAt(node, true)
}

let timestamp = Date.now() - 70_000
function incoming(channel: WatchedChannel, id: string, text: string, name: string, color: string) {
  timestamp += 4000
  backend.events.emit('watched_channel_message', {
    channelId: channel.id,
    message: {
      id,
      text,
      platform: channel.platform,
      channelId: channel.platform === 'kick' ? '123456' : channel.channelSlug,
      type: 'message',
      timestamp: new Date(timestamp),
      author: { id: name, username: name, displayName: name, color, badges: [] },
      emotes: [],
    },
  })
}

try {
  await backend.api.setTabChannelIds({ ids: [] })
  await app.loadInitialData(backend)
  await manager.start()
  await until(() => renderer && chatTabsStore.get().loaded && find('tab-add'), 'tab bar')
  await focusNativeQaWindow('TwirChat')
  await nativeWindow(current()).setWindowBounds({ x: 0, y: 0, width: 900, height: 570 })
  await until(() => getNativeQaWindowGeometry('TwirChat').width === 900, 'normal window size')
  click('tab-add')
  await until(() => find('add-channel-create-feed'), 'create feed from plus menu')
  click('add-channel-create-feed')
  await until(() => find(`feed-source-${twitch.id}`), 'saved channels in feed editor')
  click(`feed-source-${twitch.id}`)
  await until(() => painted('1 selected'), 'first source selected')
  click(`feed-source-${kick.id}`)
  await until(() => painted('2 selected'), 'second source selected')
  input('mousemove', '750', '20')
  await Bun.sleep(160)
  await captureGuiQaDisplay('combined-feed-setup')
  click('feed-save')
  await until(
    () => find('chat-feed-manage') && activeIds.includes(twitch.id) && activeIds.includes(kick.id),
    'both providers are subscribed',
  )
  const tabId = app.activeWatchedTabStore.get()
  const saved = (await backend.api.getWatchedChannelsLayout({ tabId }))?.root
  assert(saved?.type === 'panel' && saved.content.type === 'feed')
  assert.deepEqual(
    saved.content.sources.map((source) => source.channelId),
    [twitch.id, kick.id],
  )
  const composerKey = `${tabId}:${saved.id}:feed`
  const draft = () => composerStore.get().get(composerKey)?.text
  const send = async (text: string, count: number) => {
    input('type', '--delay', '20', text)
    await until(() => draft() === text && painted(text), `draft ${text} paints`)
    await Bun.sleep(50)
    input('key', 'Return')
    await until(() => sent.length === count && draft() === '', `sends and clears ${text}`)
    assert.equal(sent[count - 1]?.text, text)
  }

  const messages: [WatchedChannel, string, string, string][] = [
    [twitch, 'mira', 'Welcome in! We’re running the co-op route tonight.', '#dca4eb'],
    [kick, 'reed', 'Kick chat checking in. Audio sounds great.', '#83bfef'],
    [twitch, 'juniper', 'I have the route notes ready.', '#f2b880'],
    [kick, 'sage', 'Did you keep the shortcut by the waterfall?', '#a4d79b'],
    [twitch, 'mira', 'Yep. We’ll try it on the second lap.', '#dca4eb'],
    [twitch, 'juniper', 'Timer is ready whenever you are.', '#f2b880'],
    [kick, 'reed', 'First lap from the bridge, right?', '#83bfef'],
    [twitch, 'moss', 'Yep! I marked it on the map.', '#b1d7a2'],
    [kick, 'sage', 'That saves so much time.', '#a4d79b'],
    [twitch, 'mira', 'All set. Starting in ten seconds.', '#dca4eb'],
    [kick, 'reed', 'Good luck, both chats!', '#83bfef'],
    [twitch, 'juniper', 'Let’s go!', '#f2b880'],
  ]
  messages.forEach(([channel, name, text, color], index) =>
    incoming(channel, `sample-${index}`, text, name, color),
  )
  incoming(other, 'outside-feed', 'OUTSIDE THE FEED', 'viewer', '#a4d79b')
  await until(
    () => painted('Good luck, both chats!') && painted('Let’s go!'),
    'interleaved Twitch and Kick messages paint',
  )
  assert(!painted('OUTSIDE THE FEED'))
  const earlier = find('chat-feed-source-sample-10')
  const later = find('chat-feed-source-sample-11')
  assert(earlier && later)
  const native = nativeWindow(current())
  const firstBounds = native.getPaintedElementBounds(earlier.id)
  const secondBounds = native.getPaintedElementBounds(later.id)
  assert(firstBounds && secondBounds && firstBounds.y < secondBounds.y, 'chronological order')
  click('chat-feed-send-target')
  await until(() => find(`chat-feed-target-${kick.id}`), 'Kick send destination')
  click(`chat-feed-target-${kick.id}`)
  await until(() => find('chat-input'), 'composer for the selected source')
  input('mousemove', '750', '20')
  await Bun.sleep(160)
  await captureGuiQaDisplay('combined-feed-chat')
  click('chat-input')
  await send('Hello Kick', 1)
  assert.equal(sent[0]?.id, kick.id)
  assert.equal(sent[0]?.accountId, 'qa-kick')

  pointAt(later, false)
  const replyOnLastRow = () => {
    const source = find('chat-feed-source-sample-11')
    const row = source && native.getPaintedElementBounds(source.id)
    if (!row) return undefined
    return nodes().find((node) => {
      if (node.testId !== 'msg-reply') return false
      const bounds = native.getPaintedElementBounds(node.id)
      const center = bounds && bounds.y + bounds.height / 2
      return center !== null && center >= row.y && center <= row.y + row.height
    })
  }
  await until(replyOnLastRow, 'reply action on Twitch message')
  const reply = replyOnLastRow()
  assert(reply)
  pointAt(reply, true)
  await until(() => find('cancel-reply'), 'reply opens from original channel')
  await send('Good luck!', 2)
  assert.equal(sent[1]?.id, twitch.id)
  assert.equal(sent[1]?.replyTo, 'sample-11')

  await native.setWindowBounds({ width: 540, height: 420 })
  await until(() => getNativeQaWindowGeometry('TwirChat').width === 540, 'compact window size')
  for (let index = 1; index <= 16; index++)
    WatchedChannelStore.upsert('twitch', `qa-channel-${index}`, `QA channel ${index}`)
  app.watchedChannelsStore.set(await backend.api.getWatchedChannels())
  click('chat-feed-manage')
  await until(() => find('feed-source-search'), 'compact feed editor with a long source list')
  const save = find('feed-save')
  const saveBounds = save && native.getPaintedElementBounds(save.id)
  assert(saveBounds && saveBounds.y + saveBounds.height <= 420, 'save stays visible')
  click('feed-source-search')
  input('type', 'NightArcade')
  await until(() => find(`feed-source-${other.id}`), 'search across saved sources')
  const source = find(`feed-source-${other.id}`)
  assert(source)
  current().focusElement?.(source.id)
  await Bun.sleep(100)
  input('key', 'Return')
  await until(() => painted('3 selected'), 'keyboard adds a source to the draft')
  incoming(kick, 'live-while-editing', 'STILL LIVE DURING EDIT', 'reed', '#83bfef')
  input('key', 'Escape')
  await until(
    () => !find('feed-editor') && painted('STILL LIVE DURING EDIT'),
    'Escape cancels edits',
  )
  assert(!activeIds.includes(other.id))

  click('chat-feed-manage')
  await until(() => find('feed-source-search'), 'editor reopens')
  click('feed-source-search')
  input('type', 'NightArcade')
  await until(() => find(`feed-source-${other.id}`), 'third source filtered into view')
  click(`feed-source-${other.id}`)
  await until(() => painted('3 selected'), 'third source selected')
  click('feed-save')
  await until(
    () => !find('feed-editor') && activeIds.includes(other.id),
    'adding a second Twitch source updates the live feed',
  )
  click('chat-feed-send-target')
  await until(() => find(`chat-feed-target-${other.id}`), 'second Twitch destination')
  click(`chat-feed-target-${other.id}`)
  await until(() => find('chat-input'), 'composer for second Twitch channel')
  click('chat-input')
  await send('Hello NightArcade', 3)
  assert.equal(sent[2]?.id, other.id)
  assert.equal(sent[2]?.accountId, 'qa-twitch')

  await closeChatTab(backend, tabId)
  await until(() => activeIds.length === 0, 'closed feed releases its subscriptions')
  await restoreClosedChatTab(backend, tabId)
  await until(
    () => find('chat-feed-manage') && activeIds.length === 3,
    'restoring the feed restores all its sources',
  )

  await native.setWindowBounds({ width: 900, height: 570 })
  await until(() => getNativeQaWindowGeometry('TwirChat').width === 900, 'restore normal size')
  click('tab-add')
  await until(() => find('add-channel-input'), 'single channel chooser')
  click('add-channel-input')
  input('type', '--delay', '20', 'pixelgarden')
  await until(() => painted('pixelgarden'), 'watched channel login entered')
  await Bun.sleep(100)
  click('add-channel-confirm')
  await until(
    () => app.activeWatchedTabStore.get() === twitch.id && find('panel-menu'),
    'watched tab',
  )
  click('panel-menu')
  await until(() => find('chat-edit-feed'), 'combine action in watched pane menu')
  click('chat-edit-feed')
  await until(() => find('feed-add-source') && painted('1 selected'), 'keeps the original source')
  click('feed-add-source')
  await until(() => find('add-platform-youtube'), 'new source platform picker')
  click('add-platform-youtube')
  await until(() => painted('@handle'), 'YouTube channel field')
  click('add-channel-input')
  input('type', '--delay', '20', '@studioarchive')
  await until(() => painted('@studioarchive'), 'new channel handle entered')
  await Bun.sleep(100)
  click('add-channel-confirm')
  await until(() => painted('2 selected'), 'new YouTube source staged')
  assert.equal(WatchedChannelStore.findByPlatformAndSlug('youtube', '@studioarchive'), null)
  click('feed-save')
  await until(() => find('chat-feed-manage') && !find('feed-editor'), 'watched pane becomes a feed')
  const youtube = WatchedChannelStore.findByPlatformAndSlug('youtube', '@studioarchive')
  assert(youtube)
  await until(() => activeIds.includes(youtube.id), 'new source subscribes after saving')
  console.log('Custom feed native QA passed.')
} catch (error) {
  await captureGuiQaDisplay('combined-feed-failure').catch(() => {})
  throw error
} finally {
  stopUnread()
  stopSubscriptions()
  stopMessages()
  await manager.quit()
  backend.dispose?.()
}
process.exit(0)
