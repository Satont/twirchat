import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type {
  TwitchActivitiesSnapshot,
  TwitchActivityAction,
  TwitchReward,
} from '@twirchat/shared/twitch-activities'
import type {
  Account,
  NormalizedChatMessage,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import { z } from 'zod'

import { focusNativeQaWindow, getNativeQaWindowGeometry } from '../scripts/qa-x11'
import type { DesktopBackend } from '../src/gpuix/backend/server'
import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { captureGuiQaDisplay } from '../src/services/gui-qa-screenshot'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { useGpuixRequired } = await import('@gpuix/react')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { BackendConnection } = await import('../src/backend-connection')
const { ChatAggregator } = await import('../src/chat/aggregator')
const { createDesktopApi } = await import('../src/gpuix/backend/api')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { registerHotkeyActions } = await import('../src/gpuix/state/hotkeys')
const { nativeWindow } = await import('../src/gpuix/native-window')
const app = await import('../src/gpuix/state/app')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
const { wireTwitchActivities } = await import('../src/gpuix/state/twitch-activities')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { initDb } = await import('../src/store/db')
const { WatchedChannelManager } = await import('../src/watched-channels/manager')
const sharp = (await import('sharp')).default

const session = z.string().min(1).parse(process.env.TWIRCHAT_QA_SESSION_DIR)
const db = initDb()
const title = 'TwirChat'
const channel: WatchedChannel = {
  id: 'qa-twitch-channel',
  platform: 'twitch',
  channelSlug: 'northstararcade',
  displayName: 'NorthstarArcade',
  createdAt: 0,
}
const kick: WatchedChannel = { ...channel, id: 'qa-kick-channel', platform: 'kick' }
const primary: Account = {
  id: 'primary',
  platform: 'twitch',
  platformUserId: '3001',
  username: 'orbitlane',
  displayName: 'OrbitLane',
  scopes: [],
  createdAt: 0,
  updatedAt: 0,
}
const alternate: Account = {
  ...primary,
  id: 'alternate',
  platformUserId: '3002',
  username: 'orbitlane_alt',
  displayName: 'OrbitLaneAlt',
}
const rewards: TwitchReward[] = [
  {
    id: 'hydrate',
    title: 'Hydrate',
    cost: 100,
    prompt: 'A water break for the streamer.',
    backgroundColor: '#37A6B7',
    isEnabled: true,
    isPaused: false,
  },
  {
    id: 'track',
    title: 'Request a song',
    cost: 300,
    prompt: 'Enter the artist and track you want to hear.',
    backgroundColor: '#A66CFF',
    isEnabled: true,
    isPaused: false,
    isInputRequired: true,
  },
  {
    id: 'stretch',
    title: 'Stretch break',
    cost: 500,
    backgroundColor: '#278B72',
    isEnabled: true,
    isPaused: false,
  },
  {
    id: 'timer',
    title: 'Add five minutes',
    cost: 750,
    backgroundColor: '#D58F39',
    isEnabled: true,
    isPaused: false,
  },
  {
    id: 'npc',
    title: 'Name the next NPC',
    cost: 1200,
    backgroundColor: '#4876D2',
    isEnabled: true,
    isPaused: true,
  },
  {
    id: 'game',
    title: 'Pick the next game',
    cost: 5000,
    backgroundColor: '#BF4C78',
    isEnabled: true,
    isPaused: false,
  },
]
let snapshot: TwitchActivitiesSnapshot = {
  channelId: '32456',
  channelSlug: channel.channelSlug,
  polls: [],
  predictions: [],
  pinnedMessage: null,
  rewards,
  pointsBalance: 1900,
  errors: {},
}
interface Redemption {
  action: TwitchActivityAction
  accountId: string | undefined
}
const redemptions: Redemption[] = []
const approval = Promise.withResolvers<void>()
let rejectRedemption = false
const events = createDesktopEvents()
const backend: DesktopBackend = {
  events,
  api: {
    ...createDesktopApi({
      events,
      aggregator: new ChatAggregator(),
      backendConn: new BackendConnection('isolated-channel-points'),
      watchedChannelManager: new WatchedChannelManager(),
      currentStatuses: new Map(),
      openBrowser() {
        throw new Error('Channel Points QA must not open external applications.')
      },
    }),
    async getChannelRoomState({ platform }) {
      return { platform, channelId: snapshot.channelId }
    },
    async getChannelEmotes() {
      return []
    },
    async getTwitchActivities({ channelSlug }) {
      assert.equal(channelSlug, channel.channelSlug)
      return structuredClone(snapshot)
    },
    async watchTwitchActivities() {},
    async executeTwitchActivityAction(action, accountId) {
      assert.equal(action.action, 'redeem_reward')
      redemptions.push({ action, accountId })
      if (rejectRedemption) throw new Error('This reward is temporarily unavailable.')
      await approval.promise
      snapshot = { ...snapshot, pointsBalance: (snapshot.pointsBalance ?? 0) - action.cost }
      return {}
    },
  },
}
app.settingsStore.set({
  ...DEFAULT_SETTINGS,
  theme: 'dark',
  showAvatars: false,
  showTimestamp: true,
})
app.accountsStore.set([
  primary,
  { ...primary, id: 'kick', platform: 'kick', platformUserId: '4001' },
])
app.savedAccountsStore.set([primary, alternate])
app.watchedChannelsStore.set([channel, kick])
app.watchedStatusesStore.set(
  new Map(
    [channel, kick].map((item): [string, PlatformStatusInfo] => [
      item.id,
      {
        platform: item.platform,
        status: 'connected',
        mode: 'authenticated',
        channelLogin: item.channelSlug,
        channelId: snapshot.channelId,
      },
    ]),
  ),
)
app.streamStatusStore.set(
  new Map([
    [
      `twitch:${channel.channelSlug}`,
      {
        platform: 'twitch',
        channelLogin: channel.channelSlug,
        isLive: true,
        title: 'Late-night arcade',
        categoryName: 'Stardew Valley',
        viewerCount: 142,
      },
    ],
  ]),
)
const stopActivity = wireTwitchActivities(backend)
const stopMessages = app.wireBackendToStores(backend)
const stopHotkeys = registerHotkeyActions({
  openAddChannel() {},
  openTabSelector() {},
})
const chat: Array<[name: string, color: string, text: string]> = [
  ['SunlitMoss', '#84CD82', 'There is a ladder behind the last crate.'],
  ['CedarFox', '#F7AB7C', 'good catch, I missed that too'],
  ['ViolaSkies', '#C0A1FF', 'first time here, love the night farm'],
  ['OrbitLane', '#7BC8F4', 'welcome in!'],
  ['JuniperJam', '#E9CB73', 'save a strawberry for the spring bundle'],
  ['CedarFox', '#F7AB7C', 'the farm looks so cozy after dark'],
  ['SunlitMoss', '#84CD82', 'We still need the cat a name.'],
  ['PixelLark', '#F99BBA', 'my vote is Croissant'],
  ['KiteString', '#7BD7CF', 'can we try the mine after this?'],
  ['JuniperJam', '#E9CB73', 'the forest theme is my favorite'],
  ['ViolaSkies', '#C0A1FF', 'yes! this soundtrack gets me every time'],
  ['PixelLark', '#F99BBA', 'someone request the rainy day song'],
  ['CedarFox', '#F7AB7C', 'I have just enough points for that'],
  ['SunlitMoss', '#84CD82', 'one more day before the festival!'],
]
function incoming(id: string, name: string, color: string, text: string, index = chat.length) {
  const message: NormalizedChatMessage = {
    id,
    channelId: snapshot.channelId,
    platform: 'twitch',
    author: { id: name.toLowerCase(), displayName: name, color, badges: [] },
    timestamp: new Date(Date.UTC(2026, 10, 15, 19, 30, index * 2)),
    type: 'message',
    text,
    emotes: [],
  }
  events.emit('watched_channel_message', { channelId: channel.id, message })
}
for (const [index, [name, color, text]] of chat.entries())
  incoming(`chat-${index}`, name, color, text, index)

const target = createStore<WatchedChannel>(channel)
let renderer: GpuixRenderer | undefined
function Content() {
  const active = useGpuixRequired()
  const selected = useStore(target)
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    renderer = active
  }, [active])
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
      },
    },
    React.createElement(ChatView, { watchedChannel: selected, paneId: 'qa-points' }),
  )
}
const manager = new DesktopWindowManager(
  backend,
  () => React.createElement(Content),
  () => {},
)

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
    children: z
      .array(nodeSchema)
      .nullish()
      .transform((children) => children ?? []),
  }),
)
function current(): GpuixRenderer {
  assert(renderer)
  return renderer
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function find(id: string): AutomationNode | undefined {
  return flatten(nodeSchema.parse(JSON.parse(current().getAutomationTree()))).find(
    (node) => node.testId === id,
  )
}
function bounds(id: string) {
  const node = find(id)
  assert(node, `Missing ${id}`)
  const box = nativeWindow(current()).getPaintedElementBounds(node.id)
  assert(box, `Unpainted ${id}`)
  return box
}
function painted(text: string): boolean {
  return current()
    .getPaintedText()
    .some((run) => run.includes(text))
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 5000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    // eslint-disable-next-line no-await-in-loop
    await Bun.sleep(20)
  }
}
function xdotool(...args: string[]): void {
  const result = Bun.spawnSync(['/usr/bin/xdotool', ...args], {
    env: process.env,
    timeout: 5000,
  })
  assert.equal(result.exitCode, 0, result.stderr.toString())
}
function move(x: number, y: number): void {
  const geometry = getNativeQaWindowGeometry(title)
  xdotool(
    'mousemove',
    '--sync',
    String(Math.round(geometry.x + x)),
    String(Math.round(geometry.y + y)),
  )
}
function click(id: string, repeat = 1): void {
  const box = bounds(id)
  move(box.x + box.width / 2, box.y + box.height / 2)
  xdotool('click', '--repeat', String(repeat), '1')
}
const button = 'channel-points-button'
const popup = 'channel-points-popup'
const input = 'channel-points-input'
const redeem = 'channel-points-redeem'
const track = 'channel-points-reward-track'

function fitsPopup(id: string): boolean {
  const node = find(id)
  const box = node && nativeWindow(current()).getPaintedElementBounds(node.id)
  if (!box) return false
  const panel = bounds(popup)
  const center = box.y + box.height / 2
  return center >= panel.y && center <= panel.y + panel.height
}

function checkLayout(): void {
  const geometry = getNativeQaWindowGeometry(title)
  const frame = bounds('composer-frame')
  const editor = bounds('chat-input')
  const balance = bounds(button)
  const send = bounds('send-button')
  assert(editor.width >= 48, 'Composer remains usable.')
  assert(editor.x + editor.width <= balance.x + 1, 'Points button leaves typing area clear.')
  assert(balance.x + balance.width <= send.x + 1, 'Points button leaves Send clear.')
  assert(send.x + send.width <= frame.x + frame.width + 1, 'Send stays inside the composer.')
  if (!find(popup)) return
  const panel = bounds(popup)
  assert(panel.x >= 0 && panel.x + panel.width <= geometry.width + 1, 'Popup fits horizontally.')
  assert(panel.y >= 0 && panel.y + panel.height <= balance.y + 1, 'Popup fits above the composer.')
}
async function capture(name: string): Promise<string> {
  const { x: left, y: top, width, height } = getNativeQaWindowGeometry(title)
  move(width + 10, height + 10)
  await Bun.sleep(150)
  const screen = await captureGuiQaDisplay(`${name}-display`)
  const path = join(session, `${name}.png`)
  await sharp(screen).extract({ left, top, width, height }).toFile(path)
  return path
}
function publish(patch: Partial<TwitchActivitiesSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  events.emit('twitch_activity_snapshot', { channelSlug: channel.channelSlug, snapshot })
}
async function openPicker(): Promise<void> {
  click(button)
  await until(() => Boolean(find(track)), 'reward catalog opens')
}
async function closePicker(): Promise<void> {
  xdotool('key', 'Escape')
  await until(() => !find(popup), 'Escape closes picker')
}

const screenshots: string[] = []
try {
  await manager.start()
  await until(() => Boolean(renderer && find(button)), 'points button loads')
  const window = nativeWindow(current())
  await window.setWindowBounds({ x: 20, y: 20, width: 580, height: 530 })
  await focusNativeQaWindow(title)
  await until(() => painted('SunlitMoss'), 'chat messages paint')
  checkLayout()
  screenshots.push(await capture('channel-points-balance'))
  await openPicker()
  checkLayout()
  assert(painted('1,900'), 'Picker shows the full balance.')
  screenshots.push(await capture('channel-points-picker'))
  incoming('live-message', 'OrbitLane', '#7BC8F4', 'The farm chat is moving.')
  await until(() => painted('moving.'), 'live chat updates while picker is open')

  click(track)
  await until(() => Boolean(find(input)), 'required reward text field opens')
  assert.equal(redemptions.length, 0, 'Opening reward details does not spend points.')
  click(redeem)
  await Bun.sleep(100)
  assert.equal(redemptions.length, 0, 'Missing required text prevents redemption.')
  click(input)
  xdotool('type', 'ConcernedApe - Spring')
  await until(() => painted('ConcernedApe - Spring'), 'reward request text paints')
  screenshots.push(await capture('channel-points-redeem'))
  click(redeem, 3)
  await until(() => redemptions.length > 0, 'confirm redeems reward')
  assert.equal(redemptions.length, 1, 'Rapid clicks cannot submit a pending redemption twice.')
  const request = redemptions[0]
  assert(request)
  assert.deepEqual(request, {
    accountId: primary.id,
    action: {
      action: 'redeem_reward',
      channelSlug: channel.channelSlug,
      rewardId: 'track',
      rewardTitle: 'Request a song',
      cost: 300,
      input: 'ConcernedApe - Spring',
      rewardPrompt: 'Enter the artist and track you want to hear.',
    },
  })
  approval.resolve()
  await until(
    () => Boolean(find('channel-points-feedback')) && painted('1,600'),
    'successful redemption shows refreshed balance',
  )

  rejectRedemption = true
  click('channel-points-reward-hydrate')
  await until(() => Boolean(find(redeem)), 'second reward confirmation opens')
  click(redeem)
  await until(() => Boolean(find('channel-points-error')), 'failed redemption shows an error')
  assert(painted('1,600'), 'A failed redemption does not change the balance.')
  await closePicker()
  await openPicker()
  assert(!find('channel-points-error'), 'Reopened catalog clears previous feedback.')
  move(20, 56)
  xdotool('click', '1')
  await until(() => !find(popup), 'outside click closes picker')

  await window.setWindowBounds({ x: 20, y: 20, width: 320, height: 240 })
  await Bun.sleep(150)
  await openPicker()
  checkLayout()
  screenshots.push(await capture('channel-points-compact'))
  click(track)
  await until(() => Boolean(find(input)), 'required input is available in compact window')
  if (!fitsPopup(input)) {
    const panel = bounds(popup)
    move(panel.x + panel.width / 2, panel.y + panel.height * 0.75)
    xdotool('click', '--repeat', '3', '5')
    await until(() => fitsPopup(input), 'compact reward input scrolls into view')
  }
  click(input)
  await until(() => {
    const node = find(input)
    return !!node && current().getFocusedElementId() === node.id
  }, 'native compact reward field gains focus')
  await closePicker()

  publish({ pointsBalance: 0 })
  await until(() => {
    const balanceNode = find(button)
    return !!balanceNode && flatten(balanceNode).some((node) => node.text === '0')
  }, 'zero balance stays visible')
  await Bun.sleep(100)
  await openPicker()
  await closePicker()
  publish({ rewards: [] })
  await until(() => !find(button), 'button hides when channel has no rewards')
  publish({ rewards })
  await until(() => Boolean(find(button)), 'button reappears with rewards')
  publish({ pointsBalance: undefined })
  await until(() => !find(button), 'button hides when points balance is unavailable')
  publish({ pointsBalance: 1900 })
  await until(() => Boolean(find(button)), 'button reappears when balance is known')

  target.set({ ...channel, accountId: alternate.id })
  await until(() => !find(button), 'button hides for the alternate account')
  target.set(channel)
  await until(() => Boolean(find(button)), 'button reappears for the primary account')
  target.set(kick)
  await until(() => !find(button), 'button hides on a non-Twitch channel')
  console.log(JSON.stringify({ screenshots, redemptions: redemptions.length }, null, 2))
} catch (error) {
  if (renderer) {
    console.error(current().getPaintedText())
    await captureGuiQaDisplay('channel-points-failure')
  }
  throw error
} finally {
  approval.resolve()
  stopHotkeys()
  stopMessages()
  stopActivity()
  await manager.quit()
  db.close()
}
