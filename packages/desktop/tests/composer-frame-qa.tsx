if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use qa:gui for the composer fixture.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')

import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { Account, Platform, PlatformStatusInfo } from '@twirchat/shared/types'
import { z } from 'zod'

import type { DesktopBackend } from '../src/gpuix/backend/server'
import type { ChatInputProps } from '../src/gpuix/components/ChatInput'

const React = await import('react')
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import('@gpuix/react')
const { BackendContext } = await import('../src/gpuix/backend/context')
const { createDesktopApi } = await import('../src/gpuix/backend/api')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { ChatInput } = await import('../src/gpuix/components/ChatInput')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { ChatAggregator } = await import('../src/chat/aggregator')
const { BackendConnection } = await import('../src/backend-connection')
const { WatchedChannelManager } = await import('../src/watched-channels/manager')
const { setRuntimeConfig } = await import('../src/runtime-config')
const { initDb } = await import('../src/store/db')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { composerStore } = await import('../src/gpuix/state/composer')
const { focusNativeQaWindow } = await import('../scripts/qa-x11')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const session = process.env.TWIRCHAT_QA_SESSION_DIR
if (!session) throw new Error('Missing isolated QA profile.')
setRuntimeConfig({ dbPath: join(session, 'profile', 'composer-frame.sqlite') })
const database = initDb()
const events = createDesktopEvents()
const backend: DesktopBackend = {
  events,
  api: createDesktopApi({
    events,
    aggregator: new ChatAggregator(),
    backendConn: new BackendConnection('isolated-composer-frame'),
    watchedChannelManager: new WatchedChannelManager(),
    currentStatuses: new Map(),
    openBrowser() {
      throw new Error('Composer QA must not open an external application.')
    },
  }),
}
const platforms: Platform[] = ['twitch', 'kick', 'youtube']
const accounts: Account[] = platforms.map((platform) => ({
  id: `qa:${platform}`,
  platform,
  platformUserId: `qa-${platform}`,
  username: `qa_${platform}`,
  displayName: `QA ${platform}`,
  scopes: [],
  createdAt: 0,
  updatedAt: 0,
}))
const statuses: Partial<Record<Platform, PlatformStatusInfo>> = Object.fromEntries(
  platforms.map((platform) => [
    platform,
    { platform, channelLogin: `qa_${platform}`, status: 'connected', mode: 'authenticated' },
  ]),
)
const submissions: Parameters<ChatInputProps['onSend']>[0][] = []
const props: ChatInputProps = {
  accounts,
  statuses,
  settings: { ...DEFAULT_SETTINGS, showChannelLabel: true },
  composerKey: 'qa:compact-frame',
  onSend(targets) {
    submissions.push(targets)
  },
  onSendWatched() {
    throw new Error('Expected home send targets.')
  },
  onOpenUserCard() {
    throw new Error('Composer frame QA must not open a user card.')
  },
  onCancelReply() {},
}
const renderer = createRenderer()
initializeManagedRenderer(renderer, {
  title: 'TwirChat compact composer QA',
  appId: process.env.TWIRCHAT_QA_APP_ID,
  width: 640,
  height: 320,
  focus: false,
})
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)
function renderComposer(composerProps: ChatInputProps) {
  root.render(
    React.createElement(
      BackendContext.Provider,
      { value: backend },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(
          'div',
          {
            style: {
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              backgroundColor: '#111114',
            },
          },
          React.createElement(ChatInput, composerProps),
        ),
      ),
    ),
  )
}
renderComposer(props)
interface QaNode {
  id: number
  testId?: string
  children: QaNode[]
}
const nodeSchema: z.ZodType<QaNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    children: z
      .array(nodeSchema)
      .nullish()
      .transform((children) => children ?? []),
  }),
)
function nodes(
  node: QaNode = nodeSchema.parse(JSON.parse(renderer.getAutomationTree())),
): QaNode[] {
  return [node, ...node.children.flatMap((child) => nodes(child))]
}
function find(id: string): QaNode {
  const node = nodes().find((candidate) => candidate.testId === id)
  assert(node, `Missing ${id}`)
  return node
}
function bounds(id: string) {
  const value = renderer.getElementBounds(find(id).id)
  assert(value, `Missing painted bounds for ${id}`)
  return value
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
async function focus(): Promise<void> {
  const id = find('chat-input').id
  renderer.focusElement?.(id)
  await until(() => renderer.getFocusedElementId() === id, 'input focus')
  await Bun.sleep(30)
}
async function click(id: string): Promise<void> {
  const target = bounds(id)
  renderer.simulateClick(target.x + target.width / 2, target.y + target.height / 2, 0)
  await Bun.sleep(80)
}
function checkFrame(minimumEditorWidth: number) {
  assert(!nodes().some((node) => node.testId === 'send-button'), 'Send button must not exist')
  const frame = bounds('composer-frame'),
    editor = bounds('chat-input'),
    targets = bounds('composer-targets'),
    emoji = bounds('emote-button')
  for (const item of [targets, editor, emoji]) {
    assert(item.x >= frame.x && item.y >= frame.y, 'control starts inside shared frame')
    assert(
      item.x + item.width <= frame.x + frame.width + 1 &&
        item.y + item.height <= frame.y + frame.height + 1,
      'control ends inside shared frame',
    )
  }
  assert(targets.x + targets.width <= editor.x + 1, 'platform controls do not overlap typing')
  assert(editor.x + editor.width <= emoji.x + 1, 'emoji control does not overlap typing')
  assert(editor.width >= minimumEditorWidth, `Typing width ${editor.width} is too small`)
  assert(frame.height <= 42, `Single-line frame too tall: ${frame.height}`)
  return { width: frame.width, height: frame.height, typingWidth: editor.width }
}
try {
  await focusNativeQaWindow('TwirChat compact composer QA')
  await until(
    () => nodes().some((node) => node.testId === 'composer-target-kick'),
    'supported inline platforms',
  )
  assert(
    !nodes().some((node) => node.testId === 'composer-target-youtube'),
    'Home does not advertise unsupported YouTube sending',
  )
  await focus()
  const wide = checkFrame(350)
  renderer.simulateKeystrokes('h e l l o')
  await until(
    () => composerStore.get().get('qa:compact-frame')?.text === 'hello',
    'first typed draft',
  )
  await Bun.sleep(80)
  renderer.simulateKeystrokes('enter')
  await until(() => submissions.length === 1, 'native Enter sends')
  await Bun.sleep(100)
  assert.equal(submissions.length, 1, 'one native Enter produces one submission')
  assert.deepEqual(submissions[0]?.map((target) => target.platform).toSorted(), ['kick', 'twitch'])
  assert.equal(composerStore.get().get('qa:compact-frame')?.text, '')
  await click('composer-target-kick')
  root.render(React.createElement('div', { testId: 'composer-unmounted' }))
  await until(
    () =>
      nodes().some((node) => node.testId === 'composer-unmounted') &&
      !nodes().some((node) => node.testId === 'chat-input'),
    'composer unmounted between tabs',
  )
  await Bun.sleep(80)
  renderComposer(props)
  await until(
    () => nodes().some((node) => node.testId === 'composer-target-kick'),
    'composer remounted with the same session key',
  )
  await focus()
  renderer.simulateKeystrokes('n e x t')
  await until(
    () => composerStore.get().get('qa:compact-frame')?.text === 'next',
    'next typed draft',
  )
  await Bun.sleep(80)
  renderer.simulateKeystrokes('enter')
  await until(
    () => submissions.length === 2,
    'native Enter preserves toggled platform after remount',
  )
  assert.deepEqual(submissions[1]?.map((target) => target.platform).toSorted(), ['twitch'])
  await nativeWindow(renderer).setWindowBounds({ width: 320, height: 240 })
  await Bun.sleep(160)
  await focus()
  renderer.simulateKeystrokes('s m a l l space w i n d o w')
  await Bun.sleep(150)
  await until(
    () => composerStore.get().get('qa:compact-frame')?.text === 'small window',
    'small-window typing',
  )
  const compact = checkFrame(120)
  const screenshot = await captureGuiQaDisplay('compact-composer')
  await click('emote-button')
  await until(
    () => nodes().some((node) => node.testId === 'emote-popup-search'),
    'inline emoji opens picker',
  )
  renderer.simulateKeystrokes('escape')
  await until(
    () => !nodes().some((node) => node.testId === 'emote-popup-search'),
    'emoji picker dismisses',
  )
  assert.equal(
    composerStore.get().get('qa:compact-frame')?.text,
    'small window',
    'picker keeps the draft',
  )
  const watchedSubmissions: Parameters<ChatInputProps['onSendWatched']>[0][] = []
  renderComposer({
    ...props,
    composerKey: 'qa:watched-youtube',
    watchedChannel: {
      id: 'youtube:qa-channel',
      platform: 'youtube',
      channelSlug: 'UCqaChannel',
      displayName: 'QA YouTube',
      createdAt: 0,
    },
    watchedChannelStatus: {
      platform: 'youtube',
      status: 'connected',
      mode: 'authenticated',
      channelLogin: 'UCqaChannel',
    },
    onSend() {
      throw new Error('Watched YouTube must not use home targets.')
    },
    onSendWatched(payload) {
      watchedSubmissions.push(payload)
    },
  })
  await until(
    () => nodes().some((node) => node.testId === 'composer-target-youtube'),
    'watched YouTube inline control',
  )
  assert(
    !nodes().some((node) => node.testId === 'composer-target-twitch'),
    'watched composer shows only its own platform',
  )
  await focus()
  renderer.simulateKeystrokes('y t')
  await until(
    () => composerStore.get().get('qa:watched-youtube')?.text === 'yt',
    'watched typed draft',
  )
  await Bun.sleep(80)
  renderer.simulateKeystrokes('enter')
  await until(() => watchedSubmissions.length === 1, 'watched native Enter sends')
  await Bun.sleep(100)
  assert.deepEqual(watchedSubmissions, [
    { text: 'yt', channelId: 'youtube:qa-channel', replyToMessageId: undefined },
  ])
  const watched = checkFrame(150)
  const result = {
    result: 'pass',
    wide,
    compact,
    watched,
    enterExactlyOnce: true,
    targetRouting: true,
    targetRoutingAfterRemount: true,
    emoji: true,
    screenshot,
  }
  await Bun.write(join(session, 'composer-frame-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  root.unmount()
  loop.stop()
  nativeWindow(renderer).closeWindow()
  database.close()
}
process.exit(0)
