if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'

import type { ChannelChatters, ChattersTarget } from '../src/gpuix/backend/api'
import type { UserCardTarget } from '../src/views/main/utils/chatCommands'

const React = await import('react')
const { createRenderer, createRoot, startFrameLoop, TooltipProvider, useGpuixRequired } =
  await import('@gpuix/react')
const { BackendContext } = await import('../src/gpuix/backend/context')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { handleGlobalKeyDown } = await import('../src/gpuix/state/hotkeys')
const { actionBindingsStore, registerHotkeyContext, setHotkeyRoute, observeNativeHotkeyPlan } =
  await import('../src/gpuix/state/action-bindings')
const { DEFAULT_MODERATION_SETTINGS } = await import('@twirchat/shared/user-profile')
const app = await import('../src/gpuix/state/app')
const { streamerModeStore } = await import('../src/gpuix/state/streamer-mode')
const { TabSelectorModal } = await import('../src/gpuix/components/TabSelectorModal')
const { AddChannelModal } = await import('../src/gpuix/components/AddChannelModal')
const { ChattersDialog } = await import('../src/gpuix/components/ChattersDialog')
const { SearchAllChatsDialog } = await import('../src/gpuix/components/SearchAllChatsDialog')
const { EmotePicker } = await import('../src/gpuix/components/EmotePicker')
const { ChatNotice } = await import('../src/gpuix/components/App')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { DEFAULT_EMOTE_PREFERENCES } = await import('../src/services/provider-emotes')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { UserCardDialog } = await import('../src/gpuix/components/UserCardDialog')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { focusNativeQaWindow, getNativeQaWindowGeometry } = await import('./qa-x11')
const originalFetch = globalThis.fetch
const requests = [],
  commands = [],
  copies = [],
  external = []
const sharp = (await import('sharp')).default
const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#8b5cf6' } })
  .png()
  .toBuffer()
const emoteColors = [
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#ef4444',
  '#14b8a6',
  '#f97316',
]
const emotePngs = await Promise.all(
  emoteColors.map((background) =>
    sharp({ create: { width: 32, height: 32, channels: 4, background } })
      .png()
      .toBuffer(),
  ),
)
function emoteImage(alias: string): string {
  let hash = 0
  for (const character of alias) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return `data:image/png;base64,${Buffer.from(emotePngs[hash % emotePngs.length] ?? png).toString('base64')}`
}
function emote(
  alias: string,
  source: EmoteCatalogEntry['source'],
  provider?: EmoteCatalogEntry['provider'],
): EmoteCatalogEntry {
  return {
    id: alias,
    alias,
    name: alias,
    source,
    provider,
    imageUrl: emoteImage(alias),
    animated: false,
    zeroWidth: false,
    aspectRatio: 1,
  }
}
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  requests.push(url)
  if (url.startsWith('data:image/')) {
    const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
    return new Response(bytes, { headers: { 'content-type': 'image/png' } })
  }
  return new Response(png, { headers: { 'content-type': 'image/png' } })
}
const moderation = structuredClone(DEFAULT_MODERATION_SETTINGS)
moderation.timeouts[0] = { label: 'QA timeout', seconds: 123 }
moderation.defaultReason = 'QA selected reason'
const target = {
  platform: 'twitch',
  platformUserId: 'viewer',
  username: 'viewer',
  displayName: 'QA Viewer',
  channelSlug: 'mock',
  channelId: 'mock',
  avatarUrl: 'https://avatar.invalid/visible.png',
}
const messages = Array.from({ length: 100 }, (_, index) => ({
  id: `qa-${index}`,
  platform: 'twitch',
  channelId: 'mock',
  author: { id: 'viewer', displayName: 'QA Viewer', badges: [] },
  text: `History message ${index}`,
  emotes: [],
  timestamp: new Date(1700000000000 + index * 1000),
  type: 'message',
}))
const viewerRequests: ChattersTarget['platform'][] = []
const viewerLookups: string[] = []
const viewerResults: Record<ChattersTarget['platform'], ChannelChatters> = {
  twitch: {
    platform: 'twitch',
    channelSlug: 'mock',
    channelId: 'mock',
    total: 3,
    groups: [
      { role: 'moderators', users: [{ userId: '123', username: 'mod', displayName: 'Mod' }] },
      { role: 'vips', users: [{ userId: '456', username: 'vip', displayName: 'VIP Viewer' }] },
      { role: 'chatters', users: [{ userId: '789', username: 'viewer', displayName: 'Viewer' }] },
    ],
  },
  kick: {
    platform: 'kick',
    channelSlug: 'kickmock',
    channelId: '4321',
    total: 100,
    groups: [
      {
        role: 'chatters',
        users: Array.from({ length: 100 }, (_, index) => ({
          username: `viewer${index}`,
          displayName: `Kick Viewer ${index}`,
        })),
      },
    ],
  },
}
const communityViewers: ChannelChatters = {
  platform: 'twitch',
  channelSlug: 'community',
  channelId: 'community',
  source: 'community',
  total: 1000,
  groups: [
    {
      role: 'chatters',
      users: Array.from({ length: 1000 }, (_, index) => ({
        username: `guest${index}`,
        displayName: `guest${index}`,
      })),
    },
  ],
}
const backend = {
  events: createDesktopEvents(),
  api: {
    getUiState: async ({ key }: { key: string }) =>
      key === 'emote_preferences_v1'
        ? JSON.stringify({
            ...DEFAULT_EMOTE_PREFERENCES,
            favorites: [
              { ...emote('SavedWave', 'global'), imageUrl: 'https://emotes.invalid/fav' },
            ],
          })
        : null,
    setUiState: async () => {},
    getModerationSettings: async () => moderation,
    getUserCardMetadata: async () => null,
    getUserCosmetics: async () => null,
    getUserProfile: async () => ({
      errors: [],
      avatarUrl: 'https://avatar.invalid/profile-hidden.png',
    }),
    getUserChatHistory: async () => ({ messages, hasMore: false, nextCursor: null }),
    executePlatformCommand: async (command) => {
      commands.push(command)
    },
    getChatters: async ({ targets }: { targets: ChattersTarget[] }) => ({
      results: targets.map(({ platform, channelSlug }) => {
        viewerRequests.push(platform)
        return channelSlug === communityViewers.channelSlug
          ? communityViewers
          : viewerResults[platform]
      }),
    }),
    resolveMentionUser: async ({ platform, username }: { platform: string; username: string }) => {
      viewerLookups.push(username)
      if (platform === 'twitch') {
        return { platformUserId: '9012', displayName: 'Community Guest', username }
      }
      await Bun.sleep(400)
      return { platformUserId: '5678', displayName: username, username }
    },
    copyText: async ({ text }) => {
      copies.push(text)
    },
    openExternalUrl: async ({ url }) => {
      external.push(url)
    },
  },
}
const bindings = [
  ['accept', 'y', []],
  ['reject', 'r', []],
  ['delete', 'd', []],
  ['search', 'f', []],
  ['openTab', 'arrowright', ['next']],
  ['scrollPage', 'pagedown', ['down']],
  ['execModeratorAction', 'b', ['1']],
  ['openProfilePictureMenu', 'p', []],
  ['pin', 'i', []],
].map(([action, key, args]) => ({
  id: `qa-${action}`,
  name: action,
  enabled: true,
  category: 'popupWindow',
  action,
  keys: [`ctrl+${key}`],
  arguments: args,
}))
actionBindingsStore.update({ loaded: true, value: { bindings, legacyNavigation: false } })
let background = 0
const stopBase = registerHotkeyContext({
  id: 'base',
  windowId: 'main',
  category: 'window',
  handlers: {
    quit: () => {
      background++
    },
  },
})
const stopRoute = setHotkeyRoute('main', ['base'], 1)
const renderer = createRenderer()
renderer.init({
  title: 'TwirChat popups QA',
  appId: process.env.TWIRCHAT_QA_APP_ID,
  focus: false,
  width: 820,
  height: 850,
})
const stopNativePlan = observeNativeHotkeyPlan('main', (plan) =>
  renderer.setHotkeyPlan(JSON.stringify(plan)),
)
const root = createRoot(renderer, { onKeyDown: (event) => handleGlobalKeyDown(event) })
const loop = startFrameLoop(renderer)
const e = React.createElement
function EmotePickerFixture(props) {
  return e(
    React.Fragment,
    null,
    e('div', { style: { height: 24, width: 300 } }, e(EmotePicker, props)),
    e(ChatNotice),
  )
}
async function mount(component, props = {}, anchored = false) {
  root.render(
    e(
      BackendContext.Provider,
      { value: backend },
      e(
        TooltipProvider,
        null,
        e(
          'div',
          {
            style: {
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              alignItems: 'flex-end',
              backgroundColor: '#111114',
            },
          },
          anchored
            ? e('div', { style: { height: 24, width: 300 } }, e(component, props))
            : e(component, props),
        ),
      ),
    ),
  )
  await Bun.sleep(220)
}
function nodes(node = JSON.parse(renderer.getAutomationTree())) {
  return [node, ...(node.children ?? []).flatMap((child) => nodes(child))]
}
function find(id) {
  const node = nodes().find((node) => node.testId === id)
  assert.ok(node, `Missing ${id}`)
  return node
}
async function press(key) {
  renderer.simulateKeystrokes(key)
  await Bun.sleep(130)
}
async function clickText(text) {
  const node = nodes().find((node) => node.text === text)
  assert.ok(node, `Missing text ${text}`)
  const b = renderer.getElementBounds(node.id)
  assert.ok(b)
  renderer.simulateClick(b.x + b.width / 2, b.y + b.height / 2, 0)
  await Bun.sleep(150)
}
function boundsOf(id: string) {
  const node = find(id)
  const bounds = nativeWindow(renderer).getPaintedElementBounds(node.id) ?? node.bounds
  assert.ok(bounds, `Missing bounds for ${id}`)
  return bounds
}
function assertPlatformButtonsFit() {
  const left = boundsOf('add-platform-twitch').x
  const confirm = boundsOf('add-channel-confirm')
  const right = confirm.x + confirm.width
  for (const platform of ['twitch', 'kick', 'youtube', 'vkplay']) {
    const button = boundsOf(`add-platform-${platform}`)
    assert.ok(
      button.x >= left && button.x + button.width <= right,
      `${platform} button must fit in the add-channel form`,
    )
  }
}
async function click(id: string) {
  const bounds = boundsOf(id)
  renderer.simulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)
  await Bun.sleep(150)
}
async function clickViewerControl(id: string, button = '1') {
  const bounds = boundsOf(id)
  const window = getNativeQaWindowGeometry('TwirChat popups QA')
  const x = Math.round(window.x + bounds.x + bounds.width / 2)
  const y = Math.round(window.y + bounds.y + bounds.height / 2)
  await Bun.$`/usr/bin/xdotool mousemove ${x} ${y} click ${button}`.quiet()
  await Bun.sleep(100)
}
function emoteViewport() {
  const list = find('emote-popup-list')
  const popup = boundsOf('emote-popup')
  const tabs = boundsOf('emote-popup-tabs')
  const height = renderer.getListScrollTop(list.id)?.[2]
  assert.ok(height && height > 0)
  return { x: tabs.x, y: tabs.y + tabs.height, width: popup.width - 2, height }
}
async function type(id, text) {
  const node = find(id)
  renderer.focusElement(node.id)
  await press('ctrl-a')
  await press([...text].join(' '))
}
function CommunityChatters() {
  const [viewer, setViewer] = React.useState<UserCardTarget | null>(null)
  return viewer
    ? e(UserCardDialog, { target: viewer, onClose: () => setViewer(null) })
    : e(ChattersDialog, {
        targets: [{ platform: 'twitch', channelSlug: communityViewers.channelSlug }],
        onOpenUserCard: setViewer,
        onClose: () => {},
      })
}
let closed = 0
let nativeManager = null
try {
  await mount(TabSelectorModal, {
    tabs: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ],
    activeTabId: 'a',
    onSelect: (id) => {
      assert.equal(id, 'b')
    },
    onClose: () => {
      closed++
    },
  })
  await focusNativeQaWindow('TwirChat popups QA')
  await press('down')
  await press('ctrl-y')
  assert.equal(closed, 1)
  closed = 0
  const added = []
  await mount(AddChannelModal, {
    onConfirm: (...args) => added.push(args),
    onCancel: () => {
      closed++
    },
  })
  assertPlatformButtonsFit()
  await press('ctrl-y')
  assert.equal(added.length, 0)
  await type('add-channel-input', 'mockchannel')
  await press('ctrl-y')
  assert.deepEqual(added, [['twitch', 'mockchannel']])
  await nativeWindow(renderer).setWindowBounds({ width: 320, height: 500 })
  await Bun.sleep(220)
  assertPlatformButtonsFit()
  await click('add-platform-vkplay')
  await captureGuiQaDisplay('popup-add-channel-small')
  await type('add-channel-input', 'vklive')
  await press('ctrl-y')
  assert.deepEqual(added, [
    ['twitch', 'mockchannel'],
    ['vkplay', 'vklive'],
  ])
  await press('ctrl-r')
  assert.equal(closed, 1)
  await nativeWindow(renderer).setWindowBounds({ width: 820, height: 850 })
  closed = 0
  const openedViewers: UserCardTarget[] = []
  await mount(ChattersDialog, {
    targets: [
      { platform: 'kick', channelSlug: 'kickmock' },
      { platform: 'twitch', channelSlug: 'mock' },
    ],
    onOpenUserCard: (viewer: UserCardTarget) => openedViewers.push(viewer),
    onClose: () => {
      closed++
    },
  })
  assert.deepEqual(viewerRequests, ['twitch'])
  assert.ok(renderer.getPaintedText().includes('MODERATORS'))
  assert.ok(renderer.getPaintedText().includes('VIPS'))
  await captureGuiQaDisplay('popup-chatters-twitch')
  await clickViewerControl('chatters-user-vip', '3')
  assert.equal(openedViewers.length, 0)
  await clickViewerControl('chatters-user-vip')
  assert.equal(openedViewers[0]?.platformUserId, '456')
  assert.equal(openedViewers[0]?.channelId, 'mock')
  assert.equal(closed, 0)
  await nativeWindow(renderer).setWindowBounds({ width: 320, height: 500 })
  await Bun.sleep(220)
  await clickViewerControl('chatters-tab-kick')
  await type('chatters-search', 'viewer99')
  assert.ok(!nodes().some((node) => node.testId === 'chatters-user-vip'))
  assert.ok(renderer.getPaintedText().includes('Kick Viewer 99'))
  await captureGuiQaDisplay('popup-chatters-kick-small')
  await clickViewerControl('chatters-user-viewer99')
  await clickViewerControl('chatters-tab-twitch')
  await Bun.sleep(300)
  assert.equal(openedViewers.length, 1, 'A switched tab must discard the pending viewer lookup')
  await clickViewerControl('chatters-tab-kick')
  renderer.focusElement(find('chatters-user-viewer99').id)
  await Bun.sleep(100)
  await Bun.$`/usr/bin/xdotool key Return`.quiet()
  await Bun.sleep(480)
  assert.deepEqual(viewerLookups, ['viewer99', 'viewer99'])
  assert.equal(openedViewers[1]?.platformUserId, '5678')
  assert.equal(openedViewers[1]?.channelId, '4321')
  assert.equal(openedViewers[1]?.channelSlug, 'kickmock')
  await nativeWindow(renderer).setWindowBounds({ width: 820, height: 850 })
  await Bun.sleep(220)
  await type('chatters-search', 'viewer')
  await press('ctrl-f')
  await press('a')
  assert.ok(renderer.getPaintedText().includes('a'), 'Chatter search must select all existing text')
  await press('ctrl-y')
  assert.equal(closed, 0)
  await press('ctrl-d')
  assert.equal(closed, 1)
  await nativeWindow(renderer).setWindowBounds({ width: 320, height: 500 })
  await mount(CommunityChatters)
  await until(
    () => renderer.getPaintedText().includes('Community data from api.tackling.cc'),
    'community chatter source',
  )
  assert.ok(renderer.getPaintedText().includes('Page 1 of 10'))
  await captureGuiQaDisplay('popup-chatters-community-small')
  await clickViewerControl('chatters-community-next')
  assert.ok(renderer.getPaintedText().includes('Page 2 of 10'))
  assert.ok(find('chatters-user-guest100'))
  await type('chatters-search', 'guest999')
  await clickViewerControl('chatters-user-guest999')
  await until(
    () => renderer.getPaintedText().includes('Community Guest'),
    'Twitch user card for a viewer resolved by login',
  )
  assert.equal(viewerLookups.at(-1), 'guest999')
  await nativeWindow(renderer).setWindowBounds({ width: 820, height: 850 })
  closed = 0
  app.tabChannelIdsStore.set([])
  await mount(SearchAllChatsDialog, {
    onClose: () => {
      closed++
    },
  })
  await type('search-all-chats-input', 'viewer')
  await press('ctrl-f')
  await press('a')
  assert.ok(
    renderer.getPaintedText().includes('a'),
    'Global search must focus and select its query',
  )
  await press('ctrl-d')
  assert.equal(closed, 1)
  app.emoteStore.set(
    new Map([
      [
        'twitch:mock',
        [
          ...Array.from({ length: 140 }, (_, index) => emote(`Emote${index}`, 'global')),
          emote('SevenGlobal', 'global', 'seventv'),
          emote('FrankerGlobal', 'global', 'ffz'),
          emote('SevenChannel', 'seventv'),
          emote('TwitchChannel', 'channel'),
          { ...emote('LockedChannel', 'channel'), locked: true },
          ...Array.from({ length: 7 }, (_, index) => ({
            ...emote(`LockedChannel${index + 2}`, 'channel'),
            locked: true,
          })),
          emote('Collectible', 'collectibles'),
          emote('PersonalWave', 'personal'),
        ],
      ],
    ]),
  )
  closed = 0
  const selected = []
  await mount(EmotePickerFixture, {
    platform: 'twitch',
    channelId: 'mock',
    useSessionCache: true,
    onSelect: (alias) => selected.push(alias),
    onClose: () => {
      closed++
    },
  })
  const tabs = [
    'favorites',
    'channel',
    'global',
    'seventv',
    'ffz',
    'bttv',
    'collectibles',
    'personal',
  ]
  const assertTabOrder = () =>
    assert.deepEqual(
      nodes()
        .map((node) => node.testId)
        .filter((id) => id?.startsWith('emote-popup-tab-')),
      tabs.map((source) => `emote-popup-tab-${source}`),
    )
  assertTabOrder()
  await click('emote-popup-tab-channel')
  assert.ok(find('emote-popup-locked-LockedChannel'))
  await captureGuiQaDisplay('popup-emotes-locked')
  await click('emote-popup-item-LockedChannel')
  assert.deepEqual(selected, [])
  assert.match(app.noticeStore.get()?.text ?? '', /Subscribe to this channel/)
  renderer.simulateMouseMove(10, 10)
  await Bun.sleep(350)
  await captureGuiQaDisplay('popup-emotes-locked-notice')
  await click('emote-popup-item-TwitchChannel')
  assert.deepEqual(selected, ['TwitchChannel'])
  selected.length = 0
  await click('emote-popup-tab-global')
  await type('emote-popup-search', 'frankerglobal')
  assert.ok(find('emote-popup-item-FrankerGlobal'))
  await press('ctrl-right')
  assert.ok(renderer.getPaintedText().includes('No matches here. Check other tabs.'))
  assertTabOrder()
  await click('emote-popup-tab-ffz')
  assert.ok(nodes().some((node) => node.text === 'FFZ'))
  assert.ok(find('emote-popup-item-FrankerGlobal'))
  await press('ctrl-f')
  await press('x')
  assert.ok(renderer.getPaintedText().includes('No emotes found'))
  await press('backspace')
  assert.ok(find('emote-popup-item-FrankerGlobal'))
  await click('emote-popup-tab-global')
  const normalViewport = emoteViewport()
  const seventh = boundsOf('emote-popup-item-Emote6')
  assert.ok(seventh.x + seventh.width <= normalViewport.x + normalViewport.width)
  await click('emote-popup-item-Emote6')
  assert.deepEqual(selected, ['Emote6'])
  await press('ctrl-right')
  assert.ok(find('emote-popup-item-SevenGlobal'))
  assert.ok(find('emote-popup-item-SevenChannel'))
  await click('emote-popup-tab-bttv')
  assert.ok(renderer.getPaintedText().includes('No emotes in this tab yet'))
  await press('ctrl-y')
  assert.deepEqual(selected, ['Emote6'])
  await click('emote-popup-tab-global')
  await captureGuiQaDisplay('popup-emotes')
  const small = { width: 320, height: 240 }
  await nativeWindow(renderer).setWindowBounds(small)
  await Bun.sleep(220)
  const popup = boundsOf('emote-popup')
  const viewport = emoteViewport()
  assert.ok(popup.x >= 0 && popup.x + popup.width <= small.width)
  assert.ok(popup.y >= 0 && popup.y + popup.height <= small.height)
  assert.ok(viewport.y + viewport.height <= popup.y + popup.height)
  assert.ok(viewport.height < normalViewport.height)
  assertTabOrder()
  const list = find('emote-popup-list')
  const before = renderer.getListScrollTop(list.id)
  await press('ctrl-pagedown')
  const after = renderer.getListScrollTop(list.id)
  assert.ok(after[0] > before[0] || after[1] > before[1])
  renderer.simulateScrollWheel(
    viewport.x + viewport.width / 2,
    viewport.y + viewport.height / 2,
    0,
    -2000,
  )
  await Bun.sleep(180)
  const last = boundsOf('emote-popup-item-FrankerGlobal')
  assert.ok(last.y >= viewport.y && last.y + last.height <= viewport.y + viewport.height)
  await captureGuiQaDisplay('popup-emotes-small')
  await click('emote-popup-item-FrankerGlobal')
  assert.deepEqual(selected, ['Emote6', 'FrankerGlobal'])
  await press('ctrl-f')
  await press('escape')
  assert.equal(closed, 1)
  renderer.simulateClick(2, 2, 0)
  await Bun.sleep(120)
  assert.equal(closed, 2)
  await nativeWindow(renderer).setWindowBounds({ width: 820, height: 850 })
  closed = 0
  await mount(UserCardDialog, {
    target,
    onClose: () => {
      closed++
    },
  })
  await press('ctrl-y')
  assert.equal(closed, 0)
  await press('ctrl-b')
  assert.equal(commands.length, 1)
  assert.equal(commands[0].text, '/timeout viewer 123 QA selected reason')
  await clickText('History')
  const history = find('user-card-history-viewport')
  // History opens at the latest message. Start inside the list to test Page Down.
  renderer.scrollToItem(history.id, 50, 0)
  await Bun.sleep(150)
  const top = renderer.getListScrollTop(history.id)
  await press('ctrl-pagedown')
  const moved = renderer.getListScrollTop(history.id)
  assert.ok(moved[0] > top[0] || moved[1] > top[1])
  await press('ctrl-p')
  assert.ok(find('profile-picture-menu'))
  await captureGuiQaDisplay('popup-profile-picture')
  await clickText('Copy image URL')
  assert.deepEqual(copies, [target.avatarUrl])
  await press('ctrl-p')
  await clickText('Open full size')
  assert.deepEqual(external, [target.avatarUrl])
  await press('ctrl-d')
  assert.ok(!nodes().some((node) => node.testId === 'profile-picture-menu'))
  assert.equal(closed, 0)
  await press('ctrl-i')
  renderer.simulateClick(2, 2, 0)
  await Bun.sleep(120)
  assert.equal(closed, 0)
  await captureGuiQaDisplay('popup-user-card')
  await press('ctrl-i')
  renderer.simulateClick(2, 2, 0)
  await Bun.sleep(120)
  assert.equal(closed, 1)
  closed = 0
  streamerModeStore.update({
    effectiveEnabled: true,
    settings: { ...streamerModeStore.get().settings, hideUsercardAvatars: true },
  })
  await mount(UserCardDialog, {
    target: { ...target, avatarUrl: 'https://avatar.invalid/private.png' },
    onClose: () => {
      closed++
    },
  })
  await clickText('Profile')
  await press('ctrl-p')
  assert.ok(!nodes().some((node) => node.testId === 'profile-picture-menu'))
  assert.ok(!requests.some((url) => url.includes('/private.png')))
  assert.ok(!nodes().some((node) => node.text === 'Copy profile avatar URL'))
  await clickText('Actions & moderation')
  await clickText('Copy avatar URL')
  assert.equal(copies.length, 1)
  assert.equal(external.length, 1)
  assert.equal(background, 0)
  await captureGuiQaDisplay('popup-user-card-private')
  stopNativePlan()
  root.render(e('div', { style: { width: '100%', height: '100%', backgroundColor: '#111114' } }))
  await Bun.sleep(120)
  const nativeRoots = new Map()
  function NativeContent({ descriptor }) {
    const nativeRenderer = useGpuixRequired()
    React.useEffect(() => {
      nativeRoots.set(descriptor.id, nativeRenderer)
      return () => {
        nativeRoots.delete(descriptor.id)
      }
    }, [descriptor.id, nativeRenderer])
    return descriptor.kind === 'user'
      ? e(UserCardDialog, {
          target: descriptor.target,
          standalone: true,
          onClose: () => {
            void nativeManager.close(descriptor.id)
          },
        })
      : e(
          'div',
          { style: { padding: 20 } },
          e('text', { style: { color: '#ffffff' } }, 'Private manager main'),
        )
  }
  async function until(check, label) {
    const end = performance.now() + 5000
    while (performance.now() < end) {
      if (check()) return
      await Bun.sleep(20)
    }
    throw new Error(`Timed out: ${label}`)
  }
  nativeManager = new DesktopWindowManager(
    backend,
    (descriptor) => e(NativeContent, { descriptor }),
    () => {},
  )
  await nativeManager.start()
  const userId = await nativeManager.openUser(target)
  await until(() => nativeRoots.size === 2, 'native popup mounted')
  const userRenderer = nativeRoots.get(userId)
  await userRenderer.setWindowBounds({ x: 460, y: 30, width: 760, height: 750 })
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'native-user-before-focus.json'),
    JSON.stringify(
      {
        open: userRenderer.isWindowOpen(),
        active: userRenderer.isWindowActive(),
        titles: Bun.spawnSync(
          [
            '/usr/bin/xdotool',
            'search',
            '--onlyvisible',
            '--name',
            'TwirChat',
            'getwindowname',
            '%@',
          ],
          { env: process.env },
        ).stdout.toString(),
        text: userRenderer.getAllText(),
      },
      null,
      2,
    ),
  )
  const xids = Bun.spawnSync(['/usr/bin/xdotool', 'search', '--name', 'TwirChat'], {
    env: process.env,
  })
    .stdout.toString()
    .trim()
    .split('\n')
    .filter(Boolean)
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'native-user-x11-titles.json'),
    JSON.stringify(
      xids.map((id) => ({
        id,
        title: Bun.spawnSync(['/usr/bin/xdotool', 'getwindowname', id], {
          env: process.env,
        }).stdout.toString(),
        properties: Bun.spawnSync(
          ['/usr/bin/xprop', '-id', id, 'WM_NAME', '_NET_WM_NAME', 'WM_STATE'],
          { env: process.env },
        ).stdout.toString(),
      })),
      null,
      2,
    ),
  )
  await focusNativeQaWindow('TwirChat — viewer')
  await until(() => userRenderer.isWindowActive(), 'native user active')
  userRenderer.simulateKeystrokes('ctrl-i')
  await Bun.sleep(180)
  assert.ok(userRenderer.getAllText().includes('Unpin card'))
  await focusNativeQaWindow('TwirChat')
  await Bun.sleep(250)
  assert.equal(userRenderer.isWindowOpen(), true)
  assert.equal(userRenderer.isWindowActive(), false)
  await captureGuiQaDisplay('popup-native-pinned')
  await focusNativeQaWindow('TwirChat — viewer')
  userRenderer.simulateKeystrokes('ctrl-i')
  await Bun.sleep(160)
  assert.ok(userRenderer.getAllText().includes('Pin card'))
  await focusNativeQaWindow('TwirChat')
  await until(() => !userRenderer.isWindowOpen(), 'unpinned user closes on deactivation')
  await nativeManager.quit()
  await until(() => nativeRoots.size === 0, 'native popup cleanup')
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'popups-result.json'),
    JSON.stringify(
      {
        passed: true,
        chooserAcceptReject: true,
        viewerTabsRolesAndCards: true,
        communityViewerCard: true,
        searchFocusSelectAll: true,
        emoteTabsAndMeasuredPage: true,
        userCardModerationHistoryPinAvatar: true,
        streamerAvatarPrivacy: true,
        nativePinDeactivation: true,
        backgroundActions: background,
      },
      null,
      2,
    ),
  )
} catch (error) {
  await captureGuiQaDisplay('popup-failure')
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'popup-tree.json'),
    JSON.stringify(JSON.parse(renderer.getAutomationTree())),
  )
  console.error(error)
  process.exitCode = 1
} finally {
  await nativeManager?.quit().catch(() => {})
  stopNativePlan()
  stopRoute()
  stopBase()
  loop.stop()
  root.unmount()
  globalThis.fetch = originalFetch
  process.exit(process.exitCode ?? 0)
}
