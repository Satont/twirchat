if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { useWindowScope } = await import('../src/gpuix/state/window-scope')
const { registerHotkeyActions } = await import('../src/gpuix/state/hotkeys')
const { useTextInputFocusTracking, isTextInputFocused } = await import('../src/gpuix/state/focus')
const { useOverlayClose, hasOpenOverlay } = await import('../src/gpuix/state/overlays')
const { setActivePane, getActivePane } = await import('../src/gpuix/state/active-pane')
const { WINDOW_SESSION_KEY } = await import('../src/services/window-session')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { Text } = await import('../src/gpuix/components/ui/Text')
const { focusNativeQaWindow, getNativeQaWindowGeometry } = await import('./qa-x11')
const values = new Map([
  [
    WINDOW_SESSION_KEY,
    JSON.stringify({
      version: 1,
      mainBounds: { x: 10, y: 20, width: 420, height: 620, mode: 'windowed' },
      windows: [],
    }),
  ],
])
const layouts = new Map([
  [
    'source',
    {
      version: 2,
      root: {
        id: 'source-panel',
        type: 'panel',
        flex: 100,
        content: { type: 'watched', channelId: 'mock' },
      },
    },
  ],
])
const backend = {
  api: {
    getUiState: async ({ key }) => values.get(key) ?? null,
    setUiState: async ({ key, value }) => {
      values.set(key, value)
    },
    getWatchedChannelsLayout: async ({ tabId }) => structuredClone(layouts.get(tabId) ?? null),
    setWatchedChannelsLayout: async ({ tabId, layout }) => {
      layouts.set(tabId, structuredClone(layout))
    },
    removeWatchedChannelsLayout: async ({ tabId }) => {
      layouts.delete(tabId)
    },
  },
}
const windows = new Map(),
  mounted = new Map(),
  disposed = new Map(),
  routes = new Map(),
  inputs = new Map()
function Content({ descriptor }) {
  const renderer = useGpuixRequired(),
    scope = useWindowScope()
  const [route, setRoute] = React.useState('chat'),
    [text, setText] = React.useState('hello world'),
    [overlay, setOverlay] = React.useState(false)
  const focus = useTextInputFocusTracking()
  useOverlayClose(overlay, () => setOverlay(false))
  routes.set(scope, route)
  inputs.set(scope, text)
  React.useEffect(() => {
    windows.set(scope, { renderer, descriptor })
    mounted.set(scope, (mounted.get(scope) ?? 0) + 1)
    setActivePane({ tabId: scope, paneId: `${scope}:pane` }, scope)
    const stopHotkeys = registerHotkeyActions(
      { openAddChannel: () => {}, openTabSelector: () => setRoute('selector') },
      scope,
    )
    return () => {
      stopHotkeys()
      windows.delete(scope)
      disposed.set(scope, (disposed.get(scope) ?? 0) + 1)
    }
  }, [renderer, scope, descriptor])
  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 20,
        backgroundColor: '#18181e',
      },
    },
    React.createElement(
      Text,
      { style: { color: '#f5f5fa', fontSize: 18 } },
      `${descriptor.kind.toUpperCase()} WINDOW`,
    ),
    React.createElement(
      Text,
      { testId: 'window-route', style: { color: '#c4b5fd' } },
      `Route: ${route}`,
    ),
    React.createElement('input', {
      testId: 'window-editor',
      value: text,
      ...focus,
      onChange: (event) => setText(event.value ?? ''),
      style: {
        width: '100%',
        color: '#ffffff',
        backgroundColor: '#282830',
        padding: 10,
        fontSize: 14,
      },
    }),
    React.createElement(
      'div',
      {
        testId: 'window-route-button',
        tabIndex: 0,
        onClick: () => setRoute(route === 'chat' ? 'settings' : 'chat'),
        style: { padding: 10, backgroundColor: '#5f4794' },
      },
      React.createElement(Text, { style: { color: '#ffffff' } }, 'Change local route'),
    ),
    React.createElement(
      'div',
      {
        testId: 'window-overlay-button',
        tabIndex: 0,
        onClick: () => setOverlay(!overlay),
        style: { padding: 10, backgroundColor: '#373743' },
      },
      React.createElement(Text, { style: { color: '#ffffff' } }, 'Toggle local dialog'),
    ),
    overlay
      ? React.createElement(
          Text,
          { testId: 'window-dialog', style: { color: '#ffffff' } },
          `Local dialog ${scope}`,
        )
      : null,
  )
}
function factory(descriptor) {
  return React.createElement(Content, { descriptor })
}
async function until(check, label) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
function element(renderer, testId) {
  const walk = (node) =>
    node.testId === testId ? node : (node.children ?? []).map(walk).find(Boolean)
  const node = walk(JSON.parse(renderer.getAutomationTree()))
  assert.ok(node, `Missing ${testId}`)
  const bounds = renderer.getElementBounds(node.id)
  assert.ok(bounds)
  return { ...node, ...bounds }
}
async function click(renderer, testId) {
  const node = element(renderer, testId)
  renderer.simulateClick(node.x + node.width / 2, node.y + node.height / 2, 0)
  await Bun.sleep(100)
}
function shapeCount() {
  const child = Bun.spawnSync(
    [
      'python3',
      resolve(import.meta.dir, '../native/gpuix/probes/x11-input-shape.py'),
      'TwirChat overlay',
    ],
    { env: process.env },
  )
  assert.equal(child.exitCode, 0, child.stderr.toString())
  return Number(child.stdout.toString().trim())
}
let empty = 0
let manager = new DesktopWindowManager(backend, factory, () => {
  empty++
})
try {
  await manager.start()
  await until(() => windows.has('main'), 'main content')
  const childId = await manager.openChat('source'),
    overlayId = await manager.openChat('source', undefined, true)
  await until(() => windows.size === 3, 'three independent roots')
  const main = windows.get('main').renderer,
    child = windows.get(childId).renderer,
    overlay = windows.get(overlayId).renderer
  assert.notEqual(windows.get(childId).descriptor.tabId, windows.get(overlayId).descriptor.tabId)
  await child.setWindowBounds({ x: 450, y: 20, width: 490, height: 620 })
  await overlay.setWindowBounds({ x: 950, y: 20, width: 320, height: 400 })
  await until(() => child.getWindowBounds()?.width === 490, 'child geometry')
  await Bun.sleep(100)
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'bounds-after-move.json'),
    JSON.stringify(
      {
        child: child.getWindowBounds(),
        overlay: overlay.getWindowBounds(),
        actualChild: getNativeQaWindowGeometry('TwirChat chat'),
        actualOverlay: getNativeQaWindowGeometry('TwirChat overlay'),
      },
      null,
      2,
    ),
  )
  await until(
    () =>
      child.getWindowBounds()?.x === 450 &&
      child.getWindowBounds()?.y === 20 &&
      overlay.getWindowBounds()?.x === 950 &&
      overlay.getWindowBounds()?.y === 20,
    'native move geometry cache',
  )
  await click(child, 'window-route-button')
  assert.equal(routes.get(childId), 'settings')
  assert.equal(routes.get('main'), 'chat')
  assert.equal(routes.get(overlayId), 'chat')
  await click(main, 'window-overlay-button')
  await click(child, 'window-overlay-button')
  assert.ok(hasOpenOverlay('main') && hasOpenOverlay(childId))
  child.blur()
  child.simulateKeystrokes('escape')
  await Bun.sleep(100)
  assert.equal(hasOpenOverlay(childId), false)
  assert.equal(hasOpenOverlay('main'), true)
  await focusNativeQaWindow('TwirChat')
  main.focusElement(element(main, 'window-editor').id)
  await Bun.sleep(100)
  await focusNativeQaWindow('TwirChat chat')
  child.focusElement(element(child, 'window-editor').id)
  await Bun.sleep(100)
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'focus-debug.json'),
    JSON.stringify({
      mainInput: element(main, 'window-editor').id,
      childInput: element(child, 'window-editor').id,
      mainNativeFocus: main.getFocusedElementId(),
      childNativeFocus: child.getFocusedElementId(),
      mainTracked: isTextInputFocused('main'),
      childTracked: isTextInputFocused(childId),
    }),
  )
  assert.equal(isTextInputFocused(childId), true)
  main.blur()
  await Bun.sleep(100)
  assert.equal(isTextInputFocused('main'), false)
  assert.equal(isTextInputFocused(childId), true)
  const screenshot = await captureGuiQaDisplay('managed-windows')
  manager.remount(factory)
  await until(() => [...mounted.values()].every((count) => count === 2), 'remounted roots')
  assert.equal(disposed.get('main'), 1)
  assert.equal(disposed.get(childId), 1)
  assert.equal(hasOpenOverlay('main'), false)
  assert.equal(isTextInputFocused(childId), false)
  await manager.close('main')
  await until(() => !windows.has('main'), 'main disposed')
  assert.equal(empty, 0)
  assert.equal(child.isWindowOpen(), true)
  assert.equal(overlay.isWindowOpen(), true)
  assert.equal(getActivePane('main'), null)
  child.focusElement(element(child, 'window-editor').id)
  await child.runTextInputAction('cursorToEnd')
  await child.runTextInputAction('selectWord')
  await child.runTextInputAction('cut')
  await Bun.sleep(100)
  assert.equal(inputs.get(childId), 'hello ')
  await child.runTextInputAction('undo')
  await Bun.sleep(100)
  assert.equal(inputs.get(childId), 'hello world')
  assert.ok(shapeCount() > 0)
  await manager.toggleOverlayInertia(overlayId, 'this')
  assert.equal(shapeCount(), 0)
  await child.setWindowBounds({ width: 520, height: 610 })
  await until(() => child.getWindowBounds()?.width === 520, 'resized child')
  await Bun.sleep(650)
  const persisted = JSON.parse(values.get(WINDOW_SESSION_KEY))
  assert.equal(persisted.windows.find((window) => window.id === childId).bounds.width, 520)
  await manager.quit()
  await until(() => windows.size === 0 && empty === 1, 'quit cleanup')
  assert.equal(disposed.get(childId), 2)
  assert.equal(disposed.get(overlayId), 2)
  assert.equal(getActivePane(childId), null)
  const restart = JSON.parse(values.get(WINDOW_SESSION_KEY))
  assert.equal(restart.windows.length, 2)
  assert.equal(restart.windows.find((window) => window.id === overlayId).clickThrough, true)
  manager = new DesktopWindowManager(backend, factory, () => {
    empty++
  })
  await manager.start()
  await until(() => windows.size === 3, 'restored windows')
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'restored-bounds.json'),
    JSON.stringify(
      {
        expected: restart,
        actual: [...windows].map(([id, value]) => ({
          id,
          bounds: value.renderer.getWindowBounds(),
        })),
      },
      null,
      2,
    ),
  )
  for (const descriptor of restart.windows) {
    const actual = windows.get(descriptor.id).renderer.getWindowBounds()
    assert.equal(actual.x, descriptor.bounds.x, 'Restored window x position')
    assert.equal(actual.y, descriptor.bounds.y, 'Restored window y position')
    assert.equal(actual.height, descriptor.bounds.height, 'Restored window height')
  }
  assert.equal(windows.get(childId).renderer.getWindowBounds().width, 520)
  assert.equal(shapeCount(), 0)
  await manager.toggleOverlayInertia(overlayId, 'all')
  assert.ok(shapeCount() > 0)
  const restoredScreenshot = await captureGuiQaDisplay('managed-windows-restored')
  await manager.quit()
  await until(() => windows.size === 0 && empty === 2, 'restored cleanup')
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'windows-result.json'),
    JSON.stringify(
      {
        passed: true,
        actualManager: true,
        independentRootsRoutesFocusDialogs: true,
        mainCloseKeepsChildAlive: true,
        editorActionAfterMainClose: true,
        remountCleanup: true,
        resizedGeometryRestored: true,
        overlayActualX11InputRegion: true,
        screenshots: [screenshot, restoredScreenshot],
      },
      null,
      2,
    ),
  )
} catch (error) {
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'windows-debug.json'),
    JSON.stringify(
      {
        windows: [...windows].map(([id, value]) => ({
          id,
          open: value.renderer.isWindowOpen(),
          bounds: value.renderer.getWindowBounds(),
          focused: value.renderer.getFocusedElementId(),
          trackedFocus: isTextInputFocused(id),
          route: routes.get(id),
          overlay: hasOpenOverlay(id),
        })),
        saved: values.get(WINDOW_SESSION_KEY),
        mounted: [...mounted],
        disposed: [...disposed],
      },
      null,
      2,
    ),
  )
  await captureGuiQaDisplay('managed-windows-failure')
  console.error(error)
  process.exitCode = 1
} finally {
  await manager.quit().catch(() => {})
  await Bun.sleep(100)
  process.exit(process.exitCode ?? 0)
}
