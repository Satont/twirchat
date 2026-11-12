import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type {
  Account,
  NormalizedChatMessage,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'
import { z } from 'zod'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { nativeWindow } = await import('../src/gpuix/native-window')
import type { NativeWindowControls } from '../src/gpuix/native-window'
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const app = await import('../src/gpuix/state/app')
const { actionBindingsStore } = await import('../src/gpuix/state/action-bindings')
const { useStore } = await import('../src/gpuix/state/create-store')
const { registerHotkeyActions } = await import('../src/gpuix/state/hotkeys')
const { layoutStore } = await import('../src/gpuix/state/layout')
const { customCommandsStore } = await import('../src/gpuix/state/custom-commands')
const { composerStore, editComposer, updateComposer } = await import('../src/gpuix/state/composer')
const { emotePreferencesStore } = await import('../src/gpuix/state/emote-preferences')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { focusNativeQaWindow } = await import('./qa-x11')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')

interface AutomationNode {
  id: number
  testId?: string
  text?: string
  children: AutomationNode[]
}
const automationSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    text: z.string().optional(),
    children: z.array(automationSchema).default([]),
  }),
)
type Renderer = GpuixRenderer & NativeWindowControls
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
const backend = getDesktopBackend()
const channel: WatchedChannel = {
  id: '1c2b38ca-f407-4b10-8e98-886a813429bc',
  platform: 'kick',
  channelSlug: 'qa-autocomplete',
  displayName: 'Autocomplete QA',
  createdAt: 0,
}
const tabId = `tab:${channel.id}`
const panelId = '2cd30a1a-a11b-4818-b0cd-a277e0b32b56'
const nextTabId = 'tab:3612b68c-3c3c-45da-84bd-dd985940ba44'
const paneId = `${tabId}:${panelId}`
const composerKey = `${paneId}:${channel.id}`
const twitchChannel: WatchedChannel = {
  id: '537dd149-c747-4a26-a1e0-b54095774b7f',
  platform: 'twitch',
  channelSlug: 'qa_fossabot',
  displayName: 'Fossabot QA',
  createdAt: 0,
}
const twitchTabId = `tab:${twitchChannel.id}`
const twitchPaneId = `${twitchTabId}:${panelId}`
const twitchComposerKey = `${twitchPaneId}:${twitchChannel.id}`
const twitchAccount: Account = {
  id: 'qa-twitch-account',
  platform: 'twitch',
  platformUserId: '9001',
  username: 'qa_twitch_sender',
  displayName: 'QA Twitch Sender',
  scopes: [],
  createdAt: 0,
  updatedAt: 0,
}
const layout: WatchedChannelsLayout = {
  version: 2,
  root: {
    type: 'panel',
    id: panelId,
    flex: 100,
    content: { type: 'watched', channelId: channel.id },
  },
}
const sent: string[] = []
let twirRequests = 0
let twirReloads = 0
let fossabotRequests = 0
let nightbotRequests = 0
let potatRequests = 0
const supibotUsers: Array<string | undefined> = []
let waitForTwirCommands: Promise<void> | undefined
backend.api.getChannelEmotes = async () => []
backend.api.getTwirCommands = async (target, options) => {
  assert.deepEqual(target, { platform: 'kick', platformChannelId: '12345' })
  twirRequests++
  if (options?.refresh) twirReloads++
  await waitForTwirCommands
  if (twirReloads) return [{ name: 'updated', description: 'A refreshed Twir command' }]
  return [
    ...Array.from({ length: 20 }, (_, index) => ({
      name: `twir${String(index).padStart(2, '0')}`,
      description: 'A public bot command',
    })),
    { name: 'quote add', description: 'Add a quote' },
  ]
}
backend.api.getFossabotCommands = async (target) => {
  assert.equal(target.channelLogin, twitchChannel.channelSlug)
  assert.equal(target.twitchChannelId, undefined)
  fossabotRequests++
  return [
    { name: 'sens' },
    { name: 'sensitivity', aliasFor: 'sens' },
    ...Array.from({ length: 312 }, (_, index) => ({ name: `fixture${index}` })),
  ]
}
backend.api.getNightbotCommands = async (login) => {
  assert.equal(login, twitchChannel.channelSlug)
  nightbotRequests++
  return [{ name: 'sens' }, { name: 'nighttimer' }]
}
backend.api.getPotatCommands = async (login) => {
  assert.equal(login, twitchChannel.channelSlug)
  potatRequests++
  return [
    { prefix: '#', name: 'potato' },
    { prefix: '~~', name: 'potato' },
  ]
}
backend.api.getSupibotCommands = async ({ channelLogin, userLogin }) => {
  assert.equal(channelLogin, twitchChannel.channelSlug)
  supibotUsers.push(userLogin)
  return [
    { prefix: '$', name: 'ping' },
    { prefix: '$$', name: userLogin === 'qa_twitch_sender' ? 'ping' : 'other' },
  ]
}
backend.api.sendWatchedChannelMessage = async ({ id, text }) => {
  assert.equal(id, channel.id)
  sent.push(text)
}
app.settingsStore.set({
  ...DEFAULT_SETTINGS,
  chatTheme: 'compact',
  showAvatars: false,
  jeetbotIntegrationEnabled: false,
  nightbotIntegrationEnabled: false,
})
app.watchedChannelsStore.set([channel, twitchChannel])
app.tabChannelIdsStore.set([tabId, nextTabId, twitchTabId])
app.activeWatchedTabStore.set(tabId)
const stopHotkeys = registerHotkeyActions({ openAddChannel: () => {}, openTabSelector: () => {} })
app.watchedStatusesStore.set(
  new Map([
    [
      channel.id,
      {
        platform: 'kick',
        status: 'connected',
        mode: 'authenticated',
        channelId: '12345',
      },
    ],
    [
      twitchChannel.id,
      {
        platform: 'twitch',
        status: 'connected',
        mode: 'authenticated',
        channelLogin: twitchChannel.channelSlug,
      },
    ],
  ]),
)
layoutStore.set(new Map([[tabId, { layout, isLoading: false, error: null }]]))
customCommandsStore.set({
  loaded: true,
  loading: false,
  saving: false,
  error: null,
  commands: Array.from({ length: 20 }, (_, index) => ({
    id: `qa-command-${index}`,
    name: `command${String(index).padStart(2, '0')}`,
    template:
      'A deliberately long command description with extra text that must remain clipped inside its row and popup.',
    showInMessageMenu: false,
  })),
})
actionBindingsStore.update({
  value: {
    legacyNavigation: true,
    bindings: [
      {
        id: 'qa-conflicting-down',
        name: 'Conflicting editor shortcut',
        enabled: true,
        category: 'splitInput',
        action: 'clear',
        arguments: [],
        keys: ['down'],
      },
    ],
  },
})
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
let renderer: Renderer | undefined
function Content() {
  const current = useGpuixRequired()
  const activeTab = useStore(app.activeWatchedTabStore)
  React.useEffect(() => {
    assert(current instanceof NativeRenderer)
    renderer = nativeWindow(current)
    return () => {
      renderer = undefined
    }
  }, [current])
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {activeTab === tabId ? (
        <ChatView
          paneId={paneId}
          layoutTabId={tabId}
          layoutPanelId={panelId}
          watchedChannel={channel}
        />
      ) : activeTab === twitchTabId ? (
        <ChatView
          key={twitchTabId}
          paneId={twitchPaneId}
          layoutTabId={twitchTabId}
          watchedChannel={twitchChannel}
        />
      ) : (
        <div testId="other-tab">{activeTab}</div>
      )}
    </div>
  )
}
const manager = new DesktopWindowManager(
  backend,
  () => <Content />,
  () => {},
)
function currentRenderer(): Renderer {
  assert(renderer)
  return renderer
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function nodes(): AutomationNode[] {
  return flatten(automationSchema.parse(JSON.parse(currentRenderer().getAutomationTree())))
}
function find(testId: string): AutomationNode {
  const node = nodes().find((entry) => entry.testId === testId)
  assert(node, `Missing ${testId}`)
  return node
}
function paintedBounds(testId: string) {
  const bounds = currentRenderer().getPaintedElementBounds(find(testId).id)
  assert(bounds, `Unpainted ${testId}`)
  return bounds
}
function selectedLabel(prefix = '/'): string | undefined {
  const selected = nodes().find((node) => node.testId === 'autocomplete-selected')
  return selected
    ? flatten(selected).find((node) => node.text?.startsWith(prefix))?.text
    : undefined
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
async function draft(text: string): Promise<void> {
  updateComposer(composerKey, (state) => editComposer(state, text))
  await Bun.sleep(60)
}
async function selectKey(key: 'down' | 'up', label: string): Promise<void> {
  await pressNative(key === 'down' ? 'Down' : 'Up')
  await until(() => selectedLabel(label) === label, `native ${key} selects ${label}`)
  await until(() => {
    const r = currentRenderer()
    const selected = nodes().find((node) => node.testId === 'autocomplete-selected')
    const viewport = nodes().find((node) => node.testId === 'autocomplete-viewport')
    const item = selected ? r.getPaintedElementBounds(selected.id) : null
    const scroll = viewport ? r.getPaintedElementBounds(viewport.id) : null
    return (
      !!item &&
      !!scroll &&
      item.y >= scroll.y - 1 &&
      item.y + item.height <= scroll.y + scroll.height + 1
    )
  }, 'selected option scrolls into view')
}
async function typeNative(text: string): Promise<void> {
  const input = Bun.spawn(['/usr/bin/xdotool', 'type', '--clearmodifiers', '--', text], {
    stdout: 'ignore',
    stderr: 'inherit',
  })
  assert.equal(await input.exited, 0, 'native text input')
}
async function pressNative(...keys: string[]): Promise<void> {
  const input = Bun.spawn(['/usr/bin/xdotool', 'key', '--clearmodifiers', ...keys], {
    stdout: 'ignore',
    stderr: 'inherit',
  })
  assert.equal(await input.exited, 0, `native ${keys.join(', ')}`)
}

async function checkArrowHistory(): Promise<void> {
  const currentText = () => composerStore.get().get(composerKey)?.text ?? ''
  const expectText = async (text: string, ...keys: string[]) => {
    await pressNative(...keys)
    await until(() => currentText() === text, `draft after ${keys.join(', ')}`)
  }
  const long = 'more words in one message '.repeat(14).trimEnd()
  const latest = 'most recent message'
  const unsent = 'an unsent draft'
  await draft(long)
  await expectText('', 'Return')
  await draft(latest)
  await expectText('', 'Return')
  assert.deepEqual(sent.slice(-2), [long, latest])

  await expectText(latest, 'Up')
  await expectText('', 'Down')
  await draft(unsent)
  await expectText(long, 'Up', 'Up')
  await expectText(unsent, 'Down', 'Down')
  await expectText(latest, 'Up')

  // Both arrows must move the native caret inside soft-wrapped text. Typing
  // distinct characters after each key makes their movement observable.
  await draft(long)
  assert(paintedBounds('chat-input').height > 20, 'fixture wraps without newlines')
  await pressNative('Up', 'x', 'Down', 'y')
  await until(() => currentText().includes('y'), 'editing across wrapped rows')
  const wrappedEdit = currentText()
  assert.equal(wrappedEdit.replace(/[xy]/gu, ''), long)
  assert(
    wrappedEdit.indexOf('x') < long.length && wrappedEdit.indexOf('y') > wrappedEdit.indexOf('x'),
  )

  await draft('first row\nsecond row')
  await pressNative('Up', 'x', 'Down', 'y')
  await until(() => currentText().includes('y'), 'editing across explicit lines')
  const [first, second] = currentText().split('\n')
  assert(first?.includes('x') && second?.includes('y'), currentText())
  assert.equal(currentText().replace(/[xy]/gu, ''), 'first row\nsecond row')
}

let incoming = 0
let traffic: ReturnType<typeof setInterval> | undefined
const screenshots: string[] = []
try {
  await manager.start()
  await until(
    () => !!renderer && nodes().some((node) => node.testId === 'chat-input'),
    'real composer',
  )
  await focusNativeQaWindow('TwirChat')
  assert.equal((await backend.api.getAccounts()).length, 0, 'No real credentials')
  app.accountsStore.set([
    {
      id: 'qa-kick-account',
      platform: 'kick',
      platformUserId: '9000',
      username: 'qa-sender',
      displayName: 'QA Sender',
      scopes: [],
      createdAt: 0,
      updatedAt: 0,
    },
    twitchAccount,
  ])
  traffic = setInterval(() => {
    incoming++
    const active = app.activeWatchedTabStore.get() === twitchTabId ? twitchChannel : channel
    const message: NormalizedChatMessage = {
      id: `live-${incoming}`,
      platform: active.platform,
      channelId: active.channelSlug,
      type: 'message',
      text: `LIVE_${incoming}`,
      timestamp: new Date(),
      emotes: [],
      author: { id: 'qa-viewer', username: 'qa-viewer', displayName: 'QA Viewer', badges: [] },
    }
    backend.events.emit('watched_channel_message', { channelId: active.id, message })
  }, 20)
  /* eslint-disable no-await-in-loop -- Each native action depends on the preceding UI state. */
  for (const size of [
    { width: 420, height: 300 },
    { width: 900, height: 600 },
  ]) {
    const beforeTwir = twirRequests
    await currentRenderer().setWindowBounds(size)
    await draft('')
    currentRenderer().focusElement(find('chat-input').id)
    await Bun.sleep(100)
    await typeNative('/')
    await until(() => selectedLabel() === '/command00', 'command popup')
    const startTotal = app.chatActivityStore.get().get(channel.id)?.total ?? 0
    await pressNative('Down', 'Down', 'Up')
    await until(() => selectedLabel() === '/command01', 'Rapid arrows update selection')
    await selectKey('up', '/command00')
    await selectKey('up', '/twirreload')
    await selectKey('down', '/command00')
    await typeNative('command')
    await until(() => selectedLabel() === '/command00', 'Filtered slash commands')
    await selectKey('up', '/command19')
    await selectKey('down', '/command00')
    for (let index = 1; index < 20; index++) {
      await selectKey('down', `/command${String(index).padStart(2, '0')}`)
    }
    const popup = paintedBounds('autocomplete-popup')
    const viewport = paintedBounds('autocomplete-viewport')
    const composer = paintedBounds('composer-frame')
    assert(popup.x >= 7 && popup.x + popup.width <= size.width - 7, 'Popup stays inside window')
    assert(popup.y >= 7 && popup.y + popup.height <= composer.y - 4, 'Popup stays above input')
    assert(
      viewport.height <= 240 && viewport.width <= composer.width,
      'Bounded native scroll viewport',
    )
    assert(
      (app.chatActivityStore.get().get(channel.id)?.total ?? 0) > startTotal + 5,
      'Live chat continued while navigating',
    )
    screenshots.push(await captureGuiQaDisplay(`autocomplete-${size.width}`))
    await pressNative('Tab')
    await until(
      () => composerStore.get().get(composerKey)?.text === '/command19 ',
      'Tab inserts selected command',
    )
    assert.equal(sent.length, 0, 'Completion does not send')
    await draft('/')
    await until(() => selectedLabel() === '/command00', 'Reopened completion')
    await selectKey('down', '/command01')
    currentRenderer().simulateKeystrokes('enter')
    await until(
      () => composerStore.get().get(composerKey)?.text === '/command01 ',
      'Enter inserts selected command',
    )
    assert.equal(sent.length, 0)
    await draft('/')
    await until(() => selectedLabel() === '/command00', 'Completion before Escape')
    currentRenderer().simulateKeystrokes('escape')
    await until(
      () => !nodes().some((node) => node.testId === 'autocomplete-popup'),
      'Escape closes completion',
    )
    currentRenderer().simulateKeystrokes('x')
    await until(() => composerStore.get().get(composerKey)?.text === '/x', 'Native typing resumes')

    for (const { key, expectedTab } of [
      { key: 'ctrl+Tab', expectedTab: nextTabId },
      { key: 'alt+Left', expectedTab: 'home' },
    ]) {
      await draft('')
      await typeNative('/')
      await until(() => selectedLabel() === '/command00', `Completion before ${key}`)
      await pressNative(key)
      await until(() => app.activeWatchedTabStore.get() === expectedTab, `${key} changes tab`)
      await until(() => nodes().some((node) => node.testId === 'other-tab'), 'Other tab renders')
      assert(!app.noticeStore.get()?.text.includes('Shortcut failed'), 'No shortcut failure notice')
      app.activeWatchedTabStore.set(tabId)
      await until(() => nodes().some((node) => node.testId === 'chat-input'), 'Watched tab returns')
      currentRenderer().focusElement(find('chat-input').id)
      await Bun.sleep(100)
    }

    await draft('')
    assert.equal(twirRequests, beforeTwir, 'Slash completion never queries Twir')
    const beforeTraffic = app.chatActivityStore.get().get(channel.id)?.total ?? 0
    await typeNative('!')
    await until(() => selectedLabel('!twir') === '!twir00', 'Twir suggestions for bare !')
    for (let index = 1; index < 20; index++) {
      await selectKey('down', `!twir${String(index).padStart(2, '0')}`)
    }
    await selectKey('down', '!quote add')
    await selectKey('down', '!twir00')
    await selectKey('up', '!quote add')
    const twirPopup = paintedBounds('autocomplete-popup')
    assert(twirPopup.x >= 7 && twirPopup.x + twirPopup.width <= size.width - 7)
    assert(twirPopup.y >= 7 && twirPopup.y + twirPopup.height <= composer.y - 4)
    assert((app.chatActivityStore.get().get(channel.id)?.total ?? 0) > beforeTraffic + 5)
    await typeNative('TWIR1')
    await until(() => selectedLabel('!twir') === '!twir10', 'Case-insensitive Twir prefix')
    assert.equal(twirRequests, beforeTwir + 1, 'Typing a prefix reuses the loaded commands')
    currentRenderer().simulateKeystrokes('enter')
    await until(() => composerStore.get().get(composerKey)?.text === '!twir10 ', 'Enter inserts !')
    await until(
      () => !nodes().some((node) => node.testId === 'autocomplete-popup'),
      'Completion closes after the command is inserted',
    )
    assert.equal(sent.length, 0, 'Twir completion only inserts text')
    currentRenderer().simulateKeystrokes('enter')
    await until(() => sent.at(-1) === '!twir10', 'A second Enter sends the command as chat')
    sent.length = 0

    await typeNative('!QUO')
    await until(() => selectedLabel('!quote') === '!quote add', 'Multiword Twir match')
    await pressNative('Return')
    await until(
      () => composerStore.get().get(composerKey)?.text === '!quote add ',
      'Enter inserts the full Twir command',
    )
    assert.equal(sent.length, 0)
    await typeNative('Example')
    assert(!nodes().some((node) => node.testId === 'autocomplete-popup'))
    await pressNative('Return')
    await until(() => sent.at(-1) === '!quote add Example', 'Sends the command with args')
    sent.length = 0
  }
  /* eslint-enable no-await-in-loop */

  await draft('')
  const pending = Promise.withResolvers<void>()
  waitForTwirCommands = pending.promise
  const beforeDisable = twirRequests
  await typeNative('!')
  await until(() => twirRequests === beforeDisable + 1, 'Twir request started')
  app.settingsStore.update({ twirIntegrationEnabled: false })
  await Bun.sleep(60)
  pending.resolve()
  await draft('')
  await typeNative('!')
  await until(() => composerStore.get().get(composerKey)?.text === '!', 'Disabled ! draft')
  await Bun.sleep(100)
  assert.equal(twirRequests, beforeDisable + 1)
  assert(!nodes().some((node) => node.testId === 'autocomplete-popup'))
  await draft('/twirreload ')
  currentRenderer().simulateKeystrokes('enter')
  await until(
    () => nodes().some((node) => node.text && /Twir.*disabled/iu.test(node.text)),
    'Reload reports disabled integration',
  )
  assert.equal(twirRequests, beforeDisable + 1)
  assert.equal(sent.length, 0)
  await draft('!')
  app.settingsStore.update({ twirIntegrationEnabled: true })
  await until(() => selectedLabel('!twir') === '!twir00', 'Re-enable Twir completion')
  currentRenderer().simulateKeystrokes('escape')
  await until(
    () => !nodes().some((node) => node.testId === 'autocomplete-popup'),
    'Escape closes bare !',
  )

  await draft('')
  await typeNative('/twirre')
  await until(() => selectedLabel('/twirreload') === '/twirreload', 'Reload slash suggestion')
  currentRenderer().simulateKeystrokes('enter')
  await until(
    () => composerStore.get().get(composerKey)?.text === '/twirreload ',
    'Selecting reload inserts the command',
  )
  await until(() => !selectedLabel('/twirreload'), 'Reload suggestion closes after insertion')
  assert.equal(twirReloads, 0)
  currentRenderer().simulateKeystrokes('enter')
  await until(
    () => app.noticeStore.get()?.text === 'Twir commands reloaded.',
    'Reload reports success',
  )
  await until(() => composerStore.get().get(composerKey)?.text === '', 'Reload clears the draft')
  assert.equal(twirReloads, 1)
  assert.equal(sent.length, 0, 'Reload stays local')
  await typeNative('!')
  await until(() => selectedLabel('!updated') === '!updated', 'Autocomplete uses reloaded commands')

  // Remove the deliberate shortcut conflict used by the autocomplete checks.
  actionBindingsStore.update({ value: { legacyNavigation: false, bindings: [] } })
  const beforeHistory = app.chatActivityStore.get().get(channel.id)?.total ?? 0
  /* eslint-disable no-await-in-loop -- Each native check uses the resized window. */
  for (const width of [420, 900]) {
    await currentRenderer().setWindowBounds({ width, height: 480 })
    await checkArrowHistory()
  }
  /* eslint-enable no-await-in-loop */
  assert((app.chatActivityStore.get().get(channel.id)?.total ?? 0) > beforeHistory + 5)
  assert.equal(fossabotRequests, 0, 'Kick completion never requests Fossabot commands')
  assert.equal(nightbotRequests, 0)
  await draft('')
  await typeNative('$$')
  await until(() => composerStore.get().get(composerKey)?.text === '$$', 'Kick draft')
  assert(!nodes().some((node) => node.testId === 'autocomplete-popup'))
  assert.equal(potatRequests, 0)
  assert.equal(supibotUsers.length, 0)

  const kickInputId = find('chat-input').id
  const sentBeforeFossabot = sent.length
  app.settingsStore.update({ twirIntegrationEnabled: false })
  app.activeWatchedTabStore.set(twitchTabId)
  const twitchDraft = () => composerStore.get().get(twitchComposerKey)?.text
  await until(
    () => nodes().some((node) => node.testId === 'chat-input' && node.id !== kickInputId),
    'Twitch composer',
  )
  currentRenderer().focusElement(find('chat-input').id)
  const beforeTwitchTraffic = app.chatActivityStore.get().get(twitchChannel.id)?.total ?? 0
  /* eslint-disable no-await-in-loop -- Each native check uses the resized window. */
  for (const size of [
    { width: 420, height: 300 },
    { width: 900, height: 600 },
  ]) {
    await currentRenderer().setWindowBounds(size)
    await pressNative('ctrl+a', 'BackSpace')
    const before: number = fossabotRequests
    await typeNative('!')
    await until(() => selectedLabel('!sens') === '!sens', 'Fossabot primary command')
    await selectKey('up', '!fixture311')
    await selectKey('down', '!sens')
    await typeNative('SENSI')
    await until(() => selectedLabel('!sens') === '!sensitivity', 'Fossabot alias prefix')
    const popup = paintedBounds('autocomplete-popup')
    assert(popup.x >= 7 && popup.x + popup.width <= size.width - 7)
    assert(popup.y >= 7 && popup.y + popup.height <= size.height - 7)
    assert(flatten(find('autocomplete-selected')).some((node) => node.text === 'Fossabot'))
    await pressNative('Tab')
    await until(() => twitchDraft() === '!sensitivity ', 'Fossabot alias inserted')
    await typeNative('example')
    await until(() => twitchDraft() === '!sensitivity example', 'Typing arguments stays usable')
    assert.equal(fossabotRequests, before + 1, 'Only the command prefix requests Fossabot commands')
    assert(!nodes().some((node) => node.testId === 'autocomplete-popup'))
  }
  /* eslint-enable no-await-in-loop */
  assert((app.chatActivityStore.get().get(twitchChannel.id)?.total ?? 0) > beforeTwitchTraffic + 5)
  assert.equal(sent.length, sentBeforeFossabot, 'Fossabot completion does not send a message')
  app.settingsStore.update({ fossabotIntegrationEnabled: false })
  const beforeFossabotDisabled = fossabotRequests
  await pressNative('ctrl+a', 'BackSpace')
  await typeNative('!sens')
  await until(() => twitchDraft() === '!sens', 'Typing while Fossabot is disabled')
  assert.equal(fossabotRequests, beforeFossabotDisabled)
  assert(!nodes().some((node) => node.testId === 'autocomplete-popup'))

  app.settingsStore.update({ fossabotIntegrationEnabled: true, nightbotIntegrationEnabled: true })
  await until(() => nightbotRequests === 1, 'Nightbot request')
  await until(() => {
    const tree = nodes()
    const first = tree.find((node) => node.testId === 'autocomplete-selected')
    const nightbot = tree.find((node) => node.testId === 'autocomplete-option-2')
    return (
      !!first &&
      flatten(first).some((node) => node.text === 'Fossabot') &&
      !!nightbot &&
      flatten(nightbot).some((node) => node.text === 'Nightbot')
    )
  }, 'Fossabot and Nightbot suggestions coexist in provider order')
  await pressNative('ctrl+a', 'BackSpace')
  await typeNative('!NIGHTT')
  await until(() => selectedLabel('!night') === '!nighttimer', 'Nightbot command prefix')
  assert(flatten(find('autocomplete-selected')).some((node) => node.text === 'Nightbot'))
  await pressNative('Tab')
  await until(() => twitchDraft() === '!nighttimer ', 'Nightbot command inserted')
  assert.equal(sent.length, sentBeforeFossabot, 'Nightbot completion does not send a message')
  assert.equal(nightbotRequests, 2, 'Typing a prefix reuses Nightbot suggestions')

  /* eslint-disable no-await-in-loop -- Each native check uses the resized window. */
  for (const size of [
    { width: 420, height: 300 },
    { width: 900, height: 600 },
  ]) {
    await currentRenderer().setWindowBounds(size)
    await pressNative('ctrl+a', 'BackSpace')
    await typeNative('~~PO')
    await until(() => selectedLabel('~~') === '~~potato', 'Potat custom prefix')
    const popup = paintedBounds('autocomplete-popup')
    assert(popup.x >= 7 && popup.x + popup.width <= size.width - 7)
    assert(popup.y >= 7 && popup.y + popup.height <= size.height - 7)
    assert(flatten(find('autocomplete-selected')).some((node) => node.text === 'PotatBotat'))
    await pressNative('Escape')
    await until(() => !selectedLabel('~~'), 'Escape closes Potat autocomplete')
    await typeNative('T')
    await until(() => selectedLabel('~~') === '~~potato', 'Editing reopens Potat autocomplete')
    await pressNative('Tab')
    await until(() => twitchDraft() === '~~potato ', 'Potat custom prefix inserted')
    await pressNative('ctrl+a', 'BackSpace')
    await typeNative('#p')
    await until(() => selectedLabel('#') === '#potato', 'Potat default prefix')
    await pressNative('Tab')
    await until(() => twitchDraft() === '#potato ', 'Potat command inserted')

    await pressNative('ctrl+a', 'BackSpace')
    await typeNative('$')
    await until(() => selectedLabel('$') === '$ping', 'Supibot global command')
    assert(!nodes().some((node) => node.text === '$$ping'))
    await typeNative('$')
    await until(() => selectedLabel('$$') === '$$ping', 'Supibot personal alias')
    assert(!nodes().some((node) => node.text === '$ping'))
    await pressNative('Tab')
    await until(() => twitchDraft() === '$$ping ', 'Supibot alias inserted')
  }
  /* eslint-enable no-await-in-loop */
  await pressNative('ctrl+a', 'BackSpace')
  await typeNative('$$')
  await until(() => selectedLabel('$$') === '$$ping', 'Original Supibot account alias')
  const alternateAccount: Account = {
    ...twitchAccount,
    id: 'qa-other-account',
    platformUserId: '9002',
    username: 'qa_other',
  }
  app.accountsStore.set(
    app.accountsStore
      .get()
      .map((account) => (account.id === twitchAccount.id ? alternateAccount : account)),
  )
  await until(() => selectedLabel('$$') === '$$other', 'Supibot alias follows the sending account')
  assert(!nodes().some((node) => node.text === '$$ping'))
  assert(supibotUsers.includes('qa_twitch_sender'))
  assert(supibotUsers.includes('qa_other'))
  assert.equal(sent.length, sentBeforeFossabot, 'Selecting either bot never sends a message')
  app.settingsStore.update({ potatIntegrationEnabled: false, supibotIntegrationEnabled: false })
  await until(() => !selectedLabel('$$'), 'Disabling Supibot clears its suggestions')
  const beforeDisabled = { potatRequests, supibotRequests: supibotUsers.length }
  await pressNative('ctrl+a', 'BackSpace')
  await typeNative('~~po')
  await until(() => twitchDraft() === '~~po', 'Typing while Potat is disabled')
  assert(!nodes().some((node) => node.testId === 'autocomplete-popup'))
  assert.deepEqual({ potatRequests, supibotRequests: supibotUsers.length }, beforeDisabled)

  await Bun.write(
    join(session, 'autocomplete-result.json'),
    JSON.stringify(
      { ok: true, incoming, fossabotRequests, nightbotRequests, potatRequests, screenshots },
      null,
      2,
    ),
  )
  console.log('Native autocomplete and arrow history QA passed during live chat traffic.')
} catch (error) {
  process.exitCode = 1
  await captureGuiQaDisplay('autocomplete-failure').catch(() => undefined)
  await Bun.write(
    join(session, 'autocomplete-debug.json'),
    JSON.stringify(
      {
        error: String(error),
        notice: app.noticeStore.get(),
        activeTab: app.activeWatchedTabStore.get(),
        composer: composerStore.get().get(composerKey),
        painted: renderer?.getPaintedText(),
        tree: renderer ? automationSchema.parse(JSON.parse(renderer.getAutomationTree())) : null,
      },
      null,
      2,
    ),
  )
  console.error(error)
} finally {
  if (traffic) clearInterval(traffic)
  stopHotkeys()
  stopMessages()
  await manager.quit()
  await Bun.sleep(100)
  process.exit(process.exitCode ?? 0)
}
