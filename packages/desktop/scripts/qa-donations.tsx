import assert from 'node:assert/strict'

import type {
  DonationConnections,
  DonationEvent,
  DonationOAuthAvailability,
  DonationProvider,
} from '@twirchat/shared/donations'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import('@gpuix/react')
const { BackendContext } = await import('../src/gpuix/backend/context')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { ChatView } = await import('../src/gpuix/components/ChatView')
const { SettingsPanel } = await import('../src/gpuix/components/SettingsPanel')
const { setLanguage } = await import('../src/gpuix/i18n')
const { settingsStore, wireBackendToStores } = await import('../src/gpuix/state/app')
const { darkTheme, lightTheme } = await import('../src/gpuix/theme')
const { ThemeContext } = await import('../src/gpuix/theme-context')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { DEFAULT_TRANSLATION_SETTINGS } = await import('../src/services/translation')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')

const width = process.argv.includes('--wide') ? 1280 : 650
const theme = process.argv.includes('--light') ? lightTheme : darkTheme
const memeUnavailable = process.argv.includes('--meme-unavailable')
const donationAlertsOAuthAvailable = !process.argv.includes('--donationalerts-unavailable')
const captureSuffix = `${width}${theme.isLight ? '-light' : ''}${memeUnavailable ? '-meme-unavailable' : ''}`
const fixtureSettings = {
  ...DEFAULT_SETTINGS,
  showAvatars: false,
  language: memeUnavailable ? 'ru' : 'en',
} satisfies typeof DEFAULT_SETTINGS
const events = createDesktopEvents()
const availability = Promise.withResolvers<DonationOAuthAvailability | null>()
if (!memeUnavailable) availability.resolve(null)
let connections: DonationConnections = {
  donationalerts: { status: 'disconnected' },
  donatepay: { status: 'disconnected' },
  memealerts: { status: memeUnavailable ? 'disconnected' : 'connected' },
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
    donationAlertsOAuthAvailable,
    getSettings: async () => fixtureSettings,
    getAppVersion: async () => 'Donations QA',
    getUiState: async () => null,
    getTranslationSettings: async () => ({
      settings: DEFAULT_TRANSLATION_SETTINGS,
      credentials: [],
    }),
    getDonationConnections: async () => connections,
    getDonationOAuthAvailability: () => availability.promise,
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
settingsStore.set(fixtureSettings)
setLanguage(fixtureSettings.language)
const stop = wireBackendToStores(backend)
const renderer = createRenderer()
renderer.init({ title: 'TwirChat donations QA', width, height: 780, focus: false })
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)

function mount(children) {
  root.render(
    <BackendContext.Provider value={backend}>
      <TooltipProvider>
        <ThemeContext.Provider value={theme}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              height: '100%',
              backgroundColor: theme.bg,
            }}
          >
            {children}
          </div>
        </ThemeContext.Provider>
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

function donate(
  provider: DonationProvider,
  id: string,
  details: Pick<DonationEvent, 'username' | 'amount' | 'currency' | 'message'>,
) {
  events.emit('donation_received', {
    id,
    provider,
    ...details,
    timestamp: Date.now(),
  })
}

try {
  mount(<SettingsPanel />)
  await click('settings-search')
  renderer.simulateKeystrokes('d o n a t i o n s')
  await until(() => painted('MemeAlerts'), 'all three providers')
  if (memeUnavailable) {
    await until(() => painted('Проверяем доступность…'), 'checking OAuth availability')
    assert.equal(Boolean(find('donation-connect-donationalerts')), donationAlertsOAuthAvailable)
    assert.ok(!find('donation-connect-memealerts'))
    assert.ok(find('donation-connect-donatepay'))
    availability.resolve({ memealerts: false })
    await until(() => painted('Пока не включено'), 'MemeAlerts disabled by backend')
    assert.ok(!find('donation-connect-memealerts'))
    assert.equal(Boolean(find('donation-connect-donationalerts')), donationAlertsOAuthAvailable)
    assert.ok(find('donation-connect-donatepay'))
  }
  await captureGuiQaDisplay(`donations-settings-${captureSuffix}`)
  if (memeUnavailable) {
    update('memealerts', { status: 'connected' })
    await until(() => find('donation-disconnect-memealerts'), 'existing MemeAlerts connection')
    if (donationAlertsOAuthAvailable) assert.ok(!painted('Пока не включено'))
    await click('donation-disconnect-memealerts')
    await until(() => painted('Пока не включено'), 'disconnected MemeAlerts stays unavailable')
    assert.ok(!find('donation-connect-memealerts'))
  }
  if (donationAlertsOAuthAvailable) {
    await click('donation-connect-donationalerts')
    await until(() => painted('Waiting for authorization'), 'OAuth wait state')
    await click('donation-disconnect-donationalerts')
    await until(() => find('donation-connect-donationalerts'), 'OAuth cancellation')
  } else {
    const notEnabled = memeUnavailable ? 'Пока не включено' : 'Not enabled yet'
    await until(() => painted(notEnabled), 'DonationAlerts disabled without local configuration')
    assert.ok(!find('donation-connect-donationalerts'))
  }
  await click('donation-connect-donatepay')
  await until(() => painted('Copy your DonatePay API key'), 'empty clipboard hint')
  clipboard = 'donatepay-qa-key'
  await click('donation-connect-donatepay')
  await until(() => find('donation-disconnect-donatepay'), 'DonatePay connected')
  assert.ok(pasteReceived)
  assert.ok(!renderer.getAllText().join('').includes(clipboard), 'The API key must stay hidden')

  mount(<ChatView isMain />)
  await until(() => find('chat-pause-button'), 'My channels with no signed-in accounts')
  setLanguage('en')
  donate('donationalerts', 'first', {
    username: 'Luna',
    amount: '250.50',
    currency: 'RUB',
    message: 'That comeback was unreal. Great stream!',
  })
  await until(() => painted('Luna'), 'first donation')
  await click('chat-pause-button')
  donate('donatepay', 'second', {
    username: 'TeaBreak',
    amount: '500',
    currency: 'RUB',
    message: 'For the next co-op night.',
  })
  const memeDonation = {
    username: 'PixelCat',
    amount: '5',
    currency: 'coins',
    message: 'Maximum meme power unlocked.',
  }
  donate('memealerts', 'third', memeDonation)
  donate('memealerts', 'third', { ...memeDonation, message: 'DUPLICATE_QA' })
  await until(() => painted('2 new'), 'two distinct donations while paused')
  assert.ok(!painted('TeaBreak') && !painted('PixelCat'))
  await click('chat-pause-button')
  await until(() => painted('TeaBreak') && painted('PixelCat'), 'all donations on resume')
  assert.ok(painted('donated 250.50 RUB') && !painted('DUPLICATE_QA'))
  await captureGuiQaDisplay(`donations-chat-${captureSuffix}`)
  await click('chat-mentions-button')
  await until(() => !painted('PixelCat'), 'mentions filter excludes donations')
  await click('chat-mentions-button')
  await until(() => painted('PixelCat'), 'clearing filter restores donations')
  await click('chat-search-button')
  await click('chat-search')
  renderer.simulateKeystrokes('m a')
  await until(() => painted('PixelCat') && !painted('TeaBreak'), 'search matches donation text')

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
  await captureGuiQaDisplay(`donations-failure-${captureSuffix}`).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  stop()
  loop.stop()
  root.unmount()
  process.exit(process.exitCode ?? 0)
}
