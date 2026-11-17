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
  AppSettings,
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
const { createDesktopApi, planTwitchActivitySnapshot, requestTwitchActivitiesSnapshot } =
  await import('../src/gpuix/backend/api')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { TwitchDeviceDialog } = await import('../src/gpuix/components/TwitchDeviceDialog')
const { TwitchSessionSettings } = await import('../src/gpuix/components/TwitchSessionSettings')
const { setLanguage } = await import('../src/gpuix/i18n')
const { registerHotkeyActions } = await import('../src/gpuix/state/hotkeys')
const { nativeWindow } = await import('../src/gpuix/native-window')
const app = await import('../src/gpuix/state/app')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
const { wireTwitchActivities } = await import('../src/gpuix/state/twitch-activities')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { TwitchActivityRefreshClient } = await import('../src/services/twitch-activity-refresh')
const { AccountStore } = await import('../src/store/account-store')
const { initDb } = await import('../src/store/db')
const { WatchedChannelManager } = await import('../src/watched-channels/manager')
const sharp = (await import('sharp')).default

const session = z.string().min(1).parse(process.env.TWIRCHAT_QA_SESSION_DIR)
const db = initDb()
const deviceAuth = process.argv.includes('--device-auth')
const rewardFeed = process.argv.includes('--reward-feed')
const title = 'TwirChat'
const channel: WatchedChannel = {
  id: 'qa-twitch-channel',
  platform: 'twitch',
  channelSlug: 'northstararcade',
  displayName: rewardFeed ? 'Northstar' : 'NorthstarArcade',
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
  rewards: rewardFeed ? [] : rewards,
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
const activationUrl = 'https://www.twitch.tv/activate'
const standardToken = 'qa-ordinary-login'
const pointsToken = 'qa-device-access'
const tvClient = 'ue6666qo983tsx6so1t0vnawi233wa'
const openedUrls: string[] = []
const originalFetch = globalThis.fetch
let deviceRequests = 0
let tokenPolls = 0
let clipboardReads = 0
let confirmDevice = false
let authenticatedSnapshots = 0

async function mockTwitch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  const auth = request.headers.get('Authorization')
  if (url.hostname === 'id.twitch.tv') {
    if (url.pathname === '/oauth2/device') {
      const body = new URLSearchParams(await request.text())
      assert.equal(body.get('client_id'), tvClient)
      deviceRequests++
      return Response.json({
        device_code: `test-device-${deviceRequests}`,
        user_code: `ABCD000${deviceRequests}`,
        verification_uri: activationUrl,
        expires_in: 60,
        interval: 1,
      })
    }
    if (url.pathname === '/oauth2/token') {
      const body = new URLSearchParams(await request.text())
      assert.equal(body.get('client_id'), tvClient)
      assert.equal(body.get('device_code'), `test-device-${deviceRequests}`)
      assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code')
      tokenPolls++
      return confirmDevice
        ? Response.json({
            access_token: pointsToken,
            refresh_token: 'qa-device-refresh',
            expires_in: 14400,
          })
        : Response.json({ message: 'authorization_pending' }, { status: 400 })
    }
    if (url.pathname === '/oauth2/validate') {
      assert(auth === `OAuth ${pointsToken}` || auth === `OAuth ${standardToken}`)
      return Response.json({
        client_id: auth === `OAuth ${pointsToken}` ? tvClient : 'qa-ordinary-client',
        user_id: primary.platformUserId,
        login: primary.username,
        scopes: [],
        expires_in: 14400,
      })
    }
  }
  if (url.hostname === 'api.twitch.tv' && url.pathname === '/helix/users') {
    assert.equal(auth, `Bearer ${standardToken}`)
    return Response.json({ data: [{ id: snapshot.channelId }] })
  }
  if (url.href === 'https://gql.twitch.tv/gql') {
    const operations = z.array(z.object({ operationName: z.string() })).parse(await request.json())
    if (operations[0]?.operationName === 'ChannelPointsContext') {
      assert(confirmDevice, 'Balance request follows approval.')
      assert.equal(auth, `OAuth ${pointsToken}`)
      authenticatedSnapshots++
      return Response.json([
        {
          data: {
            community: {
              channel: {
                self: { communityPoints: { balance: snapshot.pointsBalance } },
                communityPointsSettings: { customRewards: rewards },
              },
            },
          },
        },
      ])
    }
    if (operations[0]?.operationName === 'GetPinnedChat') {
      assert.equal(auth, null, 'Points credentials stay out of unrelated requests.')
      return Response.json([{ data: { channel: {} } }])
    }
  }
  return Response.json({ message: 'Unavailable in isolated QA' }, { status: 404 })
}

if (deviceAuth) {
  AccountStore.upsert({ ...primary, accessToken: standardToken })
  AccountStore.setActive('twitch', primary.id)
  globalThis.fetch = Object.assign(mockTwitch, { preconnect: originalFetch.preconnect })
}
const activityRefresh = deviceAuth
  ? new TwitchActivityRefreshClient({
      plan: (slug) => planTwitchActivitySnapshot(slug, false),
      snapshot: (channelSlug, sections) =>
        requestTwitchActivitiesSnapshot({ channelSlug, sections }),
      publish: (update) => events.emit('twitch_activity_snapshot', update),
      capability: (capability) => events.emit('twitch_activity_capability', capability),
    })
  : undefined
const api = createDesktopApi({
  events,
  aggregator: new ChatAggregator(),
  backendConn: new BackendConnection('isolated-channel-points'),
  watchedChannelManager: new WatchedChannelManager(),
  currentStatuses: new Map(),
  twitchActivityRefresh: activityRefresh,
  openBrowser(url) {
    assert(deviceAuth && url === activationUrl, 'Only the simulated Twitch activation page opens.')
    openedUrls.push(url)
  },
})
const backend: DesktopBackend = {
  events,
  api: {
    ...api,
    async getChannelRoomState({ platform }) {
      return { platform, channelId: snapshot.channelId }
    },
    async getChannelEmotes() {
      return []
    },
    getTwitchActivities: deviceAuth
      ? (params) => api.getTwitchActivities(params)
      : async ({ channelSlug }) => {
          assert.equal(channelSlug, channel.channelSlug)
          return structuredClone(snapshot)
        },
    async watchTwitchActivities({ channelSlug, watch }) {
      await activityRefresh?.watch(channelSlug, watch)
    },
    async readClipboard() {
      clipboardReads++
      throw new Error('The device authorization flow must not read a clipboard token.')
    },
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
  language: rewardFeed ? 'ru' : 'en',
  theme: 'dark',
  showAvatars: false,
  showTimestamp: true,
})
if (rewardFeed) setLanguage('ru')
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
function fixtureMessage(
  id: string,
  name: string,
  color: string,
  text: string,
  index = chat.length,
): NormalizedChatMessage {
  return {
    id,
    channelId: rewardFeed ? channel.channelSlug : snapshot.channelId,
    platform: 'twitch',
    author: {
      id: name === primary.displayName ? primary.platformUserId : name.toLowerCase(),
      displayName: name,
      color,
      badges: [],
    },
    timestamp: new Date(Date.UTC(2026, 10, 15, 19, 30, index * 2)),
    type: 'message',
    text,
    emotes: [],
  }
}
function emitChat(message: NormalizedChatMessage): void {
  events.emit('watched_channel_message', { channelId: channel.id, message })
}
for (const [index, [name, color, text]] of chat.entries())
  emitChat(fixtureMessage(`chat-${index}`, name, color, text, index))

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
    deviceAuth ? React.createElement(TwitchSessionSettings) : null,
    deviceAuth ? React.createElement(TwitchDeviceDialog) : null,
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

async function checkDeviceAuth(): Promise<void> {
  const connect = 'connect-channel-points'
  const dialog = 'twitch-device-sign-in'
  const disconnect = 'disconnect-channel-points'
  await until(() => Boolean(renderer && find(connect)), 'session settings open')
  await nativeWindow(current()).setWindowBounds({ x: 20, y: 20, width: 580, height: 530 })
  await focusNativeQaWindow(title)
  assert(!(await api.getTwitchPointsSessionStatus()).configured)
  assert(!find(button), 'An ordinary Twitch login does not show a viewer balance.')

  click(connect)
  await until(() => painted('ABCD0001') && openedUrls.length === 1, 'Twitch shows the first code')
  click('twitch-device-cancel')
  await until(() => !find(dialog), 'Cancel closes the code dialog')
  assert(!(await api.getTwitchPointsSessionStatus()).configured)
  assert(!find(button), 'Cancel leaves the balance hidden.')

  const pollsBeforeRetry = tokenPolls
  await until(() => painted('Connect Channel Points'), 'connect is available after cancellation')
  click(connect)
  await until(() => painted('ABCD0002') && openedUrls.length === 2, 'Twitch shows a new code')
  await until(() => tokenPolls > pollsBeforeRetry, 'Twitch waits for confirmation')
  assert(!find(button), 'A pending code keeps the balance hidden.')
  confirmDevice = true
  await until(
    () => Boolean(!find(dialog) && find(disconnect) && find(button)),
    'confirmed authorization updates the open chat balance and session settings',
  )
  assert(authenticatedSnapshots > 0)
  assert.equal(clipboardReads, 0)
  assert.deepEqual(openedUrls, [activationUrl, activationUrl])
  assert.equal((await api.getTwitchPointsSessionStatus()).userId, primary.platformUserId)
  assert.equal(AccountStore.getTokens(primary.id)?.accessToken, standardToken)
  assert(!(await api.getTwitchWebSessionStatus()).configured)

  click(button)
  await until(() => Boolean(find(popup)) && painted('1,900'), 'reward picker displays the balance')
  await closePicker()
  click(disconnect)
  await until(() => !find(button) && !find(disconnect), 'disconnect removes the visible balance')
  assert(!(await api.getTwitchPointsSessionStatus()).configured)
  console.log('Channel Points device authorization QA passed.')
}

async function checkRewardFeed(): Promise<void> {
  await until(() => Boolean(renderer), 'reward feed renderer starts')
  const window = nativeWindow(current())
  await window.setWindowBounds({ x: 20, y: 20, width: 580, height: 530 })
  await focusNativeQaWindow(title)
  await until(() => painted('festival!'), 'the chat timeline finishes loading')
  app.streamStatusStore.set(new Map())
  click('chat-input')
  xdotool('type', 'Nice!')
  await until(() => painted('Nice!'), 'short chat draft keeps the narrow composer on one line')

  const ordinary = fixtureMessage('plain', 'PixelLark', '#F99BBA', 'Ждём фестиваль!', 15)
  const unknown = {
    ...fixtureMessage('unlisted', 'CedarFox', '#F7AB7C', 'Награда из старого списка', 16),
    metadata: { rewardId: 'retired-reward-id' },
  }
  const origin = {
    ...fixtureMessage('shared-reward', 'JuniperJam', '#E9CB73', 'Ночная мелодия', 17),
    metadata: { rewardId: 'track', sharedChat: { sourceChannelId: '765' } },
  }
  const viewer = {
    ...fixtureMessage('viewer-reward', 'ViolaSkies', '#C0A1FF', 'Давайте сменим тему', 18),
    metadata: { rewardId: 'theme' },
  }
  const own = {
    ...fixtureMessage('own-reward', primary.displayName, '#7BC8F4', 'ConcernedApe — Spring', 19),
    metadata: { rewardId: 'track' },
  }
  const textless: NormalizedChatMessage = {
    ...fixtureMessage('empty-reward', 'KiteString', '#7BD7CF', '', 20),
    type: 'system',
    metadata: { rewardId: 'timer', rewardTitle: 'Добавить пять минут', rewardCost: 750 },
  }
  for (const message of [ordinary, unknown, origin, viewer, own, own]) emitChat(message)
  const notice = { message: textless, watchedChannelId: channel.id }
  events.emit('twitch_chat_notice', notice)
  events.emit('twitch_chat_notice', notice)

  const notices = [unknown, origin, viewer, own, textless].map(({ id }) => `twitch-notice-${id}`)
  await until(() => notices.every((id) => !!find(id)), 'all reward rows appear before catalog')
  assert(find(`twitch-notice-header-${unknown.id}`), 'An unknown reward keeps its icon header.')
  assert(!painted('Награда за баллы') && !painted('retired-reward-id'))
  assert(!painted('Запросить песню'), 'The catalog has not arrived yet.')
  assert(find('chat-author-twitch-plain'), 'The ordinary neighbor stays visible.')
  assert(!find('twitch-notice-plain'), 'Ordinary messages keep their ordinary row.')
  assert(painted('KiteString') && painted('Добавить пять минут') && painted('750 баллов'))

  const trackReward: TwitchReward = {
    id: 'track',
    title: 'Запросить песню',
    cost: 300,
    isEnabled: true,
    isPaused: false,
  }
  publish({
    rewards: [trackReward, { ...trackReward, id: 'theme', title: 'Сменить тему', cost: 500 }],
  })
  events.emit('twitch_activity_snapshot', {
    channelSlug: 'moonlightarcade',
    snapshot: {
      ...snapshot,
      channelId: '765',
      channelSlug: 'moonlightarcade',
      rewards: [{ ...trackReward, title: 'Выбрать трек на бис', cost: 275 }],
    },
  })
  await until(
    () => painted('Запросить песню') && painted('Сменить тему') && painted('Выбрать трек на бис'),
    'the live catalog supplies reward titles, including the Shared Chat source',
  )

  const captured: string[] = []
  const modes = ['modern', 'compact'] satisfies AppSettings['chatTheme'][]
  for (const mode of modes) {
    app.settingsStore.modify((settings) => settings && { ...settings, chatTheme: mode })
    // eslint-disable-next-line no-await-in-loop
    await window.setWindowBounds({ x: 20, y: 20, width: 580, height: 530 })
    // eslint-disable-next-line no-await-in-loop
    await until(
      () =>
        notices.every((id) => !!find(id)) &&
        painted('трек на бис') &&
        Boolean(find('chat-timestamp-own-reward')) === (mode === 'compact'),
      `wide reward timeline switches to ${mode}`,
    )
    const text = current().getPaintedText().join(' ').replace(/\s+/gu, ' ')
    assert(!text.includes('Награда за баллы'), 'Reward headers omit the generic label.')
    assert.equal(text.split('ConcernedApe').length - 1, 1, 'The own reward message appears once.')
    assert.equal(text.split('Давайте сменим').length - 1, 1, 'The viewer reward appears once.')
    assert.equal(text.split('Добавить пять минут').length - 1, 1, 'The Twitch notice appears once.')
    for (const cost of [300, 500, 275, 750]) assert(text.includes(`${cost} баллов`))
    assert(text.includes('OrbitLane') && text.includes('ViolaSkies') && text.includes('KiteString'))

    for (const width of [580, 320]) {
      // eslint-disable-next-line no-await-in-loop
      await window.setWindowBounds({ x: 20, y: 20, width, height: width === 580 ? 530 : 240 })
      // eslint-disable-next-line no-await-in-loop
      await until(
        () =>
          getNativeQaWindowGeometry(title).width === width &&
          painted('KiteString') &&
          painted('ConcernedApe'),
        `reward actors visible at ${width}px in ${mode} mode`,
      )
      const chatBox = bounds('chat-messages')
      for (const { id } of [own, textless]) {
        const box = bounds(`twitch-notice-${id}`)
        const header = bounds(`twitch-notice-header-${id}`)
        assert(box.x >= chatBox.x && box.x + box.width <= chatBox.x + chatBox.width + 1)
        assert(header.x >= box.x && header.x + header.width <= box.x + box.width + 1)
        assert(box.y + box.height <= chatBox.y + chatBox.height + 1, 'Reward stays above composer.')
      }
      // eslint-disable-next-line no-await-in-loop
      captured.push(await capture(`reward-feed-${mode}-${width}`))
    }
  }
  console.log(JSON.stringify({ screenshots: captured }, null, 2))
}

const screenshots: string[] = []
async function checkRewards(): Promise<void> {
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
  emitChat(fixtureMessage('live-message', 'OrbitLane', '#7BC8F4', 'The farm chat is moving.'))
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
}

try {
  await manager.start()
  if (deviceAuth) await checkDeviceAuth()
  else if (rewardFeed) await checkRewardFeed()
  else await checkRewards()
} catch (error) {
  if (renderer) {
    console.error(current().getPaintedText())
    await captureGuiQaDisplay('channel-points-failure')
  }
  throw error
} finally {
  approval.resolve()
  activityRefresh?.stop()
  globalThis.fetch = originalFetch
  stopHotkeys()
  stopMessages()
  stopActivity()
  await manager.quit()
  db.close()
}
