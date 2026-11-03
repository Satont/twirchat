import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { ChatMessage } = await import('../src/gpuix/components/ChatMessage')
const { ThemeContext } = await import('../src/gpuix/theme-context')
const { darkTheme, lightTheme } = await import('../src/gpuix/theme')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
const { imageSnapshot } = await import('../src/gpuix/state/image-cache')
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
interface FixtureState {
  light: boolean
  chatTheme: 'compact' | 'modern'
}
interface ColorCase {
  color: string
  accent: number[]
}
interface Evidence extends FixtureState {
  width: number
  screenshot: string
  backgroundPixels: Record<string, number[]>
  emotePixels: number
  hiddenRevealed: boolean
}
const colors: ColorCase[] = [
  { color: 'primary', accent: [145, 70, 255] },
  { color: 'blue', accent: [30, 105, 255] },
  { color: 'green', accent: [0, 168, 107] },
  { color: 'orange', accent: [255, 179, 26] },
  { color: 'purple', accent: [145, 70, 255] },
  { color: 'unknown', accent: [145, 70, 255] },
]
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
const image = await sharp({ create: { width: 12, height: 12, channels: 4, background: '#ff00ff' } })
  .png()
  .toBuffer()
const imageUrl = `data:image/png;base64,${image.toString('base64')}`
function message(id: string, announcement?: string): NormalizedChatMessage {
  return {
    id,
    platform: 'twitch',
    channelId: 'qa',
    type: 'message',
    text: `Kappa ${id} https://example.com/announce${
      id === 'purple'
        ? ' This longer announcement must wrap onto several lines in a small window while keeping its entire message inside the colored frame.'
        : ''
    }`,
    timestamp: new Date('2026-11-03T09:59:23Z'),
    author: {
      id: 'qa-mod',
      username: 'oceanofapathy',
      displayName: 'OceanOfApathy',
      color: '#12AB34',
      badges: [{ id: 'moderator/1', type: 'moderator', text: 'MOD' }],
    },
    emotes: [{ id: 'qa-emote', name: 'Kappa', imageUrl, positions: [{ start: 0, end: 4 }] }],
    metadata: announcement ? { announcement } : undefined,
  }
}
const messages = colors.map(({ color }) => message(color, color))
const ordinary = message('ordinary-neighbor')
const hidden = message('hidden', 'orange')
const state = createStore<FixtureState>({ light: false, chatTheme: 'compact' })
const backend = getDesktopBackend()
let renderer: GpuixRenderer | undefined
let commits = 0
function Content() {
  const active = useGpuixRequired()
  const selected = useStore(state)
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    renderer = active
  }, [active])
  React.useEffect(() => {
    commits++
  })
  const theme = selected.light ? lightTheme : darkTheme
  return (
    <ThemeContext.Provider value={theme}>
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.bg,
          paddingTop: 12,
          gap: 5,
        }}
      >
        {[...messages, ordinary, hidden].map((item) => (
          <div key={`${selected.light}-${selected.chatTheme}-${item.id}`}>
            <ChatMessage
              message={item}
              chatTheme={selected.chatTheme}
              showTimestamp
              showAvatar={false}
              showPlatformColorStripe={false}
              fontSize={14}
              hiddenLabel={item === hidden ? 'Ignored announcement — click to reveal' : undefined}
            />
          </div>
        ))}
      </div>
    </ThemeContext.Provider>
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
function nodeFor(testId: string): AutomationNode {
  const node = nodes().find((entry) => entry.testId === testId)
  assert(node, `Missing ${testId}`)
  return node
}
function bounds(testId: string) {
  const box = current().getPaintedElementBounds(nodeFor(testId).id)
  assert(box, `Unpainted ${testId}`)
  return box
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(20)
  }
}
const evidence: Evidence[] = []
try {
  await manager.start()
  await until(() => !!renderer, 'native mount')
  await until(() => typeof imageSnapshot(imageUrl) === 'string', 'local emote image')
  await focusNativeQaWindow('TwirChat')
  for (const width of [900, 420]) {
    await nativeWindow(current()).setWindowBounds({ width, height: 900 })
    for (const light of [false, true]) {
      for (const chatTheme of ['compact', 'modern'] satisfies FixtureState['chatTheme'][]) {
        const previous = commits
        state.set({ light, chatTheme })
        await until(() => commits > previous, 'fixture commit')
        await Bun.sleep(180)
        const painted = current().getPaintedText().join(' ')
        assert.equal(painted.split('Announcement').length - 1, colors.length)
        assert(painted.includes('OceanOfApathy'), 'Sender remains visible.')
        assert(painted.includes('MOD'), 'Sender badge remains visible.')
        assert(painted.includes('example.com/announce'), 'Link token remains visible.')
        assert(painted.includes('ordinary-neighbor'), 'Ordinary neighbor remains visible.')
        assert(!nodes().some((node) => node.testId === 'chat-announcement-ordinary-neighbor'))
        assert(!nodes().some((node) => node.testId === 'chat-announcement-hidden'))
        for (const { color } of colors) {
          const frame = bounds(`chat-announcement-${color}`)
          assert(frame.x >= 0 && frame.x + frame.width <= width + 1, `${color} frame in bounds`)
          assert(frame.y + frame.height <= 900, `${color} frame fully visible`)
          for (const child of flatten(nodeFor(`chat-announcement-${color}`))) {
            const box = current().getPaintedElementBounds(child.id)
            if (!box || box.width === 0) continue
            assert(box.x >= frame.x - 1, `${color} child starts inside frame`)
            assert(
              box.x + box.width <= frame.x + frame.width + 1,
              `${color} child ends inside frame`,
            )
          }
        }
        const screenshot = await captureGuiQaDisplay(
          `announcements-${width}-${light ? 'light' : 'dark'}-${chatTheme}`,
        )
        const pixels = await sharp(screenshot)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        const window = getNativeQaWindowGeometry('TwirChat')
        const backgrounds: Record<string, number[]> = {}
        const base = light ? [240, 239, 244] : [23, 22, 28]
        const alpha = light ? 0.12 : 0.2
        for (const { color, accent } of colors) {
          const header = bounds(`chat-announcement-header-${color}`)
          const x = Math.floor(window.x + header.x + header.width - 5)
          const y = Math.floor(window.y + header.y + header.height / 2)
          const offset = (y * pixels.info.width + x) * 4
          const sample = Array.from(pixels.data.subarray(offset, offset + 3))
          backgrounds[color] = sample
          for (const channel of [0, 1, 2]) {
            const expected = (accent[channel] ?? 0) * alpha + (base[channel] ?? 0) * (1 - alpha)
            assert(
              Math.abs((sample[channel] ?? 0) - expected) <= 3,
              `${color} banner must paint its Twitch color: ${sample.join(', ')} expected ${expected}`,
            )
          }
        }
        assert.equal(
          new Set(['blue', 'green', 'orange', 'purple'].map((color) => String(backgrounds[color])))
            .size,
          4,
        )
        let emotePixels = 0
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          if (
            (pixels.data[offset] ?? 0) > 240 &&
            (pixels.data[offset + 1] ?? 0) < 15 &&
            (pixels.data[offset + 2] ?? 0) > 240
          )
            emotePixels++
        }
        assert(emotePixels > 100, 'Emote artwork must still paint inside announcement rows.')
        const ignored = bounds('ignored-message')
        const click = Bun.spawnSync(
          [
            '/usr/bin/xdotool',
            'mousemove',
            '--sync',
            String(Math.round(window.x + ignored.x + 20)),
            String(Math.round(window.y + ignored.y + ignored.height / 2)),
            'click',
            '1',
          ],
          { env: process.env, timeout: 5000 },
        )
        assert.equal(click.exitCode, 0, click.stderr.toString())
        await until(
          () => nodes().some((node) => node.testId === 'chat-announcement-hidden'),
          'ignored announcement revealed by native pointer input',
        )
        assert(bounds('chat-announcement-hidden').height > ignored.height)
        evidence.push({
          width,
          light,
          chatTheme,
          screenshot,
          backgroundPixels: backgrounds,
          emotePixels,
          hiddenRevealed: true,
        })
      }
    }
  }
  await Bun.write(
    join(session, 'announcements-result.json'),
    JSON.stringify(
      { ok: true, nodeEnv: process.env.NODE_ENV, reactVersion: React.version, evidence },
      null,
      2,
    ),
  )
} catch (error) {
  await captureGuiQaDisplay('announcements-failure')
  await Bun.write(
    join(session, 'announcements-failure.json'),
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
  await manager.quit()
  backend.dispose?.()
}
process.exit(0)
