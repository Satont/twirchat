if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { MainTab } from '../src/gpuix/state/app'

const { focusNativeQaWindow } = await import('./qa-x11')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
process.env.TWIRCHAT_GPUIX_START_MAIN_TAB = 'events'
await import('../src/gpuix/main')
const app = await import('../src/gpuix/state/app')
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
  await openNavTab('obs-remote', 'obs-remote-controller')
  assert.equal(mounts.size, 1, 'Reopening OBS Remote reuses the main window')
  await openNavTab('chat', `pane-${homePane.id}`)
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
