import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type { Account, ChatSendReceipt, NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

const assets = [
  {
    name: 'flyby',
    url: 'https://ext.cdn.kick.com/chat/badges/Flyby_019f591a-e1bb-7a1a-be0a-97d8d1ae1a91.png',
  },
  {
    name: 'subscriber',
    url: 'https://files.kick.com/channel_subscriber_badges/97968/conversion/original-fullsize.png',
  },
]
const fixtureDirectory = join(import.meta.dir, '../../../.out/qa-kick-badges')
if (Bun.argv.includes('--prepare-fixtures')) {
  await mkdir(fixtureDirectory, { recursive: true })
  for (const asset of assets) {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(15000) })
    assert(response.ok, `Official badge download failed: ${asset.name}`)
    await Bun.write(join(fixtureDirectory, `${asset.name}.png`), await response.arrayBuffer())
  }
  console.log('Official public badge fixtures downloaded; no native renderer was loaded.')
  process.exit(0)
}
if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')

const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { nativeWindow } = await import('../src/gpuix/native-window')
import type { DesktopApi } from '../src/gpuix/backend/api'
import type { NativeWindowControls } from '../src/gpuix/native-window'
const { ChatNotice } = await import('../src/gpuix/components/App')
const { ChatMessage, BadgeList } = await import('../src/gpuix/components/ChatMessage')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { Text } = await import('../src/gpuix/components/ui/Text')
const app = await import('../src/gpuix/state/app')
const { layoutStore } = await import('../src/gpuix/state/layout')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
const { updateComposer, editComposer, composerStore } = await import('../src/gpuix/state/composer')
const { emotePreferencesStore } = await import('../src/gpuix/state/emote-preferences')
const { chatPauseStore } = await import('../src/gpuix/state/chat-pause')
const { normalizeKickChatMessage } = await import('../src/platforms/kick/adapter')
const { normalizeKickBadges } = await import('../src/platforms/kick/badge-data')
const { getKickBadgeSvg } = await import('../src/platforms/kick/badges')
const { getDbPath } = await import('../src/runtime-config')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { focusNativeQaWindow, getNativeQaWindowGeometry } = await import('./qa-x11')
const sharp = (await import('sharp')).default

interface AutomationNode {
  id: number
  testId?: string
  children: AutomationNode[]
}
const automationSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    children: z.array(automationSchema).default([]),
  }),
)
interface PostedMessage {
  params: Parameters<DesktopApi['sendMessage']>[0]
  id: string
  timestamp: Date
  acknowledgement: ReturnType<typeof Promise.withResolvers<void | ChatSendReceipt>>
}
type Renderer = GpuixRenderer & NativeWindowControls
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session, 'Private artifact directory is required.')
const sendOnly = Bun.argv.includes('--send-only')
const mode = createStore<'delivery' | 'appearance'>('delivery')
let renderer: Renderer | undefined
const backend = getDesktopBackend()
if (!sendOnly) {
  const cacheDirectory = join(dirname(getDbPath()), 'image-cache')
  await mkdir(cacheDirectory, { recursive: true })
  for (const asset of assets) {
    const source = Bun.file(join(fixtureDirectory, `${asset.name}.png`))
    assert(await source.exists(), 'Run this script with --prepare-fixtures before isolated QA.')
    const hash = createHash('sha256').update(asset.url).digest('hex').slice(0, 32)
    await Bun.write(join(cacheDirectory, `${hash}.png`), await source.bytes())
  }
}
const avatarUrl = `data:image/png;base64,${(
  await sharp({ create: { width: 128, height: 128, channels: 4, background: '#9176bd' } })
    .png()
    .toBuffer()
).toString('base64')}`
const accounts: Account[] = [
  {
    id: 'qa:twitch',
    platform: 'twitch',
    platformUserId: '12345',
    username: 'oceanofapathy',
    displayName: 'OceanOfApathy',
    avatarUrl,
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'qa:kick',
    platform: 'kick',
    platformUserId: '3195252',
    username: 'satont',
    displayName: 'Satont',
    avatarUrl,
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
]
const posted: PostedMessage[] = []
backend.api.sendMessage = (params) => {
  const acknowledgement = Promise.withResolvers<void | ChatSendReceipt>()
  posted.push({ params, acknowledgement, id: `provider-${posted.length}`, timestamp: new Date() })
  return acknowledgement.promise
}
backend.api.getChannelEmotes = async () => []
app.settingsStore.set({ ...DEFAULT_SETTINGS, chatTheme: 'compact', fontSize: 14 })
app.accountsStore.set(accounts)
app.homeMessagesStore.set([])
app.channelStatusStore.set({
  twitch: {
    platform: 'twitch',
    status: 'connected',
    mode: 'authenticated',
    channelLogin: 'oceanofapathy',
  },
  kick: {
    platform: 'kick',
    status: 'connected',
    mode: 'authenticated',
    channelLogin: 'satont',
    channelId: '3195252',
  },
})
layoutStore.set(
  new Map([
    [
      'home',
      {
        layout: {
          version: 2,
          root: { id: 'qa-panel', type: 'panel', flex: 100, content: { type: 'main' } },
        },
        isLoading: false,
        error: null,
      },
    ],
  ]),
)
chatPauseStore.update({
  value: { ...chatPauseStore.get().value, hoverSeconds: 0, modifier: 'none' },
})
emotePreferencesStore.update({
  value: { ...emotePreferencesStore.get().value, badges: false, paints: false, personal: false },
})
const stopMessages = app.wireBackendToStores(backend)
const roles = ['broadcaster', 'bot', 'founder', 'staff', 'subscriber']
const badgeFixtures = roles.map((role) => {
  assert(getKickBadgeSvg(role), `Official ${role} asset must exist.`)
  return {
    name: role,
    badges: normalizeKickBadges({ badges: [{ type: role, text: role }] }),
  }
})
const flyby = assets.find((asset) => asset.name === 'flyby')
const subscriber = assets.find((asset) => asset.name === 'subscriber')
assert(flyby && subscriber)
badgeFixtures.push(
  {
    name: 'official-v2',
    badges: normalizeKickBadges({
      badges_v2: [
        {
          name: 'Flyby',
          badge_type: 'global',
          image_url: flyby.url,
          selected: true,
          sort_order: 1,
        },
      ],
    }),
  },
  {
    name: 'custom-subscriber',
    badges: normalizeKickBadges(
      { badges: [{ type: 'subscriber', text: 'Subscriber', count: 1 }] },
      [{ months: 1, badge_image: { src: subscriber.url } }],
    ),
  },
)
const times = ['01:11:11', '03:52:59', '08:08:08', '23:59:59']
function timedMessage(time: string, fontSize: number): NormalizedChatMessage {
  const [hour = 0, minute = 0, second = 0] = time.split(':').map(Number)
  return {
    id: `time-${fontSize}-${time}`,
    platform: 'kick',
    channelId: '3195252',
    timestamp: new Date(2026, 10, 3, hour, minute, second),
    author: { id: '3195252', username: 'satont', displayName: 'Satont', avatarUrl, badges: [] },
    text: `Time alignment ${time}`,
    emotes: [],
    type: 'message',
  }
}
function Content() {
  const current = useGpuixRequired()
  const view = useStore(mode)
  React.useEffect(() => {
    assert(current instanceof NativeRenderer)
    renderer = nativeWindow(current)
    return () => {
      renderer = undefined
    }
  }, [current])
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#17161c',
      }}
    >
      {view === 'delivery' ? (
        <>
          <ChatView paneId="qa-pane" layoutTabId="home" layoutPanelId="qa-panel" />
          <ChatNotice />
        </>
      ) : (
        <>
          {[14, 18].flatMap((fontSize) =>
            times.map((time) => (
              <ChatMessage
                key={`${fontSize}-${time}`}
                message={timedMessage(time, fontSize)}
                fontSize={fontSize}
                chatTheme="compact"
                showTimestamp
              />
            )),
          )}
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {badgeFixtures.map((fixture) => (
              <div key={fixture.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div testId={`badge-${fixture.name}`} style={{ width: 18, height: 18 }}>
                  <BadgeList badges={fixture.badges} size={18} />
                </div>
                <Text style={{ color: '#efedf5', fontSize: 12 }}>{fixture.name}</Text>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
const manager = new DesktopWindowManager(
  backend,
  () => <Content />,
  () => {},
)
function native(): Renderer {
  assert(renderer, 'The private native renderer is unavailable.')
  return renderer
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function nodes(): AutomationNode[] {
  return flatten(automationSchema.parse(JSON.parse(native().getAutomationTree())))
}
function find(testId: string): AutomationNode {
  const node = nodes().find((entry) => entry.testId === testId)
  assert(node, `Missing ${testId}`)
  return node
}
function bounds(testId: string) {
  const result = native().getElementBounds(find(testId).id)
  assert(result, `No native bounds for ${testId}`)
  return result
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 7000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(25)
  }
}
function assertVisibleMessages(ids: readonly string[]): void {
  const timestamps = nodes().flatMap((node) =>
    node.testId?.startsWith('chat-timestamp-') ? [node.testId] : [],
  )
  assert.deepEqual(timestamps.sort(), ids.map((id) => `chat-timestamp-${id}`).sort())
}

async function submit(text: string, targets = 2): Promise<PostedMessage[]> {
  const count = posted.length
  updateComposer('qa-pane:home', (state) => editComposer(state, text))
  await Bun.sleep(60)
  native().focusElement(find('chat-input').id)
  await Bun.sleep(30)
  native().simulateKeystrokes('enter')
  await until(() => posted.length === count + targets, 'native Enter submits to expected targets')
  await until(() => composerStore.get().get('qa-pane:home')?.text === '', 'composer clears')
  return posted.slice(count)
}
function acknowledge(request: PostedMessage): void {
  request.acknowledgement.resolve({
    channelId: request.params.platform === 'kick' ? '3195252' : 'oceanofapathy',
    messageId: request.id,
  })
}
async function publish(
  request: PostedMessage,
  reply?: NormalizedChatMessage['reply'],
): Promise<void> {
  const message: NormalizedChatMessage =
    request.params.platform === 'kick'
      ? await normalizeKickChatMessage(
          {
            id: request.id,
            chatroom_id: 3124040,
            content: request.params.text,
            type: 'message',
            created_at: request.timestamp.toISOString(),
            sender: {
              id: 3195252,
              username: 'Satont',
              slug: 'satont',
              identity: {
                color: '#e9113c',
                badges: [{ type: 'broadcaster', text: 'Broadcaster' }],
              },
            },
          },
          3195252,
          async () => avatarUrl,
        )
      : {
          id: request.id,
          platform: 'twitch',
          channelId: 'oceanofapathy',
          timestamp: request.timestamp,
          author: {
            id: '12345',
            username: 'oceanofapathy',
            displayName: 'OceanOfApathy',
            avatarUrl,
            badges: [],
          },
          text: request.params.text,
          emotes: [],
          type: 'message',
          reply,
        }
  backend.events.emit('chat_message', message)
  await until(
    () => nodes().some((node) => node.testId === `chat-timestamp-${request.id}`),
    'the actual provider message appears',
  )
}
const screenshots: string[] = []
const timestampGeometry: Array<{ width: number; fontSize: number; x: number; gap: number }> = []
const badgePixels: Array<{ name: string; painted: number; colorful: number }> = []
async function verifyBadgeLayout(): Promise<void> {
  mode.set('appearance')
  await until(() => nodes().some((node) => node.testId === 'badge-broadcaster'), 'badge fixtures')
  for (const width of [900, 420]) {
    await native().setWindowBounds({ width, height: 760 })
    await Bun.sleep(300)
    for (const fontSize of [14, 18]) {
      const columns = times.map((time) => {
        const timestamp = bounds(`chat-timestamp-time-${fontSize}-${time}`)
        const avatar = bounds(`chat-avatar-time-${fontSize}-${time}`)
        const gap = avatar.x - timestamp.x - timestamp.width
        assert.equal(gap, 6, 'The timestamp gap remains exactly 6px.')
        assert(timestamp.height < fontSize * 2, 'The timestamp stays on a single line.')
        timestampGeometry.push({ width, fontSize, x: avatar.x, gap })
        return avatar.x
      })
      assert.equal(
        new Set(columns).size,
        1,
        'Changing timestamp digits cannot shift the message column.',
      )
    }
    screenshots.push(await captureGuiQaDisplay(`badges-times-${width}`))
  }
  const screenshot = screenshots.at(-1)
  assert(screenshot)
  const geometry = getNativeQaWindowGeometry('TwirChat')
  for (const fixture of badgeFixtures) {
    const box = bounds(`badge-${fixture.name}`)
    const pixels = await sharp(screenshot)
      .extract({
        left: Math.round(geometry.x + box.x),
        top: Math.round(geometry.y + box.y),
        width: 18,
        height: 18,
      })
      .removeAlpha()
      .raw()
      .toBuffer()
    let painted = 0,
      colorful = 0
    for (let offset = 0; offset < pixels.length; offset += 3) {
      const red = pixels[offset] ?? 0,
        green = pixels[offset + 1] ?? 0,
        blue = pixels[offset + 2] ?? 0
      if (Math.max(red, green, blue) > 65) painted++
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 30) colorful++
    }
    assert(painted > 8, `Official ${fixture.name} must paint pixels, not an empty image.`)
    if (fixture.name === 'broadcaster')
      assert(colorful > 8, 'The broadcaster SVG must retain official colors.')
    badgePixels.push({ name: fixture.name, painted, colorful })
  }
}

try {
  await manager.start()
  await until(
    () => renderer !== undefined && nodes().some((node) => node.testId === 'chat-input'),
    'chat view',
  )
  await native().setWindowBounds({ width: 900, height: 760 })
  await focusNativeQaWindow('TwirChat')

  const beforeAck = await submit('REPEATED')
  const afterAck = await submit('REPEATED')
  assertVisibleMessages([])
  for (const request of beforeAck) await publish(request)
  const visible = beforeAck.map((request) => request.id)
  for (const request of [...beforeAck, ...afterAck]) acknowledge(request)
  await Bun.sleep(100)
  assertVisibleMessages(visible)
  for (const request of afterAck) await publish(request)
  visible.push(...afterAck.map((request) => request.id))
  assertVisibleMessages(visible)
  assert(
    app.homeMessagesStore
      .get()
      .some(
        (message) =>
          message.platform === 'kick' &&
          message.author.badges.some((badge) => badge.type === 'broadcaster'),
      ),
    'The incoming Kick event supplies the broadcaster badge.',
  )

  await native().setWindowBounds({ width: 420, height: 760 })
  await Bun.sleep(300)
  const parent = afterAck.find((request) => request.params.platform === 'twitch')
  assert(parent)
  const timestamp = bounds(`chat-timestamp-${parent.id}`)
  const rowY = timestamp.y + timestamp.height / 2
  const button = nodes()
    .filter((node) => node.testId === 'msg-reply')
    .map((node) => native().getElementBounds(node.id))
    .find((box) => box && box.y <= rowY && rowY <= box.y + box.height)
  assert(button, 'The provider row has a reply action.')
  native().simulateClick(button.x + button.width / 2, button.y + button.height / 2, 0)
  await until(() => nodes().some((node) => node.testId === 'cancel-reply'), 'composer reply')
  const [reply] = await submit('REPLY', 1)
  assert(reply)
  assert.equal(reply.params.platform, 'twitch')
  assert.equal(reply.params.replyTo, parent.id)
  assertVisibleMessages(visible)
  acknowledge(reply)
  await publish(reply, {
    parentMessageId: parent.id,
    parentMessageText: 'Provider parent text',
    parentAuthor: { id: '12345', username: 'oceanofapathy', displayName: 'OceanOfApathy' },
  })
  visible.push(reply.id)
  assertVisibleMessages(visible)
  await until(
    () => native().getPaintedText().join(' ').includes('Provider parent text'),
    'reply preview uses provider metadata',
  )

  const refused = await submit('REFUSED')
  const held = refused.find((request) => request.params.platform === 'twitch')
  const rejected = refused.find((request) => request.params.platform === 'kick')
  assert(held && rejected)
  held.acknowledgement.resolve({ channelId: 'oceanofapathy', held: true })
  await until(() => app.noticeStore.get()?.kind === 'info', 'AutoMod hold shows a notice')
  assertVisibleMessages(visible)
  rejected.acknowledgement.reject(new Error('Rejected by the fixture provider'))
  await until(
    () => app.noticeStore.get()?.text.includes('Rejected by the fixture provider') === true,
    'rejection shows a notice',
  )
  assert.equal(app.noticeStore.get()?.kind, 'error')
  assertVisibleMessages(visible)
  screenshots.push(await captureGuiQaDisplay('incoming-chat-messages'))

  const noticeGeometry = []
  const rejectionReason =
    'Twitch did not send the message from @oceanofapathy: the same message was sent less than 30 seconds ago.'
  for (const width of [900, 320]) {
    await native().setWindowBounds({ width, height: 760 })
    await Bun.sleep(300)
    const requests = await submit('DUPLICATE')
    const twitch = requests.find((request) => request.params.platform === 'twitch')
    const kick = requests.find((request) => request.params.platform === 'kick')
    assert(twitch && kick)
    acknowledge(kick)
    twitch.acknowledgement.reject(new Error(rejectionReason))
    await until(
      () => app.noticeStore.get()?.text.includes(rejectionReason) === true,
      'long Twitch rejection shows a notice',
    )
    await publish(kick)
    visible.push(kick.id)
    await Bun.sleep(300)
    const card = nodes().find((node) =>
      node.children.some((child) => child.testId === 'chat-notice-text'),
    )
    assert(card, 'The notice text has a card container')
    const toast = native().getElementBounds(card.id)
    assert(toast, 'The notice card has native bounds')
    const text = bounds('chat-notice-text')
    assert(toast.x >= 12 && toast.x + toast.width <= width - 12, 'Notice stays inside window')
    assert(text.x >= toast.x && text.x + text.width <= toast.x + toast.width)
    assert(text.y >= toast.y && text.y + text.height <= toast.y + toast.height)
    assertVisibleMessages(visible)
    noticeGeometry.push({ width, toast, text })
    screenshots.push(await captureGuiQaDisplay(`chat-notice-${width}`))
    app.noticeStore.set(null)
    await Bun.sleep(60)
  }
  const [normalNotice, narrowNotice] = noticeGeometry
  assert(normalNotice && narrowNotice)
  assert(narrowNotice.text.height > normalNotice.text.height, 'Narrow notice wraps onto more lines')

  if (!sendOnly) await verifyBadgeLayout()
  await Bun.write(
    join(session, 'delivery-badges-result.json'),
    JSON.stringify(
      {
        ok: true,
        receivedMessages: visible.length,
        timestampGeometry,
        noticeGeometry,
        badgePixels,
        screenshots,
      },
      null,
      2,
    ),
  )
  console.log(
    sendOnly ? 'Native incoming-only chat passed.' : 'Native chat, badges and timestamps passed.',
  )
} catch (error) {
  await captureGuiQaDisplay('delivery-badges-failure').catch(() => {})
  await Bun.write(
    join(session, 'delivery-badges-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        posted: posted.map(({ params, id }) => ({ params, id })),
        tree: renderer ? nodes() : null,
        notices: app.noticeStore.get(),
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  stopMessages()
  await manager.quit()
  backend.dispose?.()
}
process.exit(0)
