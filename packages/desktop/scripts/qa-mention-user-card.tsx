import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { DEFAULT_MODERATION_SETTINGS } from '@twirchat/shared/user-profile'
import { z } from 'zod'

import type { UserCosmetics } from '../src/services/cosmetics'
import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import type { DesktopWindowDescriptor } from '../src/services/window-session'
import type { UserCardTarget } from '../src/views/main/utils/chatCommands'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { ChatMessage } = await import('../src/gpuix/components/ChatMessage')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { UserCardDialog } = await import('../src/gpuix/components/UserCardDialog')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
const { initCosmeticCaches } = await import('../src/gpuix/state/cosmetics')
const { emotePreferencesStore } = await import('../src/gpuix/state/emote-preferences')
const app = await import('../src/gpuix/state/app')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { focusNativeQaWindow, getNativeQaWindowGeometry } = await import('./qa-x11')
const sharp = (await import('sharp')).default

interface AutomationNode {
  id: number
  testId?: string
  text?: string
  children: AutomationNode[]
}
interface Configuration {
  theme: 'compact' | 'modern'
  target: UserCardTarget | null
  fallback: boolean
  sourceMounted: boolean
}
const nodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    text: z.string().optional(),
    children: z.array(nodeSchema).default([]),
  }),
)
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
const backend = getDesktopBackend()
const configuration = createStore<Configuration>({
  theme: 'compact',
  target: null,
  fallback: false,
  sourceMounted: true,
})
const opened: UserCardTarget[] = []
const lookups: string[] = []
const historyQueries: string[] = []
const screenshots: string[] = []
const checks: string[] = []
let renderer: GpuixRenderer | undefined
let userWindow:
  | { renderer: GpuixRenderer; descriptor: Extract<DesktopWindowDescriptor, { kind: 'user' }> }
  | undefined
let incoming = 0
let heartbeat = 0
let maximumLagMs = 0
let lookupDelayMs = 80
let cosmeticsRequests = 0
const cosmeticsCalls: Array<{
  platformUserId: string
  preferences?: unknown
}> = []
function message(id: string, text: string): NormalizedChatMessage {
  return {
    id,
    platform: 'twitch',
    channelId: 'source-channel',
    type: 'message',
    timestamp: new Date(),
    text,
    author: { id: '111', username: 'sender', displayName: 'Sender', badges: [] },
    emotes: [],
  }
}
const source = message('source-message', 'Hello @KnownViewer and @RemoteViewer!')
const known: NormalizedChatMessage = {
  ...message('known-message', 'An earlier message'),
  author: {
    id: '222',
    username: 'knownviewer',
    displayName: 'Known Viewer',
    color: '#ff5f57',
    badges: [],
  },
}
const cosmetics: UserCosmetics = {
  sevenTvUserId: '7tv-known-user',
  badges: [],
  lookupStatus: 'available',
  paint: {
    id: 'qa-mention-gradient',
    name: 'QA gradient',
    shadows: [],
    layers: [
      {
        type: 'linear',
        opacity: 1,
        angle: 90,
        repeating: false,
        stops: [
          { at: 0, color: '#5aff55' },
          { at: 1, color: '#27ddff' },
        ],
      },
    ],
  },
}
backend.api.resolveMentionUser = async ({ username }) => {
  lookups.push(username)
  await Bun.sleep(lookupDelayMs)
  assert.equal(username.toLowerCase(), 'remoteviewer')
  return { platformUserId: '333', username: 'remoteviewer', displayName: 'Remote Viewer' }
}
backend.api.getChannelEmotes = async () => []
backend.api.getUserCosmetics = async ({ platformUserId, preferences }) => {
  cosmeticsRequests++
  cosmeticsCalls.push({ platformUserId, preferences })
  return platformUserId === known.author.id ? cosmetics : null
}
initCosmeticCaches(backend.api)
backend.api.getModerationSettings = async () => structuredClone(DEFAULT_MODERATION_SETTINGS)
backend.api.getUserProfile = async ({ platformUserId }) => ({ id: platformUserId, errors: [] })
backend.api.getUserChatHistory = async ({ platformUserId }) => {
  historyQueries.push(platformUserId)
  return {
    messages: Array.from({ length: 200 }, (_, index) => ({
      ...message(`history-${index}`, `History ${index}`),
      author: { ...known.author, id: platformUserId },
    })),
    hasMore: false,
    nextCursor: null,
  }
}
backend.api.getUserCardMetadata = async ({ platform, platformUserId }) => ({
  platform,
  platformUserId,
  fetchedAt: Date.now(),
  accountAge: { status: 'available', createdAt: '2020-01-01T00:00:00Z' },
  followAge: { status: 'unavailable', followedAt: null },
  subscriptionDuration: { status: 'unavailable', currentlySubscribed: null },
  subAge: { status: 'unavailable', months: null },
})
app.settingsStore.set({ ...DEFAULT_SETTINGS, showAvatars: false })
app.accountsStore.set([
  {
    id: 'qa-kick',
    platform: 'kick',
    platformUserId: 'source-channel',
    username: 'qa',
    displayName: 'QA',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
])
app.channelStatusStore.set({
  kick: {
    platform: 'kick',
    status: 'connected',
    mode: 'authenticated',
    channelId: 'source-channel',
    channelLogin: 'source-channel',
  },
})
emotePreferencesStore.update({
  loaded: true,
  value: {
    ...emotePreferencesStore.get().value,
    badges: false,
    paints: false,
    personal: false,
    enabled: { twitch: false, seventv: false, bttv: false, ffz: false },
  },
})
const stopMessages = app.wireBackendToStores(backend)
function open(target: UserCardTarget): void {
  opened.push(target)
  configuration.update({ target })
}
function Content() {
  const active = useGpuixRequired()
  const state = useStore(configuration)
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    renderer = active
  }, [active])
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#17161c',
      }}
    >
      {state.sourceMounted ? (
        <ChatMessage
          message={source}
          channelSlug="source-slug"
          chatTheme={state.theme}
          showAvatar={false}
          showBadges={false}
          onOpenUserCard={state.fallback ? undefined : open}
        />
      ) : null}
      <ChatView paneId="main" />
      {state.target ? (
        <UserCardDialog
          target={state.target}
          onClose={() => configuration.update({ target: null })}
        />
      ) : null}
    </div>
  )
}
const manager = new DesktopWindowManager(
  backend,
  (descriptor) =>
    descriptor.kind === 'user' ? <StandaloneUser descriptor={descriptor} /> : <Content />,
  () => {},
)
function StandaloneUser({
  descriptor,
}: {
  descriptor: Extract<DesktopWindowDescriptor, { kind: 'user' }>
}) {
  const active = useGpuixRequired()
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    userWindow = { renderer: active, descriptor }
  }, [active, descriptor])
  return <UserCardDialog target={descriptor.target} standalone onClose={() => {}} />
}
function current(): GpuixRenderer {
  assert(renderer)
  return renderer
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function nodes(): AutomationNode[] {
  return flatten(nodeSchema.parse(JSON.parse(current().getAutomationTree())))
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(25)
  }
}
function findMention(username: string): AutomationNode | undefined {
  const id = `mention-@${username}`
  return nodes().find((node) => node.testId === id || node.testId === `painted-${id}`)
}
function mention(username: string): AutomationNode {
  const found = findMention(username)
  assert(found, `Missing @${username}`)
  return found
}
async function mentionColors(
  screenshot: string,
): Promise<{ red: number; green: number; cyan: number }> {
  const bounds = current().getElementBounds(mention('KnownViewer').id)
  assert(bounds)
  const window = getNativeQaWindowGeometry('TwirChat')
  assert(bounds.x >= 0 && bounds.x + bounds.width <= window.width)
  const pixels = await sharp(screenshot)
    .extract({
      left: Math.floor(window.x + bounds.x),
      top: Math.floor(window.y + bounds.y),
      width: Math.ceil(bounds.width),
      height: Math.ceil(bounds.height),
    })
    .ensureAlpha()
    .raw()
    .toBuffer()
  let red = 0
  let green = 0
  let cyan = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const r = pixels.readUInt8(offset)
    const g = pixels.readUInt8(offset + 1)
    const b = pixels.readUInt8(offset + 2)
    // Match the fixture's #ff5f57 so subpixel fringes on white text do not count.
    if (r > 220 && Math.abs(g - 95) < 15 && Math.abs(b - 87) < 15) red++
    if (g > 170 && g - r > 90 && g - b > 60) green++
    if (g > 170 && b > 170 && Math.min(g, b) - r > 90) cyan++
  }
  return { red, green, cyan }
}
function nativeInput(...args: string[]): void {
  const result = Bun.spawnSync(['/usr/bin/xdotool', ...args], { env: process.env, timeout: 5000 })
  assert.equal(result.exitCode, 0, result.stderr.toString())
}
async function click(username: string, button = 1): Promise<void> {
  await clickNode(mention(username), button)
}
async function clickNode(node: AutomationNode, button = 1): Promise<void> {
  const bounds = current().getElementBounds(node.id)
  assert(bounds)
  const window = getNativeQaWindowGeometry('TwirChat')
  nativeInput(
    'mousemove',
    '--sync',
    String(Math.round(window.x + bounds.x + bounds.width / 2)),
    String(Math.round(window.y + bounds.y + bounds.height / 2)),
    'click',
    String(button),
  )
  await Bun.sleep(100)
}
async function dismiss(closeButton = false): Promise<void> {
  await Bun.sleep(100)
  if (closeButton) {
    const close = nodes().find((node) => node.text === 'Close')
    assert(close)
    await clickNode(close)
  } else nativeInput('key', 'Escape')
  await until(() => configuration.get().target === null, 'card dismissed')
  await Bun.sleep(100)
}
let timer: ReturnType<typeof setInterval> | undefined
try {
  await manager.start()
  await until(
    () => !!renderer && nodes().some((node) => node.text?.includes('@KnownViewer')),
    'mentions painted',
  )
  await focusNativeQaWindow('TwirChat')
  const initial = await captureGuiQaDisplay('mention-before-author')
  assert((await mentionColors(initial)).red < 20, 'uncolored mention has no author-red text')
  backend.events.emit('watched_channel_message', { channelId: 'known-channel', message: known })
  await until(() => app.watchedMessagesStore.get().has('known-channel'), 'known author received')
  await Bun.sleep(200)
  const colored = await captureGuiQaDisplay('mention-with-color')
  assert((await mentionColors(colored)).red > 20, 'mounted mention takes the author color')
  screenshots.push(initial, colored)
  checks.push('already mounted mention picks up the author color when the user first speaks')
  emotePreferencesStore.update({ value: { ...emotePreferencesStore.get().value, paints: true } })
  let previous = performance.now()
  timer = setInterval(() => {
    const now = performance.now()
    maximumLagMs = Math.max(maximumLagMs, now - previous - 40)
    previous = now
    heartbeat++
    backend.events.emit('chat_message', {
      ...message(`live-${++incoming}`, `LIVE_MENTION_QA_${incoming}`),
      platform: 'kick',
    })
  }, 40)
  for (const width of [420, 900]) {
    const height = width === 420 ? 300 : 600
    await nativeWindow(current()).setWindowBounds({ width, height })
    for (const theme of ['compact', 'modern'] satisfies Configuration['theme'][]) {
      configuration.update({ theme })
      await until(
        () => findMention('KnownViewer')?.testId === 'painted-mention-@KnownViewer',
        'painted mention element',
      )
      await Bun.sleep(400)
      const painted = await captureGuiQaDisplay(`mention-paint-${theme}-${width}`)
      const { green, cyan } = await mentionColors(painted)
      assert(
        green > 20 && cyan > 20,
        `Missing gradient pixels at ${theme} ${width}: ${green}, ${cyan}`,
      )
      screenshots.push(painted)
      const count = opened.length
      const lookupCount = lookups.length
      await click('KnownViewer', 3)
      assert.equal(opened.length, count, 'right click does not open a card')
      nativeInput('key', 'Escape')
      await Bun.sleep(100)
      await click('KnownViewer')
      await until(() => configuration.get().target?.platformUserId === '222', 'known user card')
      assert.equal(lookups.length, lookupCount, 'known user uses local identity')
      assert.equal(opened.at(-1)?.messageId, undefined, 'sender message is not a moderation target')
      assert.equal(opened.at(-1)?.channelId, source.channelId)
      assert.equal(opened.at(-1)?.channelSlug, 'source-slug')
      await until(() => current().getPaintedText().includes('Known Viewer'), 'card header painted')
      await until(
        () => current().getPaintedText().join('').includes('7TV paint: QA gradient'),
        'user card paint enabled',
      )
      const avatar = nodes().find((node) => node.testId === 'user-card-avatar')
      assert(avatar)
      const box = current().getElementBounds(avatar.id)
      assert(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width &&
          box.y + box.height <= height,
      )
      screenshots.push(await captureGuiQaDisplay(`mention-${theme}-${width}`))
      await dismiss()
      current().focusElement(mention('RemoteViewer').id)
      await Bun.sleep(100)
      nativeInput('key', theme === 'compact' ? 'Return' : 'space')
      await until(
        () => configuration.get().target?.platformUserId === '333',
        'remote user card from keyboard',
      )
      if (width === 900) {
        const history = nodes().find((node) => node.text === 'History')
        assert(history)
        await clickNode(history)
        await until(() => historyQueries.includes('333'), 'mentioned user history requested')
      }
      assert.equal(opened.at(-1)?.username, 'remoteviewer')
      await dismiss(width === 900)
      checks.push(
        `${theme}-${width}: gradient pixels, native click, right click, ${theme === 'compact' ? 'Enter' : 'Space'}, IDs, channel context, bounded card${width === 900 ? ', 200 history rows' : ''}`,
      )
    }
  }
  current().focusElement(mention('KnownViewer').id)
  await Bun.sleep(100)
  nativeInput('key', 'Return')
  await until(
    () => configuration.get().target?.platformUserId === '222',
    'painted mention keyboard',
  )
  await dismiss()
  emotePreferencesStore.update({ value: { ...emotePreferencesStore.get().value, paints: false } })
  await until(() => findMention('KnownViewer')?.testId === 'mention-@KnownViewer', 'paint disabled')
  await Bun.sleep(150)
  const disabled = await captureGuiQaDisplay('mention-paint-disabled')
  const fallbackColors = await mentionColors(disabled)
  assert(fallbackColors.red > 20 && fallbackColors.green === 0 && fallbackColors.cyan === 0)
  screenshots.push(disabled)
  checks.push('painted mention opens by keyboard and disabling paints restores the author color')
  const requestsBeforeDisabledCard = cosmeticsRequests
  await click('KnownViewer')
  await until(
    () => configuration.get().target?.platformUserId === '222',
    'user card with paints disabled',
  )
  await until(() => current().getPaintedText().includes('Known Viewer'), 'disabled card header')
  await Bun.sleep(150)
  assert(!current().getPaintedText().includes('7TV paint:'), 'user card paint label disabled')
  assert.equal(cosmeticsRequests, requestsBeforeDisabledCard, 'disabled card skips cosmetics fetch')
  await dismiss()
  for (let repeat = 0; repeat < 4; repeat++) {
    await click('KnownViewer')
    await until(() => configuration.get().target?.platformUserId === '222', 'rapid reopen')
    await dismiss()
  }
  lookupDelayMs = 400
  await click('RemoteViewer')
  await click('KnownViewer')
  await until(() => configuration.get().target?.platformUserId === '222', 'newest mention wins')
  await Bun.sleep(450)
  assert.equal(configuration.get().target?.platformUserId, '222', 'stale remote lookup is ignored')
  await dismiss()
  checks.push('rapid reopen and a delayed remote lookup overtaken by another mention')
  configuration.update({ fallback: true })
  await Bun.sleep(100)
  await click('KnownViewer')
  await until(
    () => userWindow?.descriptor.target.platformUserId === '222',
    'standalone card fallback',
  )
  const standalone = userWindow
  assert(standalone)
  await until(
    () => standalone.renderer.getPaintedText().includes('Known Viewer'),
    'standalone card painted',
  )
  await manager.close(standalone.descriptor.id)
  checks.push('history/translation mention fallback opens a native user window')
  await focusNativeQaWindow('TwirChat')
  configuration.update({ fallback: false })
  await Bun.sleep(100)
  const countBeforeUnmount = opened.length
  await click('RemoteViewer')
  configuration.update({ sourceMounted: false })
  await Bun.sleep(450)
  assert.equal(opened.length, countBeforeUnmount, 'unmounted mention ignores lookup completion')
  checks.push('unmount cancels pending card opening')
  await until(
    () =>
      current()
        .getPaintedText()
        .some((text) => text.includes('LIVE_MENTION_QA_')),
    'live chat continues painting',
  )
  assert(heartbeat > 20 && incoming > 20)
  await Bun.write(
    join(session, 'mention-user-card-result.json'),
    JSON.stringify(
      {
        ok: true,
        checks,
        screenshots,
        opened,
        lookups,
        incomingMessages: incoming,
        heartbeat,
        maximumLagMs,
      },
      null,
      2,
    ),
  )
} catch (error) {
  await captureGuiQaDisplay('mention-failure')
  await Bun.write(
    join(session, 'mention-user-card-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        text: renderer?.getPaintedText(),
        tree: renderer?.getAutomationTree(),
        opened,
        lookups,
        cosmeticsCalls,
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  if (timer) clearInterval(timer)
  stopMessages()
  await manager.quit()
  backend.dispose?.()
}
process.exit(0)
