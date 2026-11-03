import assert from 'node:assert/strict'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { clickPrivateTrayMenu, privateTrayNames } from './qa-tray-dbus'

assertGuiQaEnvironment()
assert(process.env.TWIRCHAT_QA_COMPOSITOR === 'weston')
assert(
  process.env.TWIRCHAT_QA_WESTON_CONTROLS,
  'Use qa:gui --compositor weston --weston-controls --dbus.',
)
const session = process.env.TWIRCHAT_QA_SESSION_DIR
const runtime = process.env.TWIRCHAT_QA_RUNTIME
assert(session && runtime)
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { createRenderer, createRoot, startFrameLoop } = await import('@gpuix/react')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { nativeWindow } = await import('../src/gpuix/native-window')
const renderer = nativeWindow(createRenderer())
const title = 'TwirChat Wayland tray QA'
initializeManagedRenderer(renderer, { title, width: 620, height: 360 })
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)
let mounted = true

async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!(await check())) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(30)
  }
}

async function compositor(action: 'close' | 'mapped'): Promise<boolean> {
  assert(runtime)
  const command = join(runtime, 'weston-command')
  const replyPath = join(runtime, 'weston-reply')
  await rm(replyPath, { force: true })
  await Bun.write(`${command}.pending`, `${action}\n${title}\n`)
  await rename(`${command}.pending`, command)
  await until(() => Bun.file(replyPath).exists(), `private Weston ${action} reply`)
  const result = (await Bun.file(replyPath).text()).trim()
  assert(result === '0' || result === '1', 'Private Weston returned an invalid reply.')
  return result === '1'
}

function render(text: string): void {
  root.render(
    React.createElement(
      'div',
      {
        style: { width: '100%', height: '100%', backgroundColor: '#443066', padding: 20 },
      },
      React.createElement('text', { style: { color: '#ffffff', fontSize: 20 } }, text),
    ),
  )
}

let item = ''
const cycles = 5
try {
  render('Initial Wayland tray frame')
  await until(
    () => renderer.getPaintedText().includes('Initial Wayland tray frame'),
    'initial paint',
  )
  await until(() => compositor('mapped'), 'initial surface mapping')
  assert.equal(
    renderer.getWindowCapabilities().position,
    false,
    'The native backend must be Wayland.',
  )
  await renderer.configureTray(true, true)
  await until(async () => {
    item =
      (await privateTrayNames()).find((name) => name.startsWith('org.kde.StatusNotifierItem-')) ??
      ''
    return item.length > 0
  }, 'native Wayland tray')
  for (let cycle = 0; cycle < cycles; cycle++) {
    assert(await compositor('close'), 'Weston must send a real xdg_toplevel.close event.')
    await until(async () => !(await compositor('mapped')), 'Wayland surface unmaps on close')
    assert(renderer.isWindowOpen(), 'Closing to tray must retain the Wayland renderer.')
    for (let update = 0; update < 10; update++) {
      render(`Wayland hidden update ${cycle}:${update}`)
      await Bun.sleep(30)
    }
    assert.equal(
      await compositor('mapped'),
      false,
      'Background updates must not remap the surface.',
    )
    await clickPrivateTrayMenu(item, 'Open TwirChat')
    await until(() => {
      if (!renderer.takeTrayEvents().includes('show')) return false
      renderer.activateWindow()
      return true
    }, 'tray requests Wayland restore')
    await until(() => compositor('mapped'), 'Wayland surface remaps after configure')
    await until(
      () => renderer.getPaintedText().includes(`Wayland hidden update ${cycle}:9`),
      'latest restored paint',
    )
    render(`Wayland visible update ${cycle}`)
    await until(
      () => renderer.getPaintedText().includes(`Wayland visible update ${cycle}`),
      'continued visible painting',
    )
  }
  assert(await compositor('close'))
  await until(async () => !(await compositor('mapped')), 'last hidden state')
  root.unmount()
  mounted = false
  renderer.closeWindow()
  await until(() => !renderer.isWindowOpen(), 'programmatic close bypasses tray interception')
  await until(
    async () => !(await privateTrayNames()).includes(item),
    'programmatic close removes tray',
  )
  await Bun.write(
    join(session, 'wayland-tray-result.json'),
    JSON.stringify(
      {
        passed: true,
        backend: 'wayland',
        genuineCompositorClose: true,
        closeRestoreCycles: cycles,
        hiddenUpdates: cycles * 10,
        programmaticClose: true,
      },
      null,
      2,
    ),
  )
} finally {
  if (renderer.isWindowOpen()) await renderer.configureTray(false, false).catch(() => {})
  if (mounted && renderer.isWindowOpen()) root.unmount()
  renderer.closeWindow()
  await Bun.sleep(100)
  loop.stop()
}
