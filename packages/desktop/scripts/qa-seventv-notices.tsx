import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { buildSevenTvSystemMessage } from '../src/services/seventv-system-message'

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
const { emoteStore } = await import('../src/gpuix/state/app')
const { imageSnapshot } = await import('../src/gpuix/state/image-cache')
const { getDbPath } = await import('../src/runtime-config')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const sharp = (await import('sharp')).default

const asset = process.argv[2]
assert(asset, 'Pass a downloaded public RAGEY GIF as an absolute path for the sandbox to bind.')
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session)
const backend = getDesktopBackend()
const imageUrl = 'https://cdn.7tv.app/emote/01GBFAYKGR000FWWN7MDZZ8XQN/1x.gif'
const cache = join(dirname(getDbPath()), 'image-cache')
await mkdir(cache, { recursive: true })
await Bun.write(
  join(cache, `${createHash('sha256').update(imageUrl).digest('hex').slice(0, 32)}.gif`),
  Bun.file(asset),
)
const pendingRequests = new Set<ReturnType<typeof Promise.withResolvers<Response>>>()
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === '/pending') {
      const response = Promise.withResolvers<Response>()
      pendingRequests.add(response)
      return response.promise
    }
    return new Response('Missing image', { status: 404 })
  },
})
const urls = {
  cached: imageUrl,
  pending: `http://127.0.0.1:${server.port}/pending`,
  failed: `http://127.0.0.1:${server.port}/failed`,
}
const mode = createStore<keyof typeof urls>('cached')
const action = createStore<'added' | 'removed'>('added')
const emote = {
  id: '01GBFAYKGR000FWWN7MDZZ8XQN',
  name: 'RAGEY',
  alias: 'RAGEY',
  imageUrl,
  animated: true,
  aspectRatio: 1.4,
  zeroWidth: false,
}
emoteStore.set(new Map([['kick:qa', [{ ...emote, source: 'seventv' }]]]))
let renderer: GpuixRenderer | undefined
function Content() {
  const active = useGpuixRequired()
  const selected = useStore(mode)
  const selectedAction = useStore(action)
  React.useEffect(() => {
    assert(active instanceof NativeRenderer)
    renderer = active
  }, [active])
  const message = buildSevenTvSystemMessage(
    {
      type: 'seventv_system_message',
      platform: 'kick',
      channelId: 'qa',
      action: selectedAction,
      actorName: 'EmoteEditor',
      emote: { ...emote, imageUrl: urls[selected] },
    },
    { id: 'notice', timestamp: new Date('2026-11-03T06:36:18Z') },
  )
  return React.createElement(
    'div',
    { style: { width: '100%', height: '100%', backgroundColor: '#16161c', paddingTop: 30 } },
    React.createElement(ChatMessage, {
      message,
      fontSize: 18,
      visible: true,
      showTimestamp: false,
    }),
  )
}
const manager = new DesktopWindowManager(
  backend,
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
async function pixels(path: string) {
  return sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}
const evidence: Array<{
  width: number
  cached: string
  pending: string
  failed: string
  artworkPixels: number
  differenceBounds: number[]
}> = []
try {
  await manager.start()
  await until(() => !!renderer, 'native mount')
  for (const width of [900, 420]) {
    await nativeWindow(current()).setWindowBounds({ width, height: 260 })
    action.set('added')
    mode.set('cached')
    await until(() => typeof imageSnapshot(imageUrl) === 'string', 'cached artwork ready')
    await until(
      () => current().getPaintedText().join('').includes('added to the channel by EmoteEditor'),
      'actor painted in add notice',
    )
    await Bun.sleep(500)
    const cached = await captureGuiQaDisplay(`seventv-cached-${width}`)
    mode.set('pending')
    await until(() => pendingRequests.size > 0, 'pending image request')
    await Bun.sleep(200)
    assert(
      current().getPaintedText().join(' ').includes('«RAGEY»'),
      'Alias remains visible while artwork loads.',
    )
    const pending = await captureGuiQaDisplay(`seventv-pending-${width}`)
    const [loaded, loading] = await Promise.all([pixels(cached), pixels(pending)])
    assert.equal(loaded.data.length, loading.data.length)
    let artworkPixels = 0
    let left = loaded.info.width,
      top = loaded.info.height,
      right = 0,
      bottom = 0
    for (let offset = 0; offset < loaded.data.length; offset += 4) {
      const changed = [0, 1, 2].some(
        (channel) =>
          Math.abs((loaded.data[offset + channel] ?? 0) - (loading.data[offset + channel] ?? 0)) >
          15,
      )
      if (!changed) continue
      artworkPixels++
      const x = (offset / 4) % loaded.info.width,
        y = Math.floor(offset / 4 / loaded.info.width)
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
    assert(
      artworkPixels > 30,
      'Cached artwork must paint actual pixels compared with an empty pending slot.',
    )
    assert(
      right - left < 60 && bottom - top < 40,
      'Pixel difference must stay inside the emote artwork slot.',
    )
    mode.set('failed')
    await until(() => imageSnapshot(urls.failed) === null, 'failed image fallback')
    await Bun.sleep(100)
    assert(
      current().getPaintedText().join(' ').includes('«RAGEY»'),
      'Alias remains visible after artwork failure.',
    )
    const failed = await captureGuiQaDisplay(`seventv-failed-${width}`)
    action.set('removed')
    await until(
      () => current().getPaintedText().join('').includes('removed from the channel by EmoteEditor'),
      'actor painted in remove notice',
    )
    evidence.push({
      width,
      cached,
      pending,
      failed,
      artworkPixels,
      differenceBounds: [left, top, right, bottom],
    })
  }
  await Bun.write(
    join(session, 'seventv-notices-result.json'),
    JSON.stringify({ ok: true, evidence }, null, 2),
  )
} catch (error) {
  await captureGuiQaDisplay('seventv-notices-failure')
  await Bun.write(
    join(session, 'seventv-notices-failure.json'),
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
  for (const request of pendingRequests) request.resolve(new Response(null, { status: 204 }))
  await server.stop(true)
}
process.exit(0)
