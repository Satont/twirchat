if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui --dbus launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
if (!process.env.DBUS_SESSION_BUS_ADDRESS)
  throw new Error('Tray QA requires the private --dbus session.')
await import('../src/gpuix/native-bootstrap')

import assert from 'node:assert/strict'
import { join } from 'node:path'

import {
  clickPrivateTrayMenu,
  privateTrayBus as bus,
  privateTrayMenu,
  privateTrayNames as names,
} from './qa-tray-dbus'

const React = await import('react')
const { createRenderer, createRoot, startFrameLoop } = await import('@gpuix/react')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { closeNativeQaWindow, focusNativeQaWindow } = await import('./qa-x11')
const first = nativeWindow(createRenderer())
const second = nativeWindow(createRenderer())
initializeManagedRenderer(first, { title: 'TwirChat tray QA', width: 320, height: 240 })
initializeManagedRenderer(second, { title: 'TwirChat visibility QA', width: 320, height: 240 })
const roots = [createRoot(first), createRoot(second)]
const activeRoots = new Set(roots)
const loops = [startFrameLoop(first), startFrameLoop(second)]
for (const [index, root] of roots.entries())
  root.render(
    React.createElement(
      'div',
      {
        style: { width: '100%', height: '100%', backgroundColor: index ? '#234b33' : '#443066' },
      },
      React.createElement(
        'text',
        { style: { color: '#ffffff', fontSize: 18 } },
        index ? 'Visible inactive windows suppress notifications' : 'TwirChat private tray QA',
      ),
    ),
  )

async function command(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', timeout: 5000 })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`${args[0]} failed: ${stderr}`)
  return stdout
}
async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!(await check())) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(30)
  }
}
let item = ''
try {
  await first.setWindowBounds({ x: 30, y: 40 })
  await second.setWindowBounds({ x: 430, y: 40 })
  await focusNativeQaWindow('TwirChat visibility QA')
  await until(
    () => first.getWindowVisibility() === 'visible' && second.getWindowVisibility() === 'visible',
    'two visible windows',
  )
  assert.equal(first.isWindowActive(), false, 'Inactive side-by-side window must still be visible.')
  await first.configureTray(true, true)
  await until(async () => {
    item = (await names()).find((name) => name.startsWith('org.kde.StatusNotifierItem-')) ?? ''
    return item.length > 0
  }, 'private StatusNotifierItem registration')
  const title = await bus(item, '/StatusNotifierItem', 'org.freedesktop.DBus.Properties.Get', [
    'org.kde.StatusNotifierItem',
    'ToolTip',
  ])
  assert(title.includes('TwirChat'))
  const { layout } = await privateTrayMenu(item)
  for (const label of ['Open TwirChat', 'Mention notifications', 'Quit TwirChat'])
    assert(layout.includes(label), label)
  await bus(item, '/StatusNotifierItem', 'org.kde.StatusNotifierItem.Activate', ['0', '0'])
  const events: string[] = []
  await until(() => {
    events.push(...first.takeTrayEvents())
    return events.includes('show')
  }, 'tray activation reaches native event queue')
  await clickPrivateTrayMenu(item, 'Mention notifications')
  await until(() => {
    events.push(...first.takeTrayEvents())
    return events.includes('notifications')
  }, 'native menu click reaches event queue')
  await first.configureTray(true, false)
  const hiddenId = (
    await command(['/usr/bin/xdotool', 'search', '--onlyvisible', '--name', '^TwirChat tray QA$'])
  )
    .trim()
    .split('\n')[0]
  assert(hiddenId && /^\d+$/.test(hiddenId))
  await command(['/usr/bin/xdotool', 'windowunmap', hiddenId])
  await until(
    () => first.getWindowVisibility() === 'hidden',
    'unmapped native window becomes hidden',
  )
  await command(['/usr/bin/xdotool', 'windowmap', hiddenId])
  await until(
    () => first.getWindowVisibility() === 'visible',
    'mapped native window becomes visible',
  )
  for (let cycle = 0; cycle < 3; cycle++) {
    closeNativeQaWindow('TwirChat tray QA')
    await until(() => first.getWindowVisibility() === 'hidden', 'WM close hides the tray owner')
    assert(first.isWindowOpen(), 'WM close must preserve the tray owner and its renderer.')
    const retainedRoot = roots[0]
    assert(retainedRoot)
    retainedRoot.render(
      React.createElement(
        'div',
        { style: { width: '100%', height: '100%', backgroundColor: '#443066' } },
        React.createElement('text', {}, `Hidden update ${cycle}`),
      ),
    )
    await Bun.sleep(200)
    assert.equal(first.getWindowVisibility(), 'hidden', 'Background updates must not remap it.')
    await clickPrivateTrayMenu(item, 'Open TwirChat')
    await until(() => {
      const actions = first.takeTrayEvents()
      events.push(...actions)
      if (!actions.includes('show')) return false
      first.activateWindow()
      return true
    }, 'Open menu reaches the retained window')
    await until(() => first.getWindowVisibility() === 'visible', 'tray restores the same window')
    await until(
      () => first.getPaintedText().includes(`Hidden update ${cycle}`),
      'restored window paints its latest content',
    )
    await focusNativeQaWindow('TwirChat tray QA')
  }
  const secondaryRoot = roots[1]
  assert(secondaryRoot)
  secondaryRoot.unmount()
  activeRoots.delete(secondaryRoot)
  closeNativeQaWindow('TwirChat visibility QA')
  await until(() => !second.isWindowOpen(), 'window without a tray still closes')
  assert(first.isWindowOpen(), 'Closing another window must preserve the tray owner.')
  const started = performance.now()
  for (let index = 0; index < 10000; index++) first.getWindowVisibility()
  const readsMs = performance.now() - started
  assert(readsMs < 500, `Visibility snapshots must be nonblocking, got ${readsMs}ms.`)
  const screenshot = await captureGuiQaDisplay('tray-and-visible-windows')
  await first.configureTray(false, false)
  await until(async () => !(await names()).includes(item), 'tray unregisters on disposal')
  const primaryRoot = roots[0]
  assert(primaryRoot)
  primaryRoot.unmount()
  activeRoots.delete(primaryRoot)
  closeNativeQaWindow('TwirChat tray QA')
  await until(() => !first.isWindowOpen(), 'tray removal restores ordinary OS close')
  const directory = process.env.TWIRCHAT_QA_SESSION_DIR
  assert(directory)
  await Bun.write(
    join(directory, 'tray-result.json'),
    JSON.stringify(
      {
        passed: true,
        item,
        events,
        inactiveVisible: true,
        mapVisibility: true,
        closeRestoreCycles: 3,
        hiddenUpdatesStayHidden: true,
        unownedWindowCloses: true,
        trayRemovalRestoresClose: true,
        readsMs,
        screenshot,
      },
      null,
      2,
    ),
  )
  console.log('Native tray and compositor visibility QA passed.')
} finally {
  if (first.isWindowOpen()) await first.configureTray(false, false).catch(() => {})
  for (const root of activeRoots)
    if ((root === roots[0] ? first : second).isWindowOpen()) root.unmount()
  first.closeWindow()
  second.closeWindow()
  await Bun.sleep(100)
  for (const loop of loops) loop.stop()
}
