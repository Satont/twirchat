if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use qa:gui for the composer fixture.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')

import assert from 'node:assert/strict'
import { join } from 'node:path'

import type {
  Account,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
} from '@twirchat/shared/types'
import { z } from 'zod'

import type { DesktopBackend } from '../src/gpuix/backend/server'
import type { ChatInputProps } from '../src/gpuix/components/ChatInput'

const React = await import('react')
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import('@gpuix/react')
const { BackendContext } = await import('../src/gpuix/backend/context')
const { createDesktopApi } = await import('../src/gpuix/backend/api')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { ChatInput } = await import('../src/gpuix/components/ChatInput')
const { t } = await import('../src/gpuix/i18n')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { ChatAggregator } = await import('../src/chat/aggregator')
const { BackendConnection } = await import('../src/backend-connection')
const { WatchedChannelManager } = await import('../src/watched-channels/manager')
const { setRuntimeConfig } = await import('../src/runtime-config')
const { initDb } = await import('../src/store/db')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { composerStore, updateComposer } = await import('../src/gpuix/state/composer')
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
const kickReplyTarget: NormalizedChatMessage = {
  id: 'qa:kick-reply',
  platform: 'kick',
  channelId: 'qa_kick',
  author: { id: 'qa:reply-user', displayName: 'QA User', badges: [] },
  text: 'kick reply',
  emotes: [],
  timestamp: new Date(0),
  type: 'message',
}
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
function renderKickStatus(status: PlatformStatusInfo['status'], error?: string) {
  renderComposer({
    ...props,
    statuses: {
      ...statuses,
      kick: { platform: 'kick', channelLogin: 'qa_kick', mode: 'authenticated', status, error },
    },
  })
}
function painted(text: string): boolean {
  return renderer.getPaintedText().join(' ').includes(text)
}
async function hoverKick(reason: string) {
  renderer.simulateMouseMove(0, 0)
  await Bun.sleep(50)
  const target = bounds('composer-target-kick')
  renderer.simulateMouseMove(target.x + target.width / 2, target.y + target.height / 2)
  await until(() => painted(reason), 'Kick tooltip shows ' + reason)
}
async function sendHome(keys: string, expected: Platform[]) {
  const text = keys.replaceAll(' ', '')
  const next = submissions.length
  await focus()
  renderer.simulateKeystrokes(keys)
  await until(() => composerStore.get().get('qa:compact-frame')?.text === text, 'typed draft')
  renderer.simulateKeystrokes('enter')
  await until(() => submissions.length === next + 1, 'native Enter sends')
  assert.deepEqual(submissions[next]?.map((target) => target.platform).toSorted(), expected)
}
function checkFrame(minimumEditorWidth: number) {
  const frame = bounds('composer-frame'),
    editor = bounds('chat-input'),
    targets = bounds('composer-targets'),
    emoji = bounds('emote-button'),
    send = bounds('send-button')
  for (const item of [targets, editor, emoji, send]) {
    assert(item.x >= frame.x && item.y >= frame.y, 'control starts inside shared frame')
    assert(
      item.x + item.width <= frame.x + frame.width + 1 &&
        item.y + item.height <= frame.y + frame.height + 1,
      'control ends inside shared frame',
    )
  }
  assert(targets.x + targets.width <= editor.x + 1, 'platform controls do not overlap typing')
  assert(editor.x + editor.width <= emoji.x + 1, 'emoji control does not overlap typing')
  assert(emoji.x + emoji.width <= send.x + 1, 'send control does not overlap emoji')
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

  await focus()
  renderer.simulateKeystrokes('m o u s e')
  await until(
    () => composerStore.get().get('qa:compact-frame')?.text === 'mouse',
    'mouse-send draft',
  )
  await Bun.sleep(100)
  await click('send-button')
  await until(() => submissions.length === 2, 'Send button submits')
  assert.deepEqual(submissions[1]?.map((target) => target.platform).toSorted(), ['kick', 'twitch'])
  assert.equal(composerStore.get().get('qa:compact-frame')?.text, '')
  assert.equal(
    renderer.getFocusedElementId(),
    find('chat-input').id,
    'Send button returns focus to the composer',
  )

  const kickId = find('composer-target-kick').id
  const kickWide = bounds('composer-target-kick')
  renderer.focusElement?.(kickId)
  await until(() => renderer.getFocusedElementId() === kickId, 'connected Kick target focused')
  renderKickStatus('error', 'Kick QA connection dropped')
  await hoverKick('Kick QA connection dropped')
  assert(!painted(t('composer.target.sendingHere')))
  assert(!painted(t('composer.target.clickToEnable')))
  assert.equal(find('composer-target-kick').id, kickId)
  assert.deepEqual(bounds('composer-target-kick'), kickWide)
  const kickErrorScreenshot = await captureGuiQaDisplay('composer-kick-error')
  const preferences = composerStore.get().get('qa:compact-frame')
  renderer.simulateKeystrokes('enter')
  await click('composer-target-kick')
  const afterClick = composerStore.get().get('qa:compact-frame')
  assert.equal(afterClick?.activePlatform, preferences?.activePlatform)
  assert.equal(afterClick?.disabledPlatforms, preferences?.disabledPlatforms)
  assert.equal(submissions.length, 2, 'an unavailable Kick control cannot activate')
  await sendHome('o u t a g e', ['twitch'])

  await nativeWindow(renderer).setWindowBounds({ width: 320, height: 240 })
  await Bun.sleep(160)
  const kickSmall = bounds('composer-target-kick')
  renderKickStatus('connecting')
  await hoverKick(t('composer.connection.connecting', { channel: 'qa_kick' }))
  assert.equal(find('composer-target-kick').id, kickId)
  assert.deepEqual(bounds('composer-target-kick'), kickSmall)
  checkFrame(120)
  updateComposer('qa:compact-frame', (state) => ({ ...state, activePlatform: 'kick' }))
  await until(() => painted(t('chat.empty.waitingConnection')), 'selected Kick waits to connect')
  assert(!painted(t('composer.placeholder.login')))
  const kickConnectingScreenshot = await captureGuiQaDisplay('composer-kick-connecting')
  updateComposer('qa:compact-frame', (state) => ({ ...state, activePlatform: undefined }))
  renderComposer(props)
  await hoverKick(t('composer.target.sendingHere'))
  assert.equal(find('composer-target-kick').id, kickId)
  assert.deepEqual(bounds('composer-target-kick'), kickSmall)
  const kickRecoveredScreenshot = await captureGuiQaDisplay('composer-kick-recovered')
  await sendHome('r e s t o r e d', ['kick', 'twitch'])

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
  const remountedSubmission = submissions.length
  await focus()
  renderer.simulateKeystrokes('n e x t')
  await until(
    () => composerStore.get().get('qa:compact-frame')?.text === 'next',
    'next typed draft',
  )
  await Bun.sleep(80)
  renderer.simulateKeystrokes('enter')
  await until(
    () => submissions.length === remountedSubmission + 1,
    'native Enter preserves toggled platform after remount',
  )
  assert.deepEqual(
    submissions[remountedSubmission]?.map((target) => target.platform),
    ['twitch'],
  )
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

  // A multi-line draft grows the frame: the send control must stay on the
  // bottom row next to the emoji control, not float up with the first line.
  renderComposer(props)
  await until(
    () => nodes().some((node) => node.testId === 'composer-target-twitch'),
    'home composer for multiline evidence',
  )
  const multilineKey = 'qa:compact-frame'
  updateComposer(multilineKey, (state) => ({
    ...state,
    text: 'first line\nsecond line\nthird line',
  }))
  await until(
    () => composerStore.get().get(multilineKey)?.text.split('\n').length === 3,
    'multiline draft',
  )
  await until(() => bounds('composer-frame').height > watched.height + 10, 'multiline frame grows')
  await Bun.sleep(60)
  const multilineEmoji = bounds('emote-button')
  const multilineSend = bounds('send-button')
  assert(
    Math.abs(multilineEmoji.y + multilineEmoji.height - (multilineSend.y + multilineSend.height)) <=
      1,
    'multi-line send control shares the bottom row with the emoji control',
  )
  const multilineCompactScreenshot = await captureGuiQaDisplay('composer-multiline-compact')
  await nativeWindow(renderer).setWindowBounds({ width: 640, height: 320 })
  await Bun.sleep(160)
  const wideMultilineEmoji = bounds('emote-button')
  const wideMultilineSend = bounds('send-button')
  assert(
    Math.abs(
      wideMultilineEmoji.y +
        wideMultilineEmoji.height -
        (wideMultilineSend.y + wideMultilineSend.height),
    ) <= 1,
    'multi-line send control stays on the bottom row in a wide composer',
  )
  const multilineScreenshot = await captureGuiQaDisplay('composer-multiline')
  updateComposer(multilineKey, (state) => ({ ...state, text: '' }))

  updateComposer('qa:compact-frame', (state) => ({
    ...state,
    text: 'reply mismatch',
    activePlatform: 'twitch',
  }))
  renderComposer({ ...props, replyTarget: kickReplyTarget })
  await until(
    () => nodes().some((node) => node.testId === 'composer-target-twitch'),
    'home composer',
  )
  await until(() => painted('QA User'), 'incompatible reply target visible')
  await Bun.sleep(100)
  const beforeMismatch = submissions.length
  await click('send-button')
  await Bun.sleep(150)
  assert.equal(
    submissions.length,
    beforeMismatch,
    'Send button does not send to an incompatible reply target',
  )
  assert(
    !painted(t('composer.error.noPlatform')),
    'Send button stays disabled for an incompatible reply target',
  )

  const result = {
    result: 'pass',
    wide,
    compact,
    watched,
    enterExactlyOnce: true,
    replyTargetMismatchDisabled: true,
    targetRouting: true,
    targetRoutingAfterRemount: true,
    kickReconnect: { kickErrorScreenshot, kickConnectingScreenshot, kickRecoveredScreenshot },
    emoji: true,
    multilineScreenshot,
    multilineCompactScreenshot,
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
