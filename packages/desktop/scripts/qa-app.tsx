if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { Account, CustomPalette } from '@twirchat/shared/types'

import type { MainTab } from '../src/gpuix/state/app'

const { focusNativeQaWindow } = await import('./qa-x11')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
process.env.TWIRCHAT_GPUIX_START_MAIN_TAB = 'events'
await import('../src/gpuix/main')
const app = await import('../src/gpuix/state/app')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { layoutStore, allPanels } = await import('../src/gpuix/state/layout')
const { actionBindingsStore } = await import('../src/gpuix/state/action-bindings')
const { windowPresentationPreferences } = await import('../src/gpuix/state/window-presentation')
const { closeTopOverlay } = await import('../src/gpuix/state/overlays')
const manager = Reflect.get(globalThis, '__twirchatWindows')
const mounts = Reflect.get(manager, 'mounted')
const directory = process.env.TWIRCHAT_QA_SESSION_DIR!
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 7000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
function find(renderer, testId) {
  const visit = (node) =>
    node.testId === testId ? node : (node.children ?? []).map(visit).find(Boolean)
  return visit(JSON.parse(renderer.getAutomationTree()))
}
let main
function click(testId: string) {
  const item = find(main, testId)
  assert.ok(item, `Missing ${testId}`)
  const bounds = main.getElementBounds(item.id)
  assert.ok(bounds, `Missing painted bounds for ${testId}`)
  main.simulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)
}
async function openNavTab(tab: MainTab, contentId: string) {
  click(`nav-${tab}`)
  await until(() => app.activeTabStore.get() === tab && !!find(main, contentId), `opens ${tab}`)
}

const customPalette: CustomPalette = {
  background: '#271c29',
  surface: '#38283a',
  text: '#fbe9db',
  muted: '#c0a8b5',
  accent: '#ffc576',
}

async function replaceHex(testId: string, hex: string) {
  click(testId)
  main.simulateKeystrokes('ctrl-a')
  main.simulateKeystrokes(hex.split('').join(' '))
  await Bun.sleep(100)
}

async function captureThemePreview(name: string) {
  main.simulateMouseMove(8, 140)
  await Bun.sleep(150)
  await captureGuiQaDisplay(name)
}

async function checkColorThemes() {
  const { api } = getDesktopBackend()
  const before = await api.getSettings()
  click('theme-preset-ocean')
  await until(() => app.settingsStore.get()?.theme === 'ocean', 'Ocean previews')
  assert.equal(
    (await api.getSettings()).theme,
    before.theme,
    'Preview must leave saved theme intact',
  )
  await captureThemePreview('theme-ocean')

  const paper = find(main, 'theme-preset-paper')
  assert.ok(paper)
  main.focusElement(paper.id)
  main.simulateKeystrokes('space')
  await until(() => app.settingsStore.get()?.theme === 'paper', 'Paper previews from keyboard')
  main.simulateClick(12, 100, 0)
  await captureThemePreview('theme-paper')

  click('theme-preset-custom')
  await until(() => !!find(main, 'theme-color-accent'), 'custom color fields paint')
  const initialAccent = app.settingsStore.get()?.customPalette?.accent
  await replaceHex('theme-color-accent', 'xyz')
  await until(() => !!find(main, 'theme-palette-error'), 'invalid hex reports an error')
  assert.equal(app.settingsStore.get()?.customPalette?.accent, initialAccent)
  click('settings-save')
  assert.equal((await api.getSettings()).theme, before.theme, 'Invalid draft must not save')

  for (const [key, hex] of Object.entries(customPalette)) {
    // Every edit focuses the next native input.
    // eslint-disable-next-line no-await-in-loop
    await replaceHex(`theme-color-${key}`, hex.slice(1))
  }
  assert.deepEqual(app.settingsStore.get()?.customPalette, customPalette)
  assert.ok(!find(main, 'theme-palette-error'))
  click('settings-save')
  await until(
    () => main.getPaintedText().some((text) => text.includes('App settings saved')),
    'custom palette saves',
  )
  const saved = await api.getSettings()
  assert.equal(saved.theme, 'custom')
  assert.deepEqual(saved.customPalette, customPalette, 'SQLite returns the saved custom palette')

  click('theme-preset-ocean')
  await until(() => app.settingsStore.get()?.theme === 'ocean', 'switches back to a preset')
  click('theme-preset-custom')
  await until(() => app.settingsStore.get()?.theme === 'custom', 'returns to the saved palette')
  assert.deepEqual(app.settingsStore.get()?.customPalette, customPalette)
  await captureThemePreview('theme-custom-editor')
}

async function captureThemedChat() {
  const { events } = getDesktopBackend()
  const account = {
    id: 'qa-theme-account',
    platform: 'twitch',
    platformUserId: '12345',
    username: 'studiochat',
    displayName: 'StudioChat',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  } satisfies Account
  app.accountsStore.set([account])
  try {
    const messages = [
      { name: 'juniper', color: '#e894c8', text: 'Made it just in time!' },
      { name: 'moss', color: '#b5d889', text: 'Is everyone here for the co-op run?' },
      { name: 'reed', color: '#87b4ff', text: 'Yep, I’m in.' },
      { name: 'mira', color: '#54d9af', text: 'Hey chat! Sound check in a minute.' },
      { name: 'reed', color: '#87b4ff', text: 'Audio is clear on my end.' },
      { name: 'moss', color: '#b5d889', text: 'The music is a little quiet here.' },
      { name: 'mira', color: '#54d9af', text: 'Turned it up a bit. How’s that?' },
      { name: 'moss', color: '#b5d889', text: 'Much better.' },
      { name: 'juniper', color: '#e894c8', text: 'The warm colors are growing on me.' },
      { name: 'mira', color: '#54d9af', text: 'I put the notes here: https://example.com/notes' },
      { name: 'juniper', color: '#e894c8', text: 'Got them, thanks!' },
      { name: 'reed', color: '#87b4ff', text: 'Ready when you are.' },
    ]
    for (const [index, message] of messages.entries()) {
      events.emit('chat_message', {
        id: `qa-theme-${index}`,
        platform: account.platform,
        channelId: account.username,
        timestamp: new Date(Date.now() - (messages.length - index) * 4000),
        type: 'message',
        text: message.text,
        author: { id: message.name, displayName: message.name, color: message.color, badges: [] },
        emotes: [],
      })
    }
    await until(
      () => main.getPaintedText().join(' ').includes('Ready when you are.'),
      'live messages paint with the custom palette',
    )
    await captureThemePreview('theme-custom-chat')
  } finally {
    app.accountsStore.set([])
    app.homeMessagesStore.set([])
  }
}

async function action(category, name, args = []) {
  actionBindingsStore.update({
    value: {
      bindings: [
        {
          id: 'qa-app',
          name,
          enabled: true,
          category,
          action: name,
          arguments: args,
          keys: ['ctrl+f12'],
        },
      ],
      legacyNavigation: true,
    },
  })
  await Bun.sleep(30)
  main.simulateKeystrokes('ctrl-f12')
  await Bun.sleep(150)
}
try {
  await until(
    () => mounts.has('main') && !!layoutStore.get().get('home')?.layout,
    'real app main layout',
  )
  main = mounts.get('main').renderer
  await focusNativeQaWindow('TwirChat')
  assert.deepEqual(app.accountsStore.get(), [], 'Private QA must not load real credentials.')
  const homePanes = allPanels(layoutStore.get().get('home')?.layout ?? null)
  assert.equal(homePanes.length, 1)
  const [homePane] = homePanes
  assert.ok(homePane)
  await until(() => !!find(main, `pane-${homePane.id}`), 'legacy tab selection falls back to Chat')
  assert.equal(find(main, 'nav-events'), undefined)
  await openNavTab('platforms', 'connect-twitch')
  await openNavTab('obs-remote', 'obs-remote-controller')
  assert.equal(mounts.size, 1, 'OBS Remote opens in the main window')
  click('obs-add-profile')
  await until(() => !!find(main, 'obs-profile-url'), 'OBS connection editor opens')
  main.simulateKeystrokes('escape')
  await until(() => !find(main, 'obs-profile-url'), 'Escape closes the OBS connection editor')
  await openNavTab('settings', 'settings-search')
  assert.equal(find(main, 'obs-remote-controller'), undefined)
  await checkColorThemes()
  await openNavTab('obs-remote', 'obs-remote-controller')
  assert.equal(mounts.size, 1, 'Reopening OBS Remote reuses the main window')
  await openNavTab('chat', `pane-${homePane.id}`)
  await captureThemedChat()
  await action('window', 'newSplit')
  await until(
    () => allPanels(layoutStore.get().get('home')?.layout ?? null).length === 2,
    'native shortcut creates split',
  )
  await action('window', 'newTab')
  await until(() => app.activeWatchedTabStore.get() !== 'home', 'native shortcut creates empty tab')
  const emptyTab = app.activeWatchedTabStore.get()
  assert.equal(allPanels(layoutStore.get().get(emptyTab)?.layout ?? null)[0]?.content.type, 'empty')
  await action('window', 'openSettings')
  await until(
    () => app.activeTabStore.get() === 'settings' && !!find(main, 'settings-search'),
    'settings from focused chooser',
  )
  await action('window', 'openAccountSelector')
  await until(
    () => main.getPaintedText().some((text) => text.includes('No saved Twitch accounts')),
    'saved account selector',
  )
  closeTopOverlay('main')
  await Bun.sleep(100)
  await action('window', 'openTab', ['0'])
  await until(
    () => app.activeWatchedTabStore.get() === 'home' && app.activeTabStore.get() === 'chat',
    'return to home',
  )
  await action('window', 'zoom', ['in'])
  await until(
    () => windowPresentationPreferences.store.get().value.main?.zoom === 1.1,
    'per-window chat zoom',
  )
  await action('window', 'popup', ['window'])
  await until(() => mounts.size === 2, 'real app standalone chat window')
  const child = [...mounts.values()].find((window) => window.descriptor.kind === 'chat')
  assert.ok(child)
  await until(() => !!find(child.renderer, 'chat-pane'), 'standalone pane paints')
  assert.equal(allPanels(layoutStore.get().get(child.descriptor.tabId)?.layout ?? null).length, 2)
  const screenshot = await captureGuiQaDisplay('app-windows')
  await manager.close('main')
  await until(() => !mounts.has('main'), 'main closes independently')
  assert.equal(child.renderer.isWindowOpen(), true)
  await Bun.write(
    join(directory, 'app-result.json'),
    JSON.stringify({ ok: true, emptyTab, childId: child.descriptor.id, screenshot }, null, 2),
  )
  console.log('Real app native action QA passed.')
  await manager.quit()
} catch (error) {
  await captureGuiQaDisplay('app-failure').catch(() => {})
  await Bun.write(
    join(directory, 'app-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        notices: app.noticeStore.get(),
        layout: [...layoutStore.get()],
        tree: main ? JSON.parse(main.getAutomationTree()) : null,
      },
      null,
      2,
    ),
  )
  console.error(error)
  process.exit(1)
}
