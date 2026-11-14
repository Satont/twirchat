import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type { NormalizedChatMessage, TimestampFormat } from '@twirchat/shared/types'

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
const { focusNativeQaWindow } = await import('./qa-x11')

const timestampFormat: TimestampFormat = 'HH:MM:SS'
const THEMES = ['compact', 'modern'] satisfies ReadonlyArray<'modern' | 'compact'>
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
const absolute = new Date('2026-11-14T17:11:11Z')
const compact = createStore<'modern' | 'compact'>('compact')
const message: NormalizedChatMessage = {
  id: 'chat',
  platform: 'twitch',
  channelId: 'qa',
  author: { id: 'viewer', username: 'viewer42', displayName: 'Viewer42', badges: [] },
  text: 'hello chat, this is an ordinary message',
  emotes: [],
  timestamp: new Date('2026-11-14T14:14:30Z'),
  type: 'message',
}
const joined = buildTwitchSystemMessage({
  channelId: 'qa',
  id: 'join',
  timestamp: new Date('2026-11-14T14:14:38Z'),
  text: 'linaryx, streakz, bobby',
  notice: { kind: 'join' },
})
const part = buildTwitchSystemMessage({
  channelId: 'qa',
  id: 'part',
  timestamp: new Date('2026-11-14T21:54:05Z'),
  text: 'bobby',
  notice: { kind: 'part' },
})
const subscription = buildTwitchSystemMessage({
  channelId: 'qa',
  id: 'sub',
  timestamp: new Date('2026-11-14T15:04:46Z'),
  text: 'mia',
  notice: { kind: 'sub' },
  author: { id: 'mia', displayName: 'mia', color: '#fca5a5' },
})
const system: NormalizedChatMessage = {
  id: 'seventv',
  platform: 'twitch',
  channelId: 'qa',
  author: { id: '7tv-system', displayName: '7TV', badges: [] },
  text: 'Emote «RAGEY» added to the channel by EmoteEditor',
  emotes: [],
  timestamp: absolute,
  type: 'system',
  metadata: { sevenTvAction: 'added' },
}
const badgeEvent: NormalizedChatMessage = {
  id: 'streamdatabase',
  platform: 'twitch',
  channelId: 'qa',
  author: {
    id: '757102582',
    username: 'streamdatabase',
    displayName: 'StreamDatabase',
    color: '#8A2BE2',
    badges: [],
  },
  text: 'databaseStreamDatabase @linaryx Twitch global badge added: Bronze Chain https://www.streamdatabase.com/twitch/global-badges/bronze-chain/1',
  emotes: [],
  timestamp: absolute,
  type: 'message',
}
const rows = [message, joined, badgeEvent, system, subscription, part]

let renderer: GpuixRenderer | undefined
function Content() {
  const active = useGpuixRequired()
  const theme = useStore(compact)
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
        key: row.id,
        message: row,
        fontSize: 15,
        chatTheme: theme,
        showTimestamp: true,
        timestampFormat,
        showAvatar: false,
        showBadges: true,
        showPlatformIcon: true,
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
interface ThemeEvidence {
  theme: 'modern' | 'compact'
  joinTime: Bounds | null
  joinText: Bounds
  joinRow: Bounds
  systemTime: Bounds | null
  systemText: Bounds
  subTime: Bounds | null
  subText: Bounds
  messageTime?: Bounds | null
}
function nodes(node = JSON.parse(current().getAutomationTree())) {
  return [node, ...(node.children ?? []).flatMap((child: unknown) => nodes(child))]
}
function bounds(testId: string): Bounds {
  const node = nodes().find((entry) => entry.testId === testId)
  assert.ok(node, `${testId} node`)
  const result = current().getElementBounds(node.id)
  assert.ok(result, `${testId} bounds`)
  return result
}
function optionalBounds(testId: string): Bounds | null {
  // Capture both themes before asserting, so an old revision without leading
  // timestamp nodes still produces complete before screenshots.
  const node = nodes().find((entry) => entry.testId === testId)
  return node ? current().getElementBounds(node.id) : null
}
function textBounds(text: string): Bounds {
  const node = nodes().find((entry) => entry.text?.includes(text))
  assert.ok(node, `${text} text node`)
  const result = current().getElementBounds(node.id)
  assert.ok(result, `${text} text bounds`)
  return result
}
async function capture(theme: 'modern' | 'compact'): Promise<string> {
  compact.set(theme)
  await until(
    () =>
      current()
        .getPaintedText()
        .some((run) => run.includes('RAGEY')),
    `${theme} rows`,
  )
  current().simulateMouseMove(800, 300)
  await Bun.sleep(600)
  return await captureGuiQaDisplay(`event-times-${theme}`)
}
try {
  await manager.start()
  await until(
    () => !!renderer && nodes().some((node) => node.testId === 'chat-timestamp-chat'),
    'mount',
  )
  await focusNativeQaWindow('TwirChat')
  const window = nativeWindow(current())
  await window.setWindowBounds({ x: 20, y: 20, width: 760, height: 260 })
  await Bun.sleep(500)
  const screenshots: Record<string, string> = {}
  const evidence: ThemeEvidence[] = []
  for (const theme of THEMES) {
    screenshots[theme] = await capture(theme)
    evidence.push({
      theme,
      joinTime: optionalBounds(`twitch-notice-time-${joined.id}`),
      joinText: textBounds('Users joined'),
      joinRow: bounds(`twitch-notice-${joined.id}`),
      systemTime: optionalBounds('chat-timestamp-seventv'),
      systemText: textBounds('added to the channel'),
      subTime: optionalBounds(`twitch-notice-time-${subscription.id}`),
      subText: textBounds('Subscription'),
      ...(theme === 'compact' ? { messageTime: optionalBounds('chat-timestamp-chat') } : {}),
    })
  }
  for (const entry of evidence) {
    const { theme } = entry
    const { joinTime, systemTime, subTime, messageTime } = entry
    assert.ok(joinTime, `${theme}: join timestamp exists`)
    assert.ok(systemTime, `${theme}: system timestamp exists`)
    assert.ok(subTime, `${theme}: subscription timestamp exists`)
    assert.ok(joinTime.x < entry.joinText.x, `${theme}: join time leads its text`)
    assert.ok(subTime.x < entry.subText.x, `${theme}: subscription time leads its text`)
    assert.ok(systemTime.x < entry.systemText.x, `${theme}: system time leads its text`)
    assert.ok(
      joinTime.x + joinTime.width < entry.joinRow.x + entry.joinRow.width / 2,
      `${theme}: join time is not right-aligned`,
    )
    if (theme === 'modern') continue
    assert.ok(messageTime, 'compact: message timestamp exists')
    assert.equal(
      joinTime.x,
      messageTime.x,
      'compact: join time shares the message timestamp column',
    )
    assert.equal(subTime.x, messageTime.x, 'compact: subscription time shares the timestamp column')
    assert.equal(systemTime.x, messageTime.x, 'compact: system time shares the timestamp column')
  }
  await Bun.write(
    join(session, 'chat-event-times-result.json'),
    JSON.stringify({ ok: true, screenshots }, null, 2),
  )
  console.log('Event timestamps lead their rows in compact and modern chat layouts.')
} catch (error) {
  await captureGuiQaDisplay('chat-event-times-failure').catch(() => {})
  await Bun.write(
    join(session, 'chat-event-times-debug.json'),
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
