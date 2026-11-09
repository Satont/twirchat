import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type { Badge, NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { ChatMessage } = await import('../src/gpuix/components/ChatMessage')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { UserProfile } = await import('../src/gpuix/components/user-card-dialog/UserProfile')
const { BadgeTooltip } = await import('../src/gpuix/components/ui/BadgeTooltip')
const { Text } = await import('../src/gpuix/components/ui/Text')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
const { initCosmeticCaches } = await import('../src/gpuix/state/cosmetics')
const { emotePreferencesStore } = await import('../src/gpuix/state/emote-preferences')
const app = await import('../src/gpuix/state/app')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { getDbPath } = await import('../src/runtime-config')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { focusNativeQaWindow, getNativeQaWindowGeometry } = await import('./qa-x11')

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
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
const backend = getDesktopBackend()
const imageUrl = 'https://static-cdn.jtvnw.net/badges/v1/qa-tooltip/1'
const twirImageUrl = 'https://s3.twir.app/badges/qa-tooltip.svg'
const cache = join(dirname(getDbPath()), 'image-cache')
await mkdir(cache, { recursive: true })
const sharp = (await import('sharp')).default
await Bun.write(
  join(cache, `${createHash('sha256').update(imageUrl).digest('hex').slice(0, 32)}.png`),
  await sharp({ create: { width: 18, height: 18, channels: 4, background: '#a78bfa' } })
    .png()
    .toBuffer(),
)
await Bun.write(
  join(cache, `${createHash('sha256').update(twirImageUrl).digest('hex').slice(0, 32)}.svg`),
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <circle cx="64" cy="64" r="60" fill="#6237d6" stroke="#fff" stroke-width="3"/>
    <path d="M22 89L41 30l23 59 23-59 19 59M34 65h60" fill="none" stroke="#fff" stroke-width="4"/>
  </svg>`,
)
const providerBadges: Badge[] = [
  { id: 'qa-7tv', type: 'seventv', text: '7TV Supporter', imageUrl },
  { id: 'qa-bttv', type: 'bttv', text: 'BetterTTV Pro', imageUrl },
  { id: 'qa-ffz', type: 'ffz', text: 'FrankerFaceZ Supporter', imageUrl },
  { id: 'qa-ffzap', type: 'ffzap', text: 'FFZ:AP Supporter', imageUrl },
  { id: 'qa-dankchat', type: 'dankchat', text: 'DankChat Developer', imageUrl },
  { id: 'qa-chatsen', type: 'chatsen', text: 'Chatsen Developer', imageUrl },
  { id: 'qa-homies', type: 'homies', text: 'Homies Custom Badge', imageUrl },
  { id: 'qa-twir', type: 'twir', text: 'Twir Contributor', imageUrl: twirImageUrl },
  { id: 'qa-profile-text', type: 'seventv', text: 'Profile badge without image' },
]
const imageBadge: Badge = {
  id: 'qa-image',
  type: 'subscriber',
  text: 'Six-Month Subscriber',
  imageUrl,
  description: 'Subscribed for six months. Thank you for supporting the channel.',
}
const fallbackBadge: Badge = { id: 'qa-text', type: 'vip', text: 'Very Important Person' }
const embeddedBadge: Badge = {
  id: 'qa-svg',
  type: 'broadcaster',
  text: 'Broadcaster',
  imageUrl: 'embedded:kick:broadcaster',
}
const edgeBadge: Badge = {
  id: 'qa-edge',
  type: 'staff',
  text: 'A long badge name at the window edge',
  description: `A deliberately long description which must stay inside the window. ${'LongUnbrokenBadgeMetadata'.repeat(12)}`,
}
function message(id: string, platform: 'twitch' | 'kick', badges: Badge[]): NormalizedChatMessage {
  return {
    id,
    platform,
    channelId: 'qa',
    author: {
      id: platform === 'twitch' ? 'qa-author' : '',
      displayName: platform === 'twitch' ? 'Badge QA' : 'Kick QA',
      badges,
    },
    text: 'Badge details remain available while live chat keeps updating.',
    emotes: [],
    timestamp: new Date('2026-11-03T09:00:00Z'),
    type: 'message',
  }
}
const twitchMessage = message('qa-twitch', 'twitch', [imageBadge, fallbackBadge])
const kickMessage = message('qa-kick', 'kick', [embeddedBadge])
const configuration = createStore({ theme: 'compact', profile: false, mounted: true })
let renderer: GpuixRenderer | undefined
let cosmeticsRequests = 0
let heartbeat = 0
let largestLagMs = 0
let sequence = 0
backend.api.getChannelEmotes = async () => []
backend.api.getUserCosmetics = async () => {
  cosmeticsRequests++
  return { sevenTvUserId: 'qa-7tv-user', badges: providerBadges, lookupStatus: 'available' }
}
backend.api.getUserProfile = async () => ({ id: 'qa-author', errors: [] })
initCosmeticCaches(backend.api)
app.settingsStore.set({ ...DEFAULT_SETTINGS, chatTheme: 'compact', showAvatars: false })
app.accountsStore.set([
  {
    id: 'qa-kick',
    platform: 'kick',
    platformUserId: 'qa',
    username: 'qa',
    displayName: 'Badge QA',
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
    channelId: 'qa',
    channelLogin: 'qa',
  },
})
emotePreferencesStore.update({
  loaded: true,
  value: {
    ...emotePreferencesStore.get().value,
    badges: true,
    paints: false,
    personal: false,
  },
})
const stopMessages = app.wireBackendToStores(backend)
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
        backgroundColor: '#17161c',
        display: 'flex',
        flexDirection: 'column',
        padding: 8,
      }}
    >
      <div testId="qa-focus-away" tabIndex={0} style={{ height: 20, flexShrink: 0 }}>
        <Text style={{ color: '#ecebf1', fontSize: 12 }}>Badge hover QA</Text>
      </div>
      {state.profile ? (
        <UserProfile
          target={{
            platform: 'twitch',
            platformUserId: 'qa-author',
            username: 'qa-author',
            displayName: 'Badge QA',
            channelId: 'qa',
            channelSlug: 'qa',
          }}
        />
      ) : (
        <>
          {state.mounted ? (
            <div style={{ flexShrink: 0 }}>
              <ChatMessage
                message={twitchMessage}
                chatTheme={state.theme === 'compact' ? 'compact' : 'modern'}
                showAvatar={false}
                showTimestamp={false}
                visible
              />
              <ChatMessage
                message={kickMessage}
                chatTheme={state.theme === 'compact' ? 'compact' : 'modern'}
                showAvatar={false}
                showTimestamp={false}
                visible
              />
            </div>
          ) : null}
          <div
            style={{
              flexGrow: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <ChatView paneId="qa-badges" layoutTabId="home" isMain />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
            <BadgeTooltip badge={edgeBadge} platform="twitch">
              <div
                style={{ width: 20, height: 20, backgroundColor: '#a78bfa', pointerEvents: 'none' }}
              />
            </BadgeTooltip>
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
function current(): GpuixRenderer {
  assert(renderer)
  return renderer
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function nodes(): AutomationNode[] {
  return flatten(automationSchema.parse(JSON.parse(current().getAutomationTree())))
}
function find(testId: string): AutomationNode {
  const found = nodes().find((node) => node.testId === testId)
  assert(found, `Missing ${testId}`)
  return found
}
function bounds(testId: string) {
  const box = current().getElementBounds(find(testId).id)
  assert(box, `No bounds for ${testId}`)
  return box
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 6000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(25)
  }
}
async function pointer(x: number, y: number): Promise<void> {
  const geometry = getNativeQaWindowGeometry('TwirChat')
  const result = Bun.spawnSync(
    [
      '/usr/bin/xdotool',
      'mousemove',
      '--sync',
      String(Math.round(geometry.x + x)),
      String(Math.round(geometry.y + y)),
    ],
    { env: process.env, timeout: 5000 },
  )
  assert.equal(result.exitCode, 0, result.stderr.toString())
  await Bun.sleep(30)
}
async function hover(id: string): Promise<void> {
  const box = bounds(`badge-trigger-${id}`)
  await pointer(box.x + box.width / 2, box.y + box.height / 2)
  await until(() => nodes().some((node) => node.testId === `badge-tooltip-${id}`), `tooltip ${id}`)
}
async function leave(): Promise<void> {
  await pointer(4, 4)
  await until(
    () => !nodes().some((node) => node.testId?.startsWith('badge-tooltip-')),
    'tooltip dismissed',
  )
}
const screenshots: string[] = []
const checks: string[] = []
let timer: ReturnType<typeof setInterval> | undefined
try {
  await manager.start()
  await until(
    () =>
      !!renderer &&
      nodes().some(
        (node) =>
          node.testId === 'badge-trigger-qa-twir' &&
          node.children.some((child) => child.type === 'img'),
      ),
    'Twir badge ready',
  )
  const thumbnails = join(cache, 'avatars')
  const [thumbnail] = await readdir(thumbnails)
  assert(thumbnail, 'Twir badge prepared a cached thumbnail.')
  const { format, width, height, hasAlpha } = await sharp(join(thumbnails, thumbnail)).metadata()
  assert.deepEqual(
    { format, width, height, hasAlpha },
    { format: 'png', width: 32, height: 32, hasAlpha: true },
  )
  await focusNativeQaWindow('TwirChat')
  let previousTick = performance.now()
  timer = setInterval(() => {
    const now = performance.now()
    largestLagMs = Math.max(largestLagMs, now - previousTick - 40)
    previousTick = now
    heartbeat++
    sequence++
    backend.events.emit('chat_message', {
      ...message(`live-${sequence}`, 'kick', [embeddedBadge]),
      timestamp: new Date(),
      text: `LIVE_BADGE_QA_${sequence}`,
    })
  }, 40)
  for (const width of [420, 900]) {
    const height = width === 420 ? 300 : 600
    await nativeWindow(current()).setWindowBounds({ width, height })
    for (const theme of ['compact', 'modern']) {
      configuration.set({ theme, profile: false, mounted: true })
      await Bun.sleep(300)
      await leave()
      if (width === 900) {
        const badge = bounds('badge-trigger-qa-twir')
        const author = nodes().find((node) => node.text === twitchMessage.author.displayName)
        assert(author)
        const name = current().getElementBounds(author.id)
        assert(name)
        assert(badge.y < name.y + name.height && name.y < badge.y + badge.height)
        const gap = name.x - (badge.x + badge.width)
        assert(Math.abs(gap - 5) < 1, `${theme} nickname gap was ${gap}px`)
        screenshots.push(await captureGuiQaDisplay(`twir-badge-spacing-${theme}`))
        checks.push(`${theme}: Twir SVG thumbnail and ${gap}px nickname gap`)
      }
      const requests = cosmeticsRequests
      for (const [id, title, source] of [
        ['qa-image', imageBadge.text, 'Twitch'],
        ['qa-text', fallbackBadge.text, 'Twitch'],
        ['qa-svg', embeddedBadge.text, 'Kick'],
        ['qa-7tv', '7TV Supporter', '7TV'],
        ['qa-bttv', 'BetterTTV Pro', 'BetterTTV'],
        ['qa-ffz', 'FrankerFaceZ Supporter', 'FrankerFaceZ'],
        ['qa-ffzap', 'FFZ:AP Supporter', 'FFZ:AP'],
        ['qa-dankchat', 'DankChat Developer', 'DankChat'],
        ['qa-chatsen', 'Chatsen Developer', 'Chatsen'],
        ['qa-homies', 'Homies Custom Badge', 'Homies Custom'],
        ['qa-twir', 'Twir Contributor', 'Twir'],
      ]) {
        assert(id && title && source)
        await hover(id)
        const painted = current().getPaintedText().join(' ')
        assert(
          painted.includes(title) && painted.includes(source),
          `${id}: title and provider painted`,
        )
        if (id === 'qa-image') {
          assert(painted.includes(imageBadge.description ?? ''))
          screenshots.push(await captureGuiQaDisplay(`badges-${theme}-${width}`))
        }
        await leave()
      }
      assert.equal(cosmeticsRequests, requests, 'Hover does not load provider metadata again.')
      await hover('qa-edge')
      const popup = bounds('badge-tooltip-qa-edge')
      assert(popup.x >= 0 && popup.y >= 0)
      assert(
        popup.x + popup.width <= width && popup.y + popup.height <= height,
        'Tooltip stays inside window.',
      )
      screenshots.push(await captureGuiQaDisplay(`badges-edge-${theme}-${width}`))
      await leave()
      checks.push(`${theme}-${width}: image, SVG, text, providers, edge bounds`)
    }
  }
  const countBefore = sequence
  await hover('qa-image')
  current().simulateKeystrokes('escape')
  await until(
    () => !nodes().some((node) => node.testId === 'badge-tooltip-qa-image'),
    'Escape dismissal',
  )
  await leave()
  current().focusElement(find('badge-trigger-qa-image').id)
  await until(
    () => nodes().some((node) => node.testId === 'badge-tooltip-qa-image'),
    'focus opens tooltip',
  )
  current().focusElement(find('qa-focus-away').id)
  await until(
    () => !nodes().some((node) => node.testId === 'badge-tooltip-qa-image'),
    'blur dismissal',
  )
  for (let iteration = 0; iteration < 5; iteration++) {
    const box = bounds('badge-trigger-qa-image')
    await pointer(box.x + box.width / 2, box.y + box.height / 2)
    await pointer(4, 4)
  }
  await Bun.sleep(400)
  assert(!nodes().some((node) => node.testId?.startsWith('badge-tooltip-')))
  await hover('qa-image')
  configuration.update({ mounted: false })
  await until(
    () => !nodes().some((node) => node.testId === 'badge-tooltip-qa-image'),
    'unmount cleanup',
  )
  configuration.update({ mounted: true })
  await Bun.sleep(200)
  await leave()
  await hover('qa-image')
  await leave()
  assert(
    sequence > countBefore && heartbeat > 20,
    'Incoming chat and heartbeat continue during hover input.',
  )
  await until(
    () =>
      current()
        .getPaintedText()
        .some((text) => text.includes('LIVE_BADGE_QA_')),
    'ChatView continues painting traffic',
  )
  configuration.update({ profile: true })
  await until(
    () =>
      current().getPaintedText().includes('Open 7TV profile') &&
      nodes().some((node) => node.testId === 'badge-trigger-qa-7tv'),
    'user profile badge',
  )
  await hover('qa-7tv')
  assert(current().getPaintedText().includes('7TV Supporter'))
  await leave()
  await hover('qa-profile-text')
  assert(current().getPaintedText().includes('Profile badge without image'))
  await leave()
  emotePreferencesStore.update({
    value: { ...emotePreferencesStore.get().value, badges: false },
  })
  await until(
    () => !nodes().some((node) => node.testId === 'badge-trigger-qa-7tv'),
    'user profile badges disabled',
  )
  emotePreferencesStore.update({
    value: { ...emotePreferencesStore.get().value, badges: true },
  })
  await until(
    () => nodes().some((node) => node.testId === 'badge-trigger-qa-7tv'),
    'user profile badges re-enabled',
  )
  checks.push(
    'Escape, focus/blur, rapid cancel, unmount/remount, live ChatView, user profile and badge toggle',
  )
  await Bun.write(
    join(session, 'badge-tooltips-result.json'),
    JSON.stringify(
      {
        ok: true,
        checks,
        screenshots,
        cosmeticsRequests,
        incomingMessages: sequence,
        heartbeat,
        largestLagMs,
      },
      null,
      2,
    ),
  )
} catch (error) {
  await captureGuiQaDisplay('badge-tooltips-failure')
  await Bun.write(
    join(session, 'badge-tooltips-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        text: renderer?.getPaintedText(),
        tree: renderer?.getAutomationTree(),
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
