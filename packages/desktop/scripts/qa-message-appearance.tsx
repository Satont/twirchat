if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')

import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { ChatMessage } = await import('../src/gpuix/components/ChatMessage')
const { PlatformsPanel } = await import('../src/gpuix/components/PlatformsPanel')
const { RemoteImage } = await import('../src/gpuix/components/ui/RemoteImage')
const { Text } = await import('../src/gpuix/components/ui/Text')
const { accountsStore, channelStatusStore } = await import('../src/gpuix/state/app')
const { createStore, useStore } = await import('../src/gpuix/state/create-store')
const { imageSnapshot } = await import('../src/gpuix/state/image-cache')
const { imageThumbnailer } = await import('../src/services/image-thumbnail')
const { setRuntimeConfig } = await import('../src/runtime-config')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')

interface AutomationNode {
  id: number
  testId?: string
  children?: AutomationNode[]
}
const nodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    children: z.array(nodeSchema).optional(),
  }),
)
const mode = createStore<'messages' | 'platforms'>('messages')
const directory = process.env.TWIRCHAT_QA_SESSION_DIR
assert.ok(directory, 'Private QA artifact directory is required.')
const sharp = (await import('sharp')).default
const stripes = Array.from(
  { length: 150 },
  (_, i) => `<path d="M${i * 2} 0v300" stroke="${i % 2 ? '#eeeeff' : '#302050'}"/>`,
).join('')
const image = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#6450a0"/>${stripes}<circle cx="150" cy="150" r="110" fill="#444477"/><path d="M50 240Q150 20 250 240" fill="none" stroke="#ddd" stroke-width="5"/><circle cx="110" cy="120" r="14" fill="#fff"/><circle cx="190" cy="120" r="14" fill="#fff"/></svg>`,
  ),
)
  .png()
  .toBuffer()
const avatarUrl = `data:image/png;base64,${image.toString('base64')}`
const messages: NormalizedChatMessage[] = [14, 18].map((fontSize) => ({
  id: `compact-${fontSize}`,
  platform: 'twitch',
  channelId: 'qa-owner',
  type: 'message',
  text: '123 Проверка длинного сообщения с переносом без лишнего отступа после времени.',
  timestamp: new Date('2026-11-03T00:31:41Z'),
  author: {
    id: 'qa-owner',
    username: 'qa-owner',
    displayName: 'OceanOfApathy',
    avatarUrl,
    badges: [],
  },
  emotes: [],
}))
let renderer: GpuixRenderer | undefined

function Content() {
  const current = useGpuixRequired()
  const selected = useStore(mode)
  React.useEffect(() => {
    assert.ok(current instanceof NativeRenderer, 'QA requires the native renderer.')
    renderer = current
  }, [current])
  if (selected === 'platforms') return React.createElement(PlatformsPanel)
  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#16161c',
        paddingTop: 20,
        gap: 16,
      },
    },
    React.createElement(
      Text,
      { style: { color: '#ddd', fontSize: 14 } },
      'Compact messages — 14 / 18 px',
    ),
    ...messages.map((message, i) =>
      React.createElement(ChatMessage, {
        key: message.id,
        message,
        chatTheme: 'compact',
        showTimestamp: true,
        showAvatar: true,
        fontSize: i === 0 ? 14 : 18,
        visible: true,
      }),
    ),
    React.createElement(
      Text,
      { style: { color: '#ddd', fontSize: 14 } },
      'Original / Lanczos3 — 18 / 28 / 32 px',
    ),
    ...[18, 28, 32].map((size) =>
      React.createElement(
        'div',
        {
          key: size,
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
            paddingLeft: 12,
          },
        },
        React.createElement(
          Text,
          { style: { color: '#ddd', fontSize: 12, width: 40 } },
          `${size}px`,
        ),
        React.createElement(RemoteImage, {
          url: avatarUrl,
          objectFit: 'cover',
          style: { width: size, height: size, borderRadius: size / 2 },
        }),
        React.createElement(RemoteImage, {
          url: avatarUrl,
          avatarSize: size,
          objectFit: 'cover',
          style: { width: size, height: size, borderRadius: size / 2 },
        }),
      ),
    ),
  )
}

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request) {
    if (new URL(request.url).pathname === '/api/stream-status')
      return Response.json({
        isLive: true,
        title: 'Appearance QA stream',
        categoryName: 'Software and Game Development',
        viewerCount: 19,
      })
    return new Response('Not found', { status: 404 })
  },
})
const backend = getDesktopBackend()
setRuntimeConfig({ backendUrl: `http://127.0.0.1:${server.port}` })
const manager = new DesktopWindowManager(
  backend,
  () => React.createElement(Content),
  () => {},
)

function activeRenderer(): GpuixRenderer {
  assert.ok(renderer, 'Native renderer must have mounted.')
  return renderer
}
function nodes(
  node = nodeSchema.parse(JSON.parse(activeRenderer().getAutomationTree())),
): AutomationNode[] {
  return [node, ...(node.children ?? []).flatMap((child) => nodes(child))]
}
function bounds(id: string) {
  const node = nodes().find((entry) => entry.testId === id)
  assert.ok(node, `Missing native element ${id}`)
  const box = activeRenderer().getElementBounds(node.id)
  assert.ok(box, `Missing native bounds ${id}`)
  return box
}
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(25)
  }
  throw new Error(`Timed out: ${label}`)
}

try {
  await manager.start()
  await until(() => !!renderer, 'native mount')
  const sourcePath = await (async () => {
    await until(() => typeof imageSnapshot(avatarUrl) === 'string', 'avatar download')
    const path = imageSnapshot(avatarUrl)
    assert.equal(typeof path, 'string')
    if (typeof path !== 'string') throw new Error('Avatar source was not loaded.')
    return path
  })()
  await Promise.all([18, 23, 28, 32].map((size) => imageThumbnailer.render(sourcePath, size)))
  await Bun.sleep(300)
  const measurements: { width: number; fontSize: number; gap: number }[] = []
  for (const width of [900, 420]) {
    await nativeWindow(activeRenderer()).setWindowBounds({ width, height: 620 })
    await Bun.sleep(200)
    for (const fontSize of [14, 18]) {
      const timestamp = bounds(`chat-timestamp-compact-${fontSize}`)
      const avatar = bounds(`chat-avatar-compact-${fontSize}`)
      const gap = avatar.x - (timestamp.x + timestamp.width)
      assert.ok(Math.abs(gap - 6) < 1, `Timestamp gap ${gap}px at ${fontSize}px/${width}px`)
      measurements.push({ width, fontSize, gap })
    }
    await captureGuiQaDisplay(`message-appearance-${width}`)
  }
  mode.set('platforms')
  await until(
    () => activeRenderer().getPaintedText().includes('No saved Twitch accounts.'),
    'saved accounts initial load',
  )
  accountsStore.set([
    {
      id: 'qa:twitch',
      platform: 'twitch',
      platformUserId: 'qa-owner',
      username: 'qa-owner',
      displayName: 'QA owner',
      avatarUrl,
      scopes: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ])
  channelStatusStore.set({
    twitch: { platform: 'twitch', status: 'connected', mode: 'authenticated' },
  })
  await nativeWindow(activeRenderer()).setWindowBounds({ width: 1000, height: 800 })
  await until(
    () => activeRenderer().getPaintedText().join(' ').includes('Appearance QA stream'),
    'stream editor',
  )
  const text = activeRenderer().getPaintedText()
  for (const expected of ['Twitch', 'YouTube', 'Kick', 'Disconnect', 'Connect account', 'Edit'])
    assert.ok(text.includes(expected), `Platforms must preserve ${expected}`)
  assert.ok(
    !text.some((run) => /^(Join|# channel name|# Channel ID or handle)$/u.test(run)),
    'Platform channel join controls must be absent.',
  )
  await captureGuiQaDisplay('platforms-without-join')
  await Bun.write(
    join(directory, 'message-appearance-result.json'),
    JSON.stringify(
      { ok: true, measurements, platforms: text, avatarComparisons: [18, 28, 32] },
      null,
      2,
    ),
  )
} catch (error) {
  await captureGuiQaDisplay('message-appearance-failure')
  await Bun.write(
    join(directory, 'message-appearance-failure.json'),
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
  await server.stop(true)
}
process.exit(0)
