import assert from 'node:assert/strict'

import type { NormalizedChatMessage, WatchedChannel } from '@twirchat/shared/types'
import { z } from 'zod'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { focusNativeQaWindow, getNativeQaWindowGeometry } from './qa-x11'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { registerHotkeyActions } = await import('../src/gpuix/state/hotkeys')
const { chatPauseStore } = await import('../src/gpuix/state/chat-pause')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const app = await import('../src/gpuix/state/app')

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
  id: 'thread-qa',
  platform: 'twitch',
  channelSlug: 'thread-qa',
  displayName: 'Thread QA',
  createdAt: 0,
}
const backend = getDesktopBackend()
const sent: Parameters<typeof backend.api.sendWatchedChannelMessage>[0][] = []
backend.api.sendWatchedChannelMessage = async (payload) => {
  sent.push(payload)
  return undefined
}
backend.api.getChannelEmotes = async () => []
backend.api.getModerationCapabilities = async () => ({ canModerate: false })
app.accountsStore.set([
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
      <ChatView paneId="thread-qa" watchedChannel={channel} />
    </div>
  )
}
const manager = new DesktopWindowManager(
  backend,
  () => <Content />,
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
function incoming(id: string, text: string, parent?: NormalizedChatMessage) {
  const message: NormalizedChatMessage = {
    id,
    text,
    platform: 'twitch',
    channelId: channel.channelSlug,
    type: 'message',
    timestamp: new Date(timestamp++),
    author: { id: 'viewer', username: 'viewer', displayName: 'Viewer', badges: [] },
    emotes: [],
    reply: parent
      ? {
          parentMessageId: parent.id,
          parentMessageText: parent.text,
          parentAuthor: { id: parent.author.id, username: 'viewer', displayName: 'Viewer' },
          threadRootMessageId: parent.reply?.threadRootMessageId ?? parent.id,
        }
      : undefined,
  }
  backend.events.emit('watched_channel_message', { channelId: channel.id, message })
  return message
}

try {
  await manager.start()
  await until(() => renderer && find('chat-input'), 'normal chat pane')
  await focusNativeQaWindow('TwirChat')
  const root = incoming('root', 'ROOT OF THE THREAD')
  incoming('unrelated', 'UNRELATED NORMAL MESSAGE')
  const child = incoming('child', 'FIRST THREAD REPLY', root)
  await until(() => find('chat-thread-open-child') && painted('FIRST'), 'reply preview')
  click('chat-thread-open-child')
  await until(() => find('chat-thread-panel') && painted('ROOT'), 'thread overlay')
  assert(find('chat-thread-reply-child'))
  assert(!find('chat-thread-reply-unrelated'))
  await captureGuiQaDisplay('chat-thread-normal')

  for (let index = 0; index < 32; index++)
    incoming(`reply-${index}`, `THREAD_FOLLOWUP_${index}`, child)
  await until(() => find('chat-thread-reply-reply-31'), 'incoming thread reply')
  click('chat-thread-panel', 5, 35)
  await until(() => painted('THREAD_FOLLOWUP_31'), 'scroll discussion to latest reply')
  const live = 'ORDINARY_CHAT_CONTINUES'
  incoming('ordinary', live)
  input('key', 'Escape')
  await until(() => !find('chat-thread-panel') && painted(live), 'escape returns to live chat')

  app.settingsStore.set({ ...DEFAULT_SETTINGS, chatTheme: 'compact', showAvatars: false })
  await nativeWindow(current()).setWindowBounds({ width: 580, height: 420 })
  await until(() => bounds('chat-messages').height < 400, 'small chat viewport')
  click('chat-input')
  input('type', 'unsent thread draft')
  incoming('compact-trigger', 'COMPACT THREAD REPLY', child)
  await until(
    () => find('chat-thread-open-compact-trigger') && painted('COMPACT'),
    'compact reply preview',
  )
  const trigger = find('chat-thread-open-compact-trigger')
  assert(trigger)
  current().focusElement(trigger.id)
  await until(() => current().getFocusedElementId() === trigger.id, 'focus compact reply preview')
  input('key', 'Return')
  await until(() => find('chat-thread-close'), 'thread overlay at small size')
  const panel = bounds('chat-thread-panel')
  const chat = bounds('chat-messages')
  assert(panel.height > 90 && panel.y >= chat.y && panel.y + panel.height <= chat.y + chat.height)
  await captureGuiQaDisplay('chat-thread-small')
  click('chat-thread-close')
  await until(() => !find('chat-thread-panel'), 'close button dismisses discussion')

  click('chat-thread-open-compact-trigger')
  await until(() => find('chat-thread-reply'), 'reply from discussion')
  click('chat-thread-reply')
  await until(() => !find('chat-thread-panel') && find('cancel-reply'), 'composer reply target')
  input('key', 'Return')
  await until(() => sent.length === 1, 'send existing draft as reply')
  assert.deepEqual(sent[0], {
    id: channel.id,
    text: 'unsent thread draft',
    replyTo: root.id,
    accountId: 'qa-account',
  })
  console.log('Native chat thread QA passed at normal and small window sizes.')
} finally {
  stopHotkeys()
  stopMessages()
  await manager.quit()
  backend.dispose?.()
}
process.exit(0)
