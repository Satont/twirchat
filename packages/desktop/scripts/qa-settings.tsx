if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url))
const React = await import(require.resolve('react'))
const { createRenderer, createRoot, startFrameLoop, TooltipProvider } = await import(
  require.resolve('@gpuix/react')
)
const { BackendContext } = await import('../src/gpuix/backend/context')
const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const { SettingsPanel } = await import('../src/gpuix/components/SettingsPanel')
const { SavedAccounts } = await import('../src/gpuix/components/SavedAccounts')
const { DEFAULT_SETTINGS } = await import('@twirchat/shared/types')
const { DEFAULT_IMAGE_UPLOADER_SETTINGS } = await import('../src/services/image-uploader')
const { DEFAULT_TRANSLATION_SETTINGS } = await import('../src/services/translation')
const { accountsStore, settingsStore } = await import('../src/gpuix/state/app')
const { useStore } = await import('../src/gpuix/state/create-store')
const { resolveTheme, ThemeContext } = await import('../src/gpuix/theme-context')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const width = process.argv.includes('--wide') ? 1280 : 680
const calls = []
const values = new Map([
  [
    'custom_commands_v1',
    JSON.stringify([
      { id: 'hello', name: 'hello', template: 'Hello {1;chat}!', showInMessageMenu: false },
    ]),
  ],
])
let durableSettings = structuredClone(DEFAULT_SETTINGS)
let durableUploader = structuredClone(DEFAULT_IMAGE_UPLOADER_SETTINGS)
let twirUploader = null
let twirSignIn = 'pending'
const uploaderPreset = {
  Version: '1.0.0',
  RequestURL: 'https://upload.example.test/images',
  FileFormName: 'image',
  URL: '{json:data.images[0].url}',
  DeletionURL: '{json:data.delete}',
  Headers: { Authorization: 'Bearer qa-token' },
}
let clipboard = JSON.stringify(uploaderPreset)
let failSettings = true
let holdSettings = false
let settingsWrite = null
let commandWrite = null
let holdCommand = false
let saved = ['alpha', 'beta'].map((id) => ({
  id,
  platform: 'twitch',
  platformUserId: id,
  username: id,
  displayName: id === 'alpha' ? 'Alpha Streamer' : 'Beta Moderator',
  connectedAt: 1,
  accessToken: 'mock-never-used',
}))
let active = [saved[0]]
const events = createDesktopEvents()
const methods = {
  getSettings: async () => structuredClone(durableSettings),
  getAppVersion: async () => 'QA isolated mock',
  saveSettings: async (value) => {
    if (failSettings) {
      failSettings = false
      throw new Error('QA disk unavailable')
    }
    if (holdSettings)
      await new Promise((resolve) => {
        settingsWrite = resolve
      })
    durableSettings = structuredClone(value)
  },
  getUiState: async ({ key }) => values.get(key) ?? null,
  setUiState: async ({ key, value }) => {
    if (holdCommand)
      await new Promise((resolve) => {
        commandWrite = resolve
      })
    values.set(key, value)
  },
  getTranslationSettings: async () => ({
    settings: structuredClone(DEFAULT_TRANSLATION_SETTINGS),
    credentials: [],
  }),
  getImageUploaderSettings: async () => structuredClone(twirUploader ?? durableUploader),
  saveImageUploaderSettings: async (value) => {
    if (value.provider === 'twir') {
      twirUploader = structuredClone(value)
      return twirUploader
    }
    durableUploader = structuredClone(value)
    return durableUploader
  },
  connectTwirImageUploader: async ({ signal }) => {
    if (twirSignIn === 'pending') {
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    if (twirSignIn === 'denied') throw new Error('Twir sign-in was denied.')
    twirUploader ??= {
      ...DEFAULT_IMAGE_UPLOADER_SETTINGS,
      provider: 'twir',
      enabled: true,
      confirm: durableUploader.confirm,
      requestUrl: 'https://twir.app/api/v1/uploader/files',
      formField: 'file',
      imageLink: '{data.link}',
      deletionLink: '{data.delete_link}',
    }
    return twirUploader
  },
  disconnectTwirImageUploader: async () => {
    twirUploader = null
    return durableUploader
  },
  readClipboard: async () => clipboard,
  copyText: async ({ text }) => {
    clipboard = text
  },
  getSavedAccounts: async () => structuredClone(saved),
  getAccounts: async () => structuredClone(active),
  setActiveAccount: async ({ accountId }) => {
    active = accountId ? saved.filter((account) => account.id === accountId) : []
    events.emit('accounts_changed', {})
  },
  forgetAccount: async ({ accountId }) => {
    saved = saved.filter((account) => account.id !== accountId)
    active = active.filter((account) => account.id !== accountId)
    events.emit('accounts_changed', {})
  },
  authStart: async () => {
    throw new Error('QA never starts OAuth')
  },
  authLink: async ({ platform }) => ({
    url: `https://auth.example.test/authorize?state=qa-${platform}`,
  }),
}
const backend = {
  events,
  api: new Proxy(methods, {
    get(target, name) {
      return async (...args) => {
        calls.push({ name, args })
        assert.equal(typeof target[name], 'function', `Unexpected backend method ${String(name)}`)
        return target[name](...args)
      }
    },
  }),
}
settingsStore.set(structuredClone(DEFAULT_SETTINGS))
accountsStore.set(active)
const renderer = createRenderer()
renderer.init({
  title: 'TwirChat settings QA',
  appId: process.env.TWIRCHAT_QA_APP_ID,
  focus: false,
  width,
  height: 820,
})
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)
function ThemedFixture({ component }) {
  const theme = resolveTheme(useStore(settingsStore))
  return React.createElement(
    ThemeContext.Provider,
    { value: theme },
    React.createElement(component),
  )
}
function mount(component) {
  root.render(
    React.createElement(
      BackendContext.Provider,
      { value: backend },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(
          'div',
          {
            style: {
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#111114',
            },
          },
          React.createElement(ThemedFixture, { component }),
        ),
      ),
    ),
  )
}
function tree() {
  return JSON.parse(renderer.getAutomationTree())
}
function flatten(node = tree(), parent = null) {
  return [{ ...node, parent }, ...(node.children ?? []).flatMap((child) => flatten(child, node))]
}
function find(testId) {
  const node = flatten().find((item) => item.testId === testId)
  assert.ok(node, `Missing ${testId}`)
  return node
}
function box(node) {
  const bounds = renderer.getElementBounds(node.id)
  assert.ok(
    bounds && bounds.width > 0 && bounds.height > 0,
    `No visible bounds: ${node.testId ?? node.id}`,
  )
  return bounds
}
async function clickNode(node) {
  const b = box(node)
  assert.ok(
    b.y >= 0 && b.y + b.height / 2 < 820,
    `Offscreen click ${node.testId ?? node.id} y=${b.y}`,
  )
  renderer.simulateClick(b.x + b.width / 2, b.y + b.height / 2, 0)
  await Bun.sleep(140)
}
async function click(testId) {
  await clickNode(find(testId))
}
async function type(node, value) {
  await clickNode(node)
  renderer.simulateKeystrokes('ctrl-a')
  renderer.simulateKeystrokes([...value].map((char) => (char === ' ' ? 'space' : char)).join(' '))
  await Bun.sleep(150)
}
function hasText(text) {
  return renderer.getAllText().join('').includes(text)
}
function textNode(text, inside = null) {
  const nodes = flatten(inside ?? tree())
  const fullText = (node) => node.text ?? (node.children ?? []).map(fullText).join('')
  const node = nodes.find((item) => fullText(item) === text)
  assert.ok(node, `Missing text ${text}`)
  return node
}
async function scrollTo(testId) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const node = find(testId)
    const bounds = renderer.getElementBounds(node.id)
    if (bounds && bounds.y >= 200 && bounds.y + bounds.height < 800) return node
    const content = box(find('settings-content'))
    renderer.simulateScrollWheel(
      content.x + content.width / 2,
      content.y + content.height / 2,
      0,
      -250,
    )
    await Bun.sleep(70)
  }
  throw new Error(`Cannot scroll to ${testId}`)
}
try {
  mount(SettingsPanel)
  await Bun.sleep(550)
  assert.deepEqual(
    [...new Set(calls.map((call) => call.name))].sort((left, right) => left.localeCompare(right)),
    ['getAppVersion', 'getSettings'],
  )
  const category = box(find('settings-categories'))
  const content = box(find('settings-content'))
  if (width < 900)
    assert.ok(
      content.y >= category.y + category.height - 1,
      'Narrow navigation must precede content',
    )
  const narrow = await captureGuiQaDisplay(width < 900 ? 'settings-narrow' : 'settings-wide')
  await type(find('settings-search'), 'translation')
  assert.equal(calls.filter((call) => call.name === 'getTranslationSettings').length, 1)
  assert.ok(find('translation-settings'))
  const search = await captureGuiQaDisplay('settings-search')
  const hiddenAppearance = renderer.getElementBounds(find('settings-section-appearance').id)
  assert.ok(!hiddenAppearance || hiddenAppearance.height === 0, 'Filtered appearance still paints')
  await click('settings-search-clear')
  await click('settings-category-commands')
  assert.equal(
    calls.filter((call) => call.name === 'getUiState' && call.args[0].key === 'custom_commands_v1')
      .length,
    1,
  )
  const input = flatten(find('custom-command-hello')).find((node) => node.type === 'input')
  assert.ok(input)
  await type(input, 'draft')
  await click('settings-category-general')
  await click('settings-category-commands')
  await click('settings-save')
  assert.equal(
    JSON.parse(values.get('custom_commands_v1'))[0].name,
    'draft',
    'Draft lost across section navigation',
  )
  await type(
    flatten(find('custom-command-hello')).find((node) => node.type === 'input'),
    'pending',
  )
  holdCommand = true
  await click('settings-save')
  assert.ok(commandWrite)
  await type(
    flatten(find('custom-command-hello')).find((node) => node.type === 'input'),
    'latest',
  )
  commandWrite()
  holdCommand = false
  await Bun.sleep(180)
  assert.equal(JSON.parse(values.get('custom_commands_v1'))[0].name, 'pending')
  await click('settings-save')
  assert.equal(
    JSON.parse(values.get('custom_commands_v1'))[0].name,
    'latest',
    'Edit during pending save was overwritten',
  )
  await click('settings-category-general')
  const generalContent = box(find('settings-content'))
  assert.ok(box(textNode('Light')).y >= generalContent.y, 'Category navigation must reset scroll')
  await clickNode(textNode('Light'))
  await click('settings-save')
  assert.ok(hasText('QA disk unavailable'))
  assert.ok(find('settings-save-error'))
  await captureGuiQaDisplay('settings-save-error')
  await click('settings-save')
  assert.equal(durableSettings.theme, 'light')
  assert.ok(!flatten().some((node) => node.testId === 'settings-save-error'))
  await clickNode(textNode('Dark'))
  holdSettings = true
  await click('settings-save')
  assert.ok(settingsWrite)
  await clickNode(textNode('Light'))
  settingsWrite()
  holdSettings = false
  await Bun.sleep(180)
  assert.equal(durableSettings.theme, 'dark')
  assert.equal(settingsStore.get().theme, 'light')
  await click('settings-save')
  assert.equal(durableSettings.theme, 'light', 'App setting edited during save was overwritten')
  await clickNode(await scrollTo('theme-preset-custom'))
  const accentInput = await scrollTo('theme-color-accent')
  const accentBounds = box(accentInput)
  assert.ok(accentBounds.x >= 0 && accentBounds.x + accentBounds.width <= width)
  await type(accentInput, '1a2b3c')
  assert.equal(settingsStore.get().customPalette?.accent, '#1a2b3c')
  renderer.scrollTo(find('settings-content').id, 0, 0)
  await Bun.sleep(100)
  await clickNode(await scrollTo('theme-palette-reset'))
  assert.notEqual(settingsStore.get().customPalette?.accent, '#1a2b3c')
  const palette = await captureGuiQaDisplay('settings-custom-palette')
  await type(find('settings-search'), 'sharex headers')
  assert.ok(find('settings-section-image-uploader'))
  assert.ok(find('image-uploader-request-url'))
  assert.equal(calls.filter((call) => call.name === 'getImageUploaderSettings').length, 1)
  assert.equal(durableUploader.enabled, false)
  assert.equal(durableUploader.confirm, true)
  const uploader = await captureGuiQaDisplay('settings-image-uploader')
  await clickNode(await scrollTo('image-uploader-import'))
  await clickNode(await scrollTo('image-uploader-cancel-clipboard'))
  assert.equal(durableUploader.requestUrl, '')
  await clickNode(await scrollTo('image-uploader-import'))
  await clickNode(await scrollTo('image-uploader-apply-import'))
  assert.equal(durableUploader.requestUrl, '', 'Import should wait for Save')
  await click('settings-search-clear')
  await type(find('settings-search'), 'sharex headers')
  await click('settings-save')
  assert.deepEqual(durableUploader, {
    enabled: true,
    confirm: true,
    requestUrl: uploaderPreset.RequestURL,
    formField: uploaderPreset.FileFormName,
    headers: 'Authorization: Bearer qa-token',
    imageLink: '{data.images.0.url}',
    deletionLink: '{data.delete}',
  })
  await clickNode(await scrollTo('image-uploader-export'))
  assert.ok(hasText('includes any credentials'))
  await clickNode(await scrollTo('image-uploader-copy-export'))
  assert.equal(JSON.parse(clipboard).RequestURL, uploaderPreset.RequestURL)
  assert.deepEqual(JSON.parse(clipboard).Headers, { authorization: 'Bearer qa-token' })
  await type(find('settings-search'), 'twir oauth')
  assert.ok(find('settings-section-image-uploader'))
  await clickNode(await scrollTo('image-uploader-twir-connect'))
  await clickNode(await scrollTo('image-uploader-twir-cancel'))
  assert.equal(twirUploader, null)
  twirSignIn = 'denied'
  await clickNode(await scrollTo('image-uploader-twir-connect'))
  assert.ok(hasText('Twir sign-in was denied.'))
  twirSignIn = 'success'
  await clickNode(await scrollTo('image-uploader-twir-connect'))
  assert.equal(twirUploader?.enabled, true)
  assert.ok(find('image-uploader-twir-disconnect'))
  for (const id of ['image-uploader-request-url', 'image-uploader-export']) {
    assert.ok(!flatten().some((node) => node.testId === id), `${id} is only for custom uploads`)
  }
  const twir = await captureGuiQaDisplay('settings-image-uploader-twir')
  twirSignIn = 'denied'
  await clickNode(await scrollTo('image-uploader-twir-connect'))
  assert.ok(find('image-uploader-twir-disconnect'), 'Failed reconnect removed the active account')
  await clickNode(await scrollTo('image-uploader-twir-disconnect'))
  assert.equal(twirUploader, null)
  assert.ok(find('image-uploader-request-url'))
  assert.equal(durableUploader.requestUrl, uploaderPreset.RequestURL)
  assert.equal(durableUploader.headers, 'Authorization: Bearer qa-token')
  mount(SavedAccounts)
  await Bun.sleep(250)
  assert.ok(hasText('Twitch · @alpha'))
  await clickNode(textNode('Switch'))
  assert.equal(active[0]?.id, 'beta')
  assert.ok(hasText('Twitch · @beta'))
  const accounts = await captureGuiQaDisplay('accounts')
  const alphaRow = textNode('Alpha Streamer · @alpha').parent
  await clickNode(textNode('Forget', alphaRow))
  assert.deepEqual(
    saved.map((account) => account.id),
    ['beta'],
  )
  assert.equal(active[0]?.id, 'beta')
  await clickNode(textNode('Use anonymously'))
  assert.equal(active.length, 0)
  assert.ok(hasText('Twitch · Anonymous'))
  active = [saved[0]]
  events.emit('accounts_changed', {})
  await Bun.sleep(180)
  assert.ok(hasText('Twitch · @beta'))
  await click('add-account-twitch-more')
  assert.ok(find('add-account-twitch-menu'))
  await clickNode(textNode('Saved accounts'))
  assert.ok(!flatten().some((node) => node.testId === 'add-account-twitch-menu'))
  await click('add-account-twitch-more')
  const addAccountMenu = await captureGuiQaDisplay('accounts-add-menu')
  await click('add-account-twitch-copy')
  assert.equal(clipboard, 'https://auth.example.test/authorize?state=qa-twitch')
  assert.ok(!flatten().some((node) => node.testId === 'add-account-twitch-menu'))
  assert.ok(hasText('Twitch sign-in link copied.'))
  assert.ok(!calls.some((call) => call.name === 'authStart'))
  await Bun.write(
    `${process.env.TWIRCHAT_QA_SESSION_DIR}/settings-calls.json`,
    JSON.stringify(calls, null, 2),
  )
  await Bun.write(
    `${process.env.TWIRCHAT_QA_SESSION_DIR}/settings-result.json`,
    JSON.stringify({
      passed: true,
      width,
      lazySections: true,
      retainedDraft: true,
      pendingEditRetained: true,
      saveErrorRetry: true,
      appSettingsPendingEditRetained: true,
      imageUploaderImportSaveExport: true,
      twirUploaderSignInCancelRetryDisconnect: true,
      accountSwitchAnonymousForget: true,
      addAccountCopyLink: true,
      screenshots: [narrow, search, palette, uploader, twir, accounts, addAccountMenu],
    }),
  )
} catch (error) {
  await Bun.write(
    `${process.env.TWIRCHAT_QA_SESSION_DIR}/settings-tree.json`,
    JSON.stringify(tree()),
  )
  await captureGuiQaDisplay('settings-failure')
  console.error(error)
  process.exitCode = 1
} finally {
  loop.stop()
  root.unmount()
  process.exit(process.exitCode ?? 0)
}
