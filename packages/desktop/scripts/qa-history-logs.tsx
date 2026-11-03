import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import { chatMessageIdentity } from '@twirchat/shared/message-identity'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

import type { DesktopApi } from '../src/gpuix/backend/api'
import type { NativeWindowControls } from '../src/gpuix/native-window'
import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import type { UserChatHistoryPage } from '../src/shared/rpc'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { UserChatHistoryPanel } =
  await import('../src/gpuix/components/user-card/UserChatHistoryPanel')
const { ChatHistoryPanel } = await import('../src/gpuix/components/ChatHistoryPanel')
const { ChatLoggingSettings } = await import('../src/gpuix/components/ChatLoggingSettings')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
const { emotePreferencesStore } = await import('../src/gpuix/state/emote-preferences')
const { imageSnapshot } = await import('../src/gpuix/state/image-cache')
const { getDbPath } = await import('../src/runtime-config')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { focusNativeQaWindow } = await import('./qa-x11')
const sharp = (await import('sharp')).default

interface AutomationNode {
  id: number
  type: string
  testId?: string
  text?: string
  children: AutomationNode[]
}
const automationSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    type: z.string(),
    testId: z.string().optional(),
    text: z.string().optional(),
    children: z.array(automationSchema).default([]),
  }),
)
type Renderer = GpuixRenderer & NativeWindowControls
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
const backend = getDesktopBackend()
const asset = process.argv[2]
assert(asset, 'Pass the public RAGEY GIF as an absolute path for the private launcher to bind.')
const imageUrl = 'https://cdn.7tv.app/emote/01GBFAYKGR000FWWN7MDZZ8XQN/4x.gif'
const cache = join(dirname(getDbPath()), 'image-cache')
await mkdir(cache, { recursive: true })
await Bun.write(
  join(cache, `${createHash('sha256').update(imageUrl).digest('hex').slice(0, 32)}.gif`),
  Bun.file(asset),
)
const pendingImages = new Set<ReturnType<typeof Promise.withResolvers<Response>>>()
const imageServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch() {
    const response = Promise.withResolvers<Response>()
    pendingImages.add(response)
    return response.promise
  },
})
const pendingUrl = `http://127.0.0.1:${imageServer.port}/pending`
backend.api.getUserCosmetics = async () => null
backend.api.getChannelEmotes = async () => []
emotePreferencesStore.update({
  value: {
    ...emotePreferencesStore.get().value,
    badges: false,
    paints: false,
    personal: false,
  },
})

function message(
  id: string,
  time: number,
  text: string,
  channelId = 'satont',
): NormalizedChatMessage {
  return {
    id,
    platform: 'twitch',
    channelId,
    author: { id: '42', username: 'viewer', displayName: 'QA Viewer', badges: [] },
    text,
    emotes: [],
    timestamp: new Date(time),
    type: 'message',
  }
}
const first = message('one', 1000, 'HISTORY_ONE')
const artwork = {
  ...message('artwork', 2000, 'ARTWORK_MARKER RAGEY'),
  emotes: [
    {
      id: '01GBFAYKGR000FWWN7MDZZ8XQN',
      name: 'RAGEY',
      imageUrl,
      animated: true,
      aspectRatio: 1.4,
      positions: [{ start: 15, end: 19 }],
    },
  ],
}
const live = message('live', 3000, 'LIVE_DURING_FETCH')
const older = message('older', 500, 'OLDER_MARKER')
const partialHistory: NonNullable<UserChatHistoryPage['history']> = {
  partial: true,
  truncated: false,
  sources: [
    { id: 'recent', kind: 'recent', status: 'ok', messages: 2, capabilities: ['recent'] },
    {
      id: 'archive',
      kind: 'archive',
      status: 'unavailable',
      messages: 0,
      capabilities: ['user', 'time'],
    },
  ],
}
function page(messages: NormalizedChatMessage[], hasMore = false): UserChatHistoryPage {
  return {
    messages,
    hasMore,
    nextCursor: hasMore
      ? { id: first.id, createdAt: 1000, platform: 'twitch', channelId: 'satont' }
      : null,
    history: partialHistory,
  }
}
const userRequests: Array<Parameters<DesktopApi['getUserChatHistory']>[0]> = []
const channelRequests: Array<Parameters<DesktopApi['getChatHistory']>[0]> = []
const initial = Promise.withResolvers<UserChatHistoryPage>()
let pendingRefresh: ReturnType<typeof Promise.withResolvers<UserChatHistoryPage>> | undefined
let unavailable = false
backend.api.getUserChatHistory = async (params) => {
  userRequests.push(params)
  if (params.platformUserId === '43')
    return page([
      {
        ...message('other-user', 4000, 'OTHER_USER_MARKER'),
        author: { id: '43', displayName: 'Other', badges: [] },
      },
    ])
  if (userRequests.length === 1) return initial.promise
  if (pendingRefresh) {
    const response = pendingRefresh
    pendingRefresh = undefined
    return response.promise
  }
  if (unavailable)
    return { ...page([]), history: { ...partialHistory, error: 'History backend unavailable' } }
  return params.cursor ? page([older, first, older]) : page([first, first, artwork], true)
}
backend.api.getChatHistory = async (params) => {
  channelRequests.push(params)
  return params.cursor ? page([older, first, older]) : page([first, first, artwork], true)
}
const savedChoices: boolean[] = []
const saveSettings = backend.api.saveChatLoggingSettings.bind(backend.api)
backend.api.saveChatLoggingSettings = async (settings) => {
  savedChoices.push(settings.twitchHistoryEnabled)
  await saveSettings(settings)
}
const mode = createStore<'user' | 'channel' | 'settings'>('user')
const target = createStore({ platformUserId: '42', username: 'viewer' })
let renderer: Renderer | undefined
function Content() {
  const active = useGpuixRequired()
  const selected = useStore(mode)
  const user = useStore(target)
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    renderer = nativeWindow(active)
  }, [active])
  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'scroll', backgroundColor: '#16161c' }}>
      {selected === 'user' ? (
        <UserChatHistoryPanel platform="twitch" channelId="#Satont" {...user} />
      ) : selected === 'channel' ? (
        <ChatHistoryPanel
          channel={{ platform: 'twitch', channelId: 'satont' }}
          onClose={() => mode.set('user')}
        />
      ) : (
        <ChatLoggingSettings />
      )}
    </div>
  )
}
const manager = new DesktopWindowManager(
  backend,
  () => <Content />,
  () => {},
)
function current(): Renderer {
  assert(renderer)
  return renderer
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function tree(): AutomationNode {
  return automationSchema.parse(JSON.parse(current().getAutomationTree()))
}
function nodes(): AutomationNode[] {
  return flatten(tree())
}
function find(testId: string): AutomationNode {
  const node = nodes().find((entry) => entry.testId === testId)
  assert(node, `Missing ${testId}`)
  return node
}
function button(label: string, node = tree()): AutomationNode | undefined {
  const nested = node.children
    .map((child) => button(label, child))
    .find((child) => child !== undefined)
  if (nested) return nested
  return node.type === 'div' && flatten(node).some((child) => child.text === label)
    ? node
    : undefined
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(20)
  }
}
async function activate(label: string, key = 'enter'): Promise<void> {
  const node = button(label)
  assert(node, `Missing control ${label}`)
  current().scrollIntoView(node.id)
  await Bun.sleep(80)
  current().focusElement(node.id)
  current().simulateKeystrokes(key)
  await Bun.sleep(80)
}
function rows(prefix: string): AutomationNode[] {
  return nodes().filter((node) => node.testId?.startsWith(prefix))
}
function assertRows(prefix: string, expected: NormalizedChatMessage[]): void {
  const ids = rows(prefix)
    .map((node) => node.testId ?? '')
    .sort((a, b) => a.localeCompare(b))
  assert.deepEqual(
    ids,
    expected
      .map((entry) => `${prefix}${chatMessageIdentity(entry)}`)
      .sort((a, b) => a.localeCompare(b)),
  )
}
function emit(message: NormalizedChatMessage): void {
  backend.events.emit('chat_message', message)
  backend.events.emit('watched_channel_message', { channelId: 'watched-qa', message })
}
const screenshots: string[] = []
let artworkPixels = 0
try {
  await manager.start()
  await until(() => !!renderer && userRequests.length === 1, 'deferred user history request')
  await current().setWindowBounds({ width: 900, height: 650 })
  await focusNativeQaWindow('TwirChat')
  assert.equal(userRequests[0]?.channelId, '#Satont')
  assert.equal(userRequests[0]?.username, 'viewer')
  emit(message('wrong-channel', 3000, 'WRONG_CHANNEL', 'other'))
  emit({
    ...message('wrong-user', 3000, 'WRONG_USER'),
    author: { id: '44', displayName: 'Wrong', badges: [] },
  })
  emit(live)
  await until(() => rows('user-history-message-').length === 1, 'live row before snapshot')
  initial.resolve(page([first, first, artwork], true))
  await until(() => rows('user-history-message-').length === 3, 'deduplicated initial history')
  assertRows('user-history-message-', [first, artwork, live])
  assert(nodes().some((node) => node.text?.includes('Some history sources are unavailable')))
  await until(() => typeof imageSnapshot(imageUrl) === 'string', 'cached emote ready')
  await Bun.sleep(400)
  const loaded = await captureGuiQaDisplay('history-artwork-loaded')
  emit({ ...artwork, emotes: artwork.emotes.map((emote) => ({ ...emote, imageUrl: pendingUrl })) })
  await until(() => pendingImages.size > 0, 'pending emote request')
  await Bun.sleep(100)
  const pending = await captureGuiQaDisplay('history-artwork-pending')
  const [a, b] = await Promise.all(
    [loaded, pending].map((path) =>
      sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  )
  assert(a && b)
  assert.equal(a.data.length, b.data.length)
  let left = a.info.width,
    top = a.info.height,
    right = 0,
    bottom = 0
  for (let offset = 0; offset < a.data.length; offset += 4)
    if (
      [0, 1, 2].some(
        (channel) =>
          Math.abs((a.data[offset + channel] ?? 0) - (b.data[offset + channel] ?? 0)) > 15,
      )
    ) {
      artworkPixels++
      const x = (offset / 4) % a.info.width
      const y = Math.floor(offset / 4 / a.info.width)
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  assert(artworkPixels > 30, 'Actual image pixels must differ from an empty/failed artwork slot.')
  assert(right - left < 80 && bottom - top < 60, 'Image pixels must stay in the emote slot.')
  screenshots.push(loaded, pending)
  emit(artwork)
  await activate('Load older messages')
  await until(() => rows('user-history-message-').length === 4, 'older page deduplicated')
  assertRows('user-history-message-', [older, first, artwork, live])
  const updated = { ...first, text: 'LIVE_AUTHORITATIVE_UPDATE' }
  emit(updated)
  await until(
    () =>
      current()
        .getPaintedText()
        .some((text) => text.includes('LIVE_AUTHORITATIVE_UPDATE')),
    'live payload replaces historical copy',
  )
  assertRows('user-history-message-', [older, updated, artwork, live])
  const stale = Promise.withResolvers<UserChatHistoryPage>()
  pendingRefresh = stale
  await activate('Refresh')
  target.set({ platformUserId: '43', username: 'other' })
  await until(
    () =>
      rows('user-history-message-').length === 1 &&
      rows('user-history-message-')[0]?.testId?.endsWith('other-user') === true,
    'new user replaces request scope',
  )
  stale.resolve(page([message('stale', 5000, 'STALE_RESPONSE')]))
  await Bun.sleep(100)
  assert(!nodes().some((node) => node.text?.includes('STALE_RESPONSE')))
  target.set({ platformUserId: '42', username: 'viewer' })
  await until(() => rows('user-history-message-').length === 2, 'restore user history')
  unavailable = true
  await activate('Refresh')
  assertRows('user-history-message-', [first, artwork])
  assert(nodes().some((node) => node.text?.includes('Local messages remain available')))
  unavailable = false
  for (const width of [900, 420]) {
    await current().setWindowBounds({ width, height: 650 })
    await Bun.sleep(150)
    screenshots.push(await captureGuiQaDisplay(`history-user-${width}`))
    mode.set('channel')
    await until(() => rows('history-search-message-').length === 2, 'channel history deduplicated')
    assertRows('history-search-message-', [first, artwork])
    assert.equal(channelRequests.at(-1)?.channelId, 'satont')
    await activate('Load older')
    await until(
      () => rows('history-search-message-').length === 3,
      'channel pagination deduplicated',
    )
    assertRows('history-search-message-', [older, first, artwork])
    current().scrollTo(find('chat-history-panel').id, 0, -10000)
    await Bun.sleep(100)
    current().scrollIntoView(find(`history-search-message-${chatMessageIdentity(artwork)}`).id)
    await Bun.sleep(150)
    assert(
      current()
        .getPaintedText()
        .some((text) => text.includes('ARTWORK_MARKER')),
      'Channel history screenshot must show rendered messages rather than only filters.',
    )
    screenshots.push(await captureGuiQaDisplay(`history-channel-${width}`))
    mode.set('user')
    await until(() => rows('user-history-message-').length === 2, 'user panel remount')
  }
  await current().setWindowBounds({ width: 900, height: 800 })
  mode.set('settings')
  await until(
    () => nodes().some((node) => node.text === 'Load Twitch history through backend'),
    'external history preference',
  )
  await activate('Load Twitch history through backend', 'space')
  const save = find('chat-logging-save')
  current().scrollIntoView(save.id)
  await Bun.sleep(100)
  current().focusElement(save.id)
  current().simulateKeystrokes('enter')
  await until(() => savedChoices.length > 0, 'save opt-out')
  assert.equal(savedChoices.at(-1), false)
  assert.equal((await backend.api.getChatLoggingSettings()).twitchHistoryEnabled, false)
  await Bun.write(
    join(session, 'history-logs-result.json'),
    JSON.stringify(
      { ok: true, userRequests, channelRequests, artworkPixels, savedChoices, screenshots },
      null,
      2,
    ),
  )
} catch (error) {
  await captureGuiQaDisplay('history-logs-failure')
  await Bun.write(
    join(session, 'history-logs-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        text: renderer?.getPaintedText(),
        tree: renderer?.getAutomationTree(),
        userRequests,
        channelRequests,
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  initial.resolve(page([]))
  pendingRefresh?.resolve(page([]))
  await manager.quit()
  backend.dispose?.()
  for (const request of pendingImages) request.resolve(new Response(null, { status: 204 }))
  await imageServer.stop(true)
}
process.exit(0)
