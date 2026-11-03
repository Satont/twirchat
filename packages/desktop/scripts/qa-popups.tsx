if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { join } from 'node:path'
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
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { UserCardDialog } = await import('../src/gpuix/components/UserCardDialog')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { focusNativeQaWindow } = await import('./qa-x11')
const originalFetch = globalThis.fetch
const requests = [],
  commands = [],
  copies = [],
  external = []
const sharp = (await import('sharp')).default
const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#8b5cf6' } })
  .png()
  .toBuffer()
globalThis.fetch = async (input) => {
  requests.push(String(input))
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
const backend = {
  events: createDesktopEvents(),
  api: {
    getUiState: async () => null,
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
    getChatters: async () => ({ results: [] }),
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
async function mount(component, props = {}, emote = false) {
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
          emote
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
async function type(id, text) {
  const node = find(id)
  renderer.focusElement(node.id)
  await press('ctrl-a')
  await press([...text].join(' '))
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
  await press('ctrl-y')
  assert.equal(added.length, 0)
  await type('add-channel-input', 'mockchannel')
  await press('ctrl-y')
  assert.deepEqual(added, [['twitch', 'mockchannel']])
  await press('ctrl-r')
  assert.equal(closed, 1)
  closed = 0
  await mount(ChattersDialog, {
    targets: [{ platform: 'twitch', channelSlug: 'mock' }],
    onClose: () => {
      closed++
    },
  })
  await type('chatters-search', 'viewer')
  await press('ctrl-f')
  await press('a')
  assert.ok(renderer.getPaintedText().includes('a'), 'Chatter search must select all existing text')
  await press('ctrl-y')
  assert.equal(closed, 0)
  await press('ctrl-d')
  assert.equal(closed, 1)
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
        Array.from({ length: 280 }, (_, index) => ({
          id: `${index}`,
          alias: `Emote${index}`,
          name: `Emote${index}`,
          source: index < 140 ? 'channel' : 'global',
          imageUrl: `data:image/png;base64,${png.toString('base64')}`,
          animated: false,
          zeroWidth: false,
          aspectRatio: 1,
        })),
      ],
    ]),
  )
  closed = 0
  const selected = []
  await mount(
    EmotePicker,
    {
      platform: 'twitch',
      channelId: 'mock',
      useSessionCache: true,
      onSelect: (alias) => selected.push(alias),
      onClose: () => {
        closed++
      },
    },
    true,
  )
  assert.ok(nodes().some((node) => node.text === 'CHANNEL'))
  await press('ctrl-right')
  assert.ok(nodes().some((node) => node.text === 'GLOBAL'))
  const list = find('emote-popup-list'),
    before = renderer.getListScrollTop(list.id)
  await press('ctrl-pagedown')
  const after = renderer.getListScrollTop(list.id)
  assert.ok(after[0] > before[0] || after[1] > before[1])
  await press('ctrl-y')
  assert.equal(selected.length, 0)
  await captureGuiQaDisplay('popup-emotes')
  await press('ctrl-d')
  assert.equal(closed, 1)
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
  const history = find('user-card-history-viewport'),
    top = renderer.getListScrollTop(history.id)
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
