import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type {
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
  id: 'qa-autocomplete-channel',
  platform: 'kick',
  channelSlug: 'qa-autocomplete',
  displayName: 'Autocomplete QA',
  createdAt: 0,
}
const tabId = 'qa-autocomplete'
const paneId = `${tabId}:pane`
const composerKey = `${paneId}:${channel.id}`
const layout: WatchedChannelsLayout = {
  version: 2,
  root: {
    type: 'panel',
    id: 'pane',
    flex: 100,
    content: { type: 'watched', channelId: channel.id },
  },
}
const sent: string[] = []
let twirRequests = 0
let waitForTwirCommands: Promise<void> | undefined
backend.api.getChannelEmotes = async () => []
backend.api.getTwirCommands = async (target) => {
  assert.deepEqual(target, { platform: 'kick', platformChannelId: '12345' })
  twirRequests++
  await waitForTwirCommands
  return Array.from({ length: 20 }, (_, index) => ({
    name: `twir${String(index).padStart(2, '0')}`,
    description: 'A public bot command',
  }))
}
backend.api.sendWatchedChannelMessage = async ({ id, text }) => {
  assert.equal(id, channel.id)
  sent.push(text)
}
app.settingsStore.set({ ...DEFAULT_SETTINGS, chatTheme: 'compact', showAvatars: false })
app.watchedChannelsStore.set([channel])
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
    legacyNavigation: false,
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
  React.useEffect(() => {
    assert(current instanceof NativeRenderer)
    renderer = nativeWindow(current)
    return () => {
      renderer = undefined
    }
  }, [current])
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ChatView paneId={paneId} layoutTabId={tabId} layoutPanelId="pane" watchedChannel={channel} />
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
function selectedLabel(prefix = '/command'): string | undefined {
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
async function selectKey(key: string, index: number, prefix = '/command'): Promise<void> {
  currentRenderer().simulateKeystrokes(key)
  await until(
    () => selectedLabel(prefix) === `${prefix}${String(index).padStart(2, '0')}`,
    `native ${key} selects ${index}`,
  )
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
  ])
  traffic = setInterval(() => {
    incoming++
    const message: NormalizedChatMessage = {
      id: `live-${incoming}`,
      platform: 'kick',
      channelId: channel.channelSlug,
      type: 'message',
      text: `LIVE_${incoming}`,
      timestamp: new Date(),
      emotes: [],
      author: { id: 'qa-viewer', username: 'qa-viewer', displayName: 'QA Viewer', badges: [] },
    }
    backend.events.emit('watched_channel_message', { channelId: channel.id, message })
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
    await draft('/')
    await until(() => selectedLabel() === '/command00', 'command popup')
    const startTotal = app.chatActivityStore.get().get(channel.id)?.total ?? 0
    for (let index = 1; index <= 14; index++) await selectKey('down', index)
    await selectKey('down', 0)
    await selectKey('up', 14)
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
    currentRenderer().simulateKeystrokes('tab')
    await until(
      () => composerStore.get().get(composerKey)?.text === '/command14 ',
      'Tab inserts selected command',
    )
    assert.equal(sent.length, 0, 'Completion does not send')
    await draft('/')
    await until(() => selectedLabel() === '/command00', 'Reopened completion')
    await selectKey('down', 1)
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

    await draft('')
    assert.equal(twirRequests, beforeTwir, 'Slash completion never queries Twir')
    const beforeTraffic = app.chatActivityStore.get().get(channel.id)?.total ?? 0
    await typeNative('!')
    await until(() => selectedLabel('!twir') === '!twir00', 'Twir suggestions for bare !')
    for (let index = 1; index <= 14; index++) await selectKey('down', index, '!twir')
    await selectKey('down', 0, '!twir')
    await selectKey('up', 14, '!twir')
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
  app.settingsStore.update({ twirIntegrationEnabled: true })
  await until(() => selectedLabel('!twir') === '!twir00', 'Re-enable Twir completion')
  currentRenderer().simulateKeystrokes('escape')
  await until(
    () => !nodes().some((node) => node.testId === 'autocomplete-popup'),
    'Escape closes bare !',
  )
  await Bun.write(
    join(session, 'autocomplete-result.json'),
    JSON.stringify({ ok: true, incoming, screenshots }, null, 2),
  )
  console.log('Native slash and Twir autocomplete, selection and live traffic QA passed.')
} catch (error) {
  process.exitCode = 1
  await captureGuiQaDisplay('autocomplete-failure').catch(() => undefined)
  await Bun.write(
    join(session, 'autocomplete-debug.json'),
    JSON.stringify(
      {
        error: String(error),
        notice: app.noticeStore.get(),
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
  stopMessages()
  await manager.quit()
  await Bun.sleep(100)
  process.exit(process.exitCode ?? 0)
}
