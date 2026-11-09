import assert from 'node:assert/strict'

import type { DonationConnections, DonationProvider } from '@twirchat/shared/donations'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import('@gpuix/react')
const { BackendContext } = await import('../src/gpuix/backend/context')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { SettingsPanel } = await import('../src/gpuix/components/SettingsPanel')
const { settingsStore, wireBackendToStores } = await import('../src/gpuix/state/app')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { DEFAULT_TRANSLATION_SETTINGS } = await import('../src/services/translation')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')

const width = process.argv.includes('--wide') ? 1280 : 650
const events = createDesktopEvents()
let connections: DonationConnections = {
  donationalerts: { status: 'disconnected' },
  donatepay: { status: 'disconnected' },
  memealerts: { status: 'connected' },
}
let clipboard = ''
let pasteReceived = false
const update = (provider: DonationProvider, state: DonationConnections[DonationProvider]) => {
  connections = { ...connections, [provider]: state }
  events.emit('donation_connections', connections)
}
const backend = {
  events,
  api: {
    getSettings: async () => DEFAULT_SETTINGS,
    getAppVersion: async () => 'Donations QA',
    getUiState: async () => null,
    getTranslationSettings: async () => ({
      settings: DEFAULT_TRANSLATION_SETTINGS,
      credentials: [],
    }),
    getDonationConnections: async () => connections,
    readClipboard: async () => clipboard,
    connectDonationProvider: async ({ provider, apiKey }) => {
      if (provider === 'donatepay') {
        pasteReceived = apiKey === clipboard
        update(provider, { status: 'connected' })
      } else update(provider, { status: 'authorizing' })
    },
    disconnectDonationProvider: async ({ provider }) =>
      update(provider, { status: 'disconnected' }),
  },
}
settingsStore.set({ ...DEFAULT_SETTINGS, showAvatars: false })
const stop = wireBackendToStores(backend)
const renderer = createRenderer()
renderer.init({ title: 'TwirChat donations QA', width, height: 780, focus: false })
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)

function mount(children) {
  root.render(
    <BackendContext.Provider value={backend}>
      <TooltipProvider>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: '#16161c',
          }}
        >
          {children}
        </div>
      </TooltipProvider>
    </BackendContext.Provider>,
  )
}

function nodes(node = JSON.parse(renderer.getAutomationTree())) {
  return node ? [node, ...(node.children ?? []).flatMap((child) => nodes(child))] : []
}

const find = (testId) => nodes().find((node) => node.testId === testId)
const painted = (text) => renderer.getPaintedText().some((run) => run.includes(text))
async function until(check, label) {
  const deadline = performance.now() + 4000
  while (!check()) {
    assert.ok(performance.now() < deadline, `Timed out: ${label}`)
    // The next attempt needs a fresh native frame.
    // oxlint-disable-next-line no-await-in-loop
    await Bun.sleep(30)
  }
}
async function click(testId) {
  await until(() => find(testId), testId)
  const bounds = renderer.getElementBounds(find(testId).id)
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0, testId)
  renderer.simulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)
  await Bun.sleep(100)
}

function donate(provider: DonationProvider, id: string, message: string) {
  events.emit('donation_received', {
    id,
    provider,
    username: 'Supporter',
    amount: '250.50',
    currency: 'RUB',
    message,
    timestamp: Date.now(),
  })
}

try {
  mount(<SettingsPanel />)
  await click('settings-search')
  renderer.simulateKeystrokes('d o n a t i o n s')
  await until(() => painted('MemeAlerts'), 'all three providers')
  await click('donation-connect-donationalerts')
  await until(() => painted('Waiting for authorization'), 'OAuth wait state')
  await click('donation-disconnect-donationalerts')
  await until(() => find('donation-connect-donationalerts'), 'OAuth cancellation')
  await click('donation-connect-donatepay')
  await until(() => painted('Copy your DonatePay API key'), 'empty clipboard hint')
  clipboard = 'donatepay-qa-key'
  await click('donation-connect-donatepay')
  await until(() => find('donation-disconnect-donatepay'), 'DonatePay connected')
  assert.ok(pasteReceived)
  assert.ok(!renderer.getAllText().join('').includes(clipboard), 'The API key must stay hidden')
  await captureGuiQaDisplay(`donations-settings-${width}`)

  mount(<ChatView isMain />)
  await until(() => find('chat-pause-button'), 'My channels with no signed-in accounts')
  donate('donationalerts', 'first', 'DA_QA')
  await until(() => painted('DA_QA'), 'first donation')
  await click('chat-pause-button')
  donate('donatepay', 'second', 'DP_QA')
  donate('memealerts', 'third', 'MA_QA')
  donate('memealerts', 'third', 'DUPLICATE_QA')
  await until(() => painted('2 new'), 'two distinct donations while paused')
  assert.ok(!painted('DP_QA') && !painted('MA_QA'))
  await click('chat-pause-button')
  await until(() => painted('DP_QA') && painted('MA_QA'), 'all donations on resume')
  assert.ok(painted('donated 250.50 RUB') && !painted('DUPLICATE_QA'))
  await captureGuiQaDisplay(`donations-chat-${width}`)
  await click('chat-mentions-button')
  await until(() => !painted('MA_QA'), 'mentions filter excludes donations')
  await click('chat-mentions-button')
  await until(() => painted('MA_QA'), 'clearing filter restores donations')
  await click('chat-search-button')
  await click('chat-search')
  renderer.simulateKeystrokes('m a')
  await until(() => painted('MA_QA') && !painted('DP_QA'), 'search matches donation text')

  mount(
    <ChatView
      key="watched"
      layoutTabId="qa-tab"
      watchedChannel={{
        id: 'qa',
        platform: 'kick',
        channelSlug: 'qa',
        displayName: 'QA',
        createdAt: 0,
      }}
    />,
  )
  await until(
    () => find('chat-pane') && !find('donation-memealerts-third'),
    'watched chat isolates donations',
  )
  console.log(`Native donations settings and chat QA passed at ${width}px.`)
} catch (error) {
  await captureGuiQaDisplay(`donations-failure-${width}`).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  stop()
  loop.stop()
  root.unmount()
  process.exit(process.exitCode ?? 0)
}
