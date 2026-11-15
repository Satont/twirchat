import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type { NormalizedChatMessage, TimestampFormat, WatchedChannel } from '@twirchat/shared/types'
import { z } from 'zod'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { buildTwitchSystemMessage } from '../src/services/twitch-system-message'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { ChatMessage } = await import('../src/gpuix/components/ChatMessage')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { focusNativeQaWindow, getNativeQaWindowGeometry } = await import('./qa-x11')

const timestampFormat: TimestampFormat = 'HH:MM:SS'
const THEMES: ReadonlyArray<'modern' | 'compact'> = ['modern', 'compact']
const session = process.env.TWIRCHAT_QA_SESSION_DIR ?? ''
if (!session) throw new Error('Missing isolated GUI QA session directory.')

const chatTheme = createStore<'modern' | 'compact'>('modern')

const ocean: WatchedChannel = {
  id: 'source-ocean',
  platform: 'twitch',
  channelSlug: 'oceanofapathy',
  displayName: 'oceanofapathy',
  createdAt: 0,
}
const zakviel: WatchedChannel = {
  id: 'source-zakviel',
  platform: 'twitch',
  channelSlug: 'zakvielchannel',
  displayName: 'zakvielchannel',
  createdAt: 0,
}

const ordinary: NormalizedChatMessage = {
  id: 'ordinary',
  platform: 'twitch',
  channelId: ocean.channelSlug,
  author: { id: 'viewer', username: 'mejkiz', displayName: 'mejkiz', badges: [] },
  text: 'hello from the combined feed',
  emotes: [],
  timestamp: new Date('2026-11-15T00:01:11Z'),
  type: 'message',
}
const joined = buildTwitchSystemMessage({
  channelId: ocean.channelSlug,
  id: 'join',
  timestamp: new Date('2026-11-15T00:02:52Z'),
  text: 'mejkiz',
  notice: { kind: 'join' },
})
const parted = buildTwitchSystemMessage({
  channelId: ocean.channelSlug,
  id: 'part',
  timestamp: new Date('2026-11-15T00:13:39Z'),
  text: 'laneroeeazy',
  notice: { kind: 'part' },
})
const joinedZakviel = buildTwitchSystemMessage({
  channelId: zakviel.channelSlug,
  id: 'join-zakviel',
  timestamp: new Date('2026-11-15T00:32:28Z'),
  text: 'mejkiz',
  notice: { kind: 'join' },
})

const rows: ReadonlyArray<{ message: NormalizedChatMessage; source: WatchedChannel }> = [
  { message: ordinary, source: ocean },
  { message: joined, source: ocean },
  { message: parted, source: ocean },
  { message: joinedZakviel, source: zakviel },
]

let renderer: GpuixRenderer | undefined
function Content() {
  const active = useGpuixRequired()
  const theme = useStore(chatTheme)
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    renderer = active
  }, [active])
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#16161c',
      },
    },
    ...rows.map((row) =>
      React.createElement(ChatMessage, {
        key: row.message.id,
        message: row.message,
        feedSource: row.source,
        fontSize: 15,
        chatTheme: theme,
        showTimestamp: true,
        timestampFormat,
        showAvatar: false,
        showBadges: true,
        showPlatformIcon: false,
        showPlatformColorStripe: true,
        visible: true,
      }),
    ),
  )
}
const manager = new DesktopWindowManager(
  getDesktopBackend(),
  () => React.createElement(Content),
  () => {},
)
function current(): GpuixRenderer {
  assert(renderer)
  return renderer
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(20)
  }
}

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
interface AutomationNode {
  id: number
  testId?: string
  text?: string
  children: AutomationNode[]
}
const automationNodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    text: z.string().optional(),
    children: z.array(automationNodeSchema).default([]),
  }),
)
function automationTree(): AutomationNode {
  const raw: unknown = JSON.parse(current().getAutomationTree())
  return automationNodeSchema.parse(raw)
}
function nodes(node = automationTree()): AutomationNode[] {
  return [node, ...node.children.flatMap((child) => nodes(child))]
}
function bounds(testId: string): Bounds {
  const node = nodes().find((entry) => entry.testId === testId)
  assert.ok(node, `${testId} node`)
  const result = current().getElementBounds(node.id)
  assert.ok(result, `${testId} bounds`)
  return result
}
function findText(node: AutomationNode, text: string): AutomationNode | undefined {
  if (node.text?.includes(text)) return node
  for (const child of node.children) {
    const found = findText(child, text)
    if (found) return found
  }
  return undefined
}
function noticeTextBounds(rowTestId: string, text: string): Bounds {
  const row = nodes().find((entry) => entry.testId === rowTestId)
  assert.ok(row, `${rowTestId} node`)
  const node = findText(row, text)
  assert.ok(node, `${text} text node`)
  const result = current().getElementBounds(node.id)
  assert.ok(result, `${text} text bounds`)
  return result
}

const sharp = (await import('sharp')).default
async function capture(theme: 'modern' | 'compact'): Promise<string> {
  chatTheme.set(theme)
  await until(
    () =>
      current()
        .getPaintedText()
        .some((run) => run.includes('Users joined')),
    `${theme} membership rows`,
  )
  current().simulateMouseMove(800, 300)
  await Bun.sleep(600)
  const screenshot = await captureGuiQaDisplay(`feed-membership-${theme}`)
  const geometry = getNativeQaWindowGeometry('TwirChat')
  const cropped = join(session, `feed-membership-${theme}-window.png`)
  await sharp(screenshot)
    .extract({ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height })
    .png()
    .toFile(cropped)
  return cropped
}

interface MembershipEvidence {
  theme: 'modern' | 'compact'
  messageId: string
  row: Bounds
  label: Bounds
  text: Bounds
}
try {
  await manager.start()
  await until(
    () => !!renderer && nodes().some((node) => node.testId === `twitch-notice-${joined.id}`),
    'mount',
  )
  await focusNativeQaWindow('TwirChat')
  const window = nativeWindow(current())
  await window.setWindowBounds({ x: 20, y: 20, width: 760, height: 240 })
  await Bun.sleep(500)
  const screenshots: Record<string, string> = {}
  const evidence: MembershipEvidence[] = []
  for (const theme of THEMES) {
    screenshots[theme] = await capture(theme)
    for (const { message } of rows) {
      const notice = message.metadata?.twitchNotice
      if (!notice) continue
      evidence.push({
        theme,
        messageId: message.id,
        row: bounds(`twitch-notice-${message.id}`),
        label: bounds(`chat-feed-source-${message.id}`),
        text: noticeTextBounds(
          `twitch-notice-${message.id}`,
          notice.kind === 'join' ? 'Users joined' : 'Users parted',
        ),
      })
    }
  }
  for (const entry of evidence) {
    const { theme, messageId, row, label, text } = entry
    assert.ok(label.y >= row.y - 1, `${theme} ${messageId}: feed chip starts inside the notice row`)
    assert.ok(
      label.y + label.height <= row.y + row.height + 1,
      `${theme} ${messageId}: feed chip ends inside the notice row`,
    )
    const overlap =
      Math.min(label.y + label.height, text.y + text.height) - Math.max(label.y, text.y)
    assert.ok(
      overlap >= Math.min(label.height, text.height) * 0.5,
      `${theme} ${messageId}: feed chip and notice text share a line`,
    )
  }
  await Bun.write(
    join(session, 'feed-membership-result.json'),
    JSON.stringify({ ok: true, screenshots, evidence }, null, 2),
  )
  console.log('Combined-feed membership notices keep the feed chip on the notice line.')
} catch (error) {
  await captureGuiQaDisplay('feed-membership-failure').catch(() => {})
  await Bun.write(
    join(session, 'feed-membership-debug.json'),
    JSON.stringify(
      {
        error: String(error),
        painted: renderer?.getPaintedText(),
        tree: renderer ? JSON.parse(renderer.getAutomationTree()) : null,
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  await manager.quit()
  await Bun.sleep(100)
}
process.exit(0)
