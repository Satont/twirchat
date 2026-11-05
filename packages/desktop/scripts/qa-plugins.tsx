import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { GpuixRenderer } from '@gpuix/native'
import { z } from 'zod'

import type { NativeWindowControls } from '../src/gpuix/native-window'
import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { focusNativeQaWindow } from './qa-x11'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const { useEffect } = await import('react')
const { GpuixRenderer: NativeRenderer } = await import('@gpuix/native')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { App } = await import('../src/gpuix/components/App')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { loadInitialData, wireBackendToStores } = await import('../src/gpuix/state/app')
const { wireActiveWatchedChannels } = await import('../src/gpuix/state/watched-subscriptions')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')

interface AutomationNode {
  id: number
  testId?: string
  children: AutomationNode[]
}
const nodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    children: z.array(nodeSchema).default([]),
  }),
)
const directory = process.env.TWIRCHAT_QA_SESSION_DIR
assert(directory)
const fixture = join(directory, 'plugin-fixture')
const builtinCommandProof = join(directory, 'builtin-command.txt')
await mkdir(fixture)
const manifest = join(fixture, 'manifest.json')
await Bun.write(
  manifest,
  JSON.stringify({
    id: 'qa-plugin',
    name: 'Local Echo',
    version: '1.0.0',
    apiVersion: 1,
    entry: 'index.ts',
  }),
)
await Bun.write(
  join(fixture, 'index.ts'),
  `export default function activate(api) {
    const session = crypto.randomUUID()
    let messages = 0
    api.registerCommand('local-echo', ({ channel, args }) =>
      api.addSystemMessage(channel, 'COMMAND ' + args.join(' ')),
    )
    api.registerCommand('plugin-probe', async ({ args }) => {
      await Bun.write(${JSON.stringify(builtinCommandProof)}, args.join(' '))
    })
    api.registerTransport('loop', {
      name: 'Echo transport',
      connect(channelId, { emitMessage, setStatus }) {
        setStatus({ status: 'connected' })
        emitMessage({ id: session + '-' + ++messages, author: { id: 'qa', name: 'QA' }, text: 'OPEN ' + channelId })
      },
      sendMessage(channelId, text, { emitMessage }) {
        emitMessage({ id: session + '-' + ++messages, author: { id: 'qa', name: 'QA' }, text: 'SENT ' + text })
      },
    })
  }`,
)

const backend = getDesktopBackend()
const plugins = backend.plugins
assert(plugins)
const stopMessages = wireBackendToStores(backend)
const stopConnections = wireActiveWatchedChannels(backend)
let renderer: (GpuixRenderer & NativeWindowControls) | undefined
function Main() {
  const candidate = useGpuixRequired()
  useEffect(() => {
    assert(candidate instanceof NativeRenderer)
    renderer = nativeWindow(candidate)
  }, [candidate])
  return <App />
}

function current() {
  assert(renderer)
  return renderer
}
function flatten(node: AutomationNode): AutomationNode[] {
  return [node, ...node.children.flatMap(flatten)]
}
function bounds(id: string) {
  if (!renderer) return null
  const node = flatten(nodeSchema.parse(JSON.parse(renderer.getAutomationTree()))).find(
    (candidate) => candidate.testId === id,
  )
  return node ? renderer.getPaintedElementBounds(node.id) : null
}
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 5_000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    // eslint-disable-next-line no-await-in-loop
    await Bun.sleep(30)
  }
}
async function click(id: string) {
  await until(() => Boolean(bounds(id)), id)
  const rectangle = bounds(id)
  assert(rectangle, id)
  const x = rectangle.x + rectangle.width / 2
  const y = rectangle.y + rectangle.height / 2
  current().simulateMouseDown(x, y, 0)
  current().simulateMouseUp(x, y, 0)
  await Bun.sleep(80)
}
async function fill(id: string, text: string) {
  await click(id)
  current().simulateKeystrokes('ctrl-a')
  const child = Bun.spawn(['/usr/bin/xdotool', 'type', '--clearmodifiers', '--', text], {
    stdout: 'ignore',
    stderr: 'inherit',
  })
  assert.equal(await child.exited, 0, 'native text input')
  await Bun.sleep(80)
}
function painted(text: string): boolean {
  return current().getPaintedText().join(' ').includes(text)
}
async function settings() {
  await click('nav-settings')
  await fill('settings-search', 'plugins')
  await until(() => Boolean(bounds('plugin-manifest-path')), 'Plugins section')
}

const manager = new DesktopWindowManager(
  backend,
  () => <Main />,
  () => {},
)
try {
  await loadInitialData(backend)
  await manager.start()
  await until(() => Boolean(renderer), 'main window')
  await current().setWindowBounds({ width: 680, height: 820 })
  await focusNativeQaWindow('TwirChat')
  await settings()
  assert(painted('No plugins installed.'))
  await fill('plugin-manifest-path', manifest)
  await click('plugin-install')
  await until(() => plugins.list()[0]?.status === 'disabled', 'installed disabled')
  await click('plugin-toggle-qa-plugin')
  await until(() => plugins.list()[0]?.status === 'running', 'enabled')
  await captureGuiQaDisplay('plugins-settings-narrow')

  await current().setWindowBounds({ width: 1180, height: 820 })
  await click('nav-chat')
  await fill('chat-input', '/plugin-pro')
  await until(() => painted('/plugin-probe'), 'plugin command autocomplete in standard chat')
  await fill('chat-input', '/plugin-probe native')
  current().simulateKeystrokes('enter')
  await until(() => Bun.file(builtinCommandProof).size > 0, 'plugin command from standard chat')
  assert.equal(await Bun.file(builtinCommandProof).text(), 'native')
  await click('tab-add')
  await click('add-platform-plugin:qa-plugin:loop')
  await fill('add-channel-input', 'CaseSensitive')
  await click('add-channel-confirm')
  await until(() => painted('OPEN CaseSensitive'), 'transport channel opens')
  await fill('plugin-chat-input', 'hello')
  current().simulateKeystrokes('enter')
  await until(() => painted('SENT hello'), 'transport send')
  await fill('plugin-chat-input', '/local-echo native')
  current().simulateKeystrokes('enter')
  await until(() => painted('COMMAND native'), 'plugin command')
  await captureGuiQaDisplay('plugins-transport')

  await settings()
  await click('plugin-toggle-qa-plugin')
  await until(() => plugins.list()[0]?.status === 'disabled', 'disabled')
  await click('nav-chat')
  await until(() => painted('Enable the plugin'), 'saved channel with disabled plugin')
  await settings()
  await click('plugin-toggle-qa-plugin')
  await until(() => plugins.list()[0]?.status === 'running', 're-enabled')
  await click('nav-chat')
  await until(() => painted('Connected'), 'transport connected again')
  await fill('plugin-chat-input', 'reconnected')
  current().simulateKeystrokes('enter')
  await until(() => painted('SENT reconnected'), 'saved transport reconnects')
  await settings()
  await click('plugin-remove-qa-plugin')
  await until(() => plugins.list().length === 0, 'removed')
  assert.equal((await backend.api.getWatchedChannels())[0]?.channelSlug, 'CaseSensitive')
  assert(await Bun.file(manifest).exists(), 'Removing a plugin preserves its source')
  await Bun.write(
    join(directory, 'plugins-result.json'),
    JSON.stringify({
      settings: true,
      commands: true,
      autocomplete: true,
      transport: true,
      reconnect: true,
    }),
  )
} finally {
  stopConnections()
  stopMessages()
  await manager.quit()
  await backend.shutdownPlugins?.()
  backend.dispose?.()
}
process.exit(0)
