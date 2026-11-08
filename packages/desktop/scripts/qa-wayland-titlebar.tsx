import assert from 'node:assert/strict'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { PublicInstance } from '@gpuix/react'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'
import { privateTrayNames } from './qa-tray-dbus'

assertGuiQaEnvironment()
const session = process.env.TWIRCHAT_QA_SESSION_DIR
const runtime = process.env.TWIRCHAT_QA_RUNTIME
assert(
  session &&
    runtime &&
    process.env.TWIRCHAT_QA_WESTON_CONTROLS &&
    process.env.TWIRCHAT_QA_WESTON_SHELL === 'desktop' &&
    process.env.TWIRCHAT_QA_DBUS === '1',
  'Use qa:gui --compositor weston --weston-shell desktop --weston-controls --dbus.',
)
const protocolLog = join(session, 'titlebar-wayland.log')
if (!process.argv.includes('--native-child')) {
  const child = Bun.spawn(
    [process.execPath, import.meta.path, ...process.argv.slice(2), '--native-child'],
    {
      env: { ...process.env, WAYLAND_DEBUG: 'client' },
      stdout: 'inherit',
      stderr: Bun.file(protocolLog),
    },
  )
  process.exit(await child.exited)
}

await import('../src/gpuix/native-bootstrap')
const { createRenderer, createRoot, startFrameLoop } = await import('@gpuix/react')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { nativeWindow } = await import('../src/gpuix/native-window')

const title = 'TwirChat — Wayland title bar QA'
const small = process.argv.includes('--small')
const renderer = nativeWindow(createRenderer())
initializeManagedRenderer(renderer, { title, width: small ? 360 : 640, height: small ? 280 : 460 })
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)
let contentId: number | undefined
const content = 'TwirChat title bar content'
root.render(
  <div
    ref={(element: PublicInstance | null) => {
      contentId = element?.id
    }}
    style={{ width: '100%', height: '100%', backgroundColor: '#24212b', padding: 16 }}
  >
    <text style={{ color: '#fff' }}>{content}</text>
  </div>,
)

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = performance.now() + 8000
  while (!(await check())) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(25)
  }
}

const command = join(runtime, 'weston-command')
const reply = join(runtime, 'weston-reply')
async function compositor(action: 'mapped' | 'focus' | 'click', args = '') {
  await rm(reply, { force: true })
  await Bun.write(`${command}.pending`, `${action}\n${title}\n${args}\n`)
  await rename(`${command}.pending`, command)
  await until(() => Bun.file(reply).exists(), `Weston ${action} reply`)
  return (await Bun.file(reply).text()).trim() === '1'
}

function paintedContent() {
  return contentId === undefined ? null : renderer.getPaintedElementBounds(contentId)
}

async function click(button: 'close' | 'maximize' | 'minimize') {
  const window = renderer.getWindowBounds()
  const body = paintedContent()
  assert(window && body && body.y > 0)
  // Aim for the center of the controls in the default right-aligned Linux layout.
  const offset = { close: 22, maximize: 52, minimize: 82 }[button]
  assert(await compositor('focus'))
  assert(
    await compositor('click', `${Math.round(window.width - offset)} ${Math.round(body.y / 2)}`),
  )
}

try {
  await until(() => (paintedContent()?.y ?? 0) > 0, 'client chrome reserves space above content')
  await until(() => renderer.getPaintedText().includes(content), 'client content paints')
  await until(() => compositor('mapped'), 'Wayland surface is mapped')
  const bounds = renderer.getWindowBounds()
  const body = paintedContent()
  assert(bounds && body)
  assert.equal(Math.round(body.y + body.height), Math.round(bounds.height))

  await click('maximize')
  await until(() => renderer.getWindowBounds()?.mode === 'maximized', 'maximize button')
  await click('maximize')
  await until(() => renderer.getWindowBounds()?.mode === 'windowed', 'restore button')

  if (small) {
    await click('minimize')
    await until(
      async () => /xdg_toplevel[@#]\d+\.set_minimized\(/u.test(await Bun.file(protocolLog).text()),
      'minimize button sends native xdg_toplevel request',
    )
    await until(() => !renderer.isWindowActive(), 'minimize gives up focus')
  } else {
    await renderer.configureTray(true, false)
    await until(
      async () =>
        (await privateTrayNames()).some((name) => name.startsWith('org.kde.StatusNotifierItem-')),
      'tray item registration',
    )
    await click('close')
    await until(async () => !(await compositor('mapped')), 'title bar close unmaps to tray')
  }
  assert(renderer.isWindowOpen())
  root.unmount()
  renderer.closeWindow()
  await until(() => !renderer.isWindowOpen(), 'explicit quit bypasses the tray')
  console.log(`Wayland title bar passed at ${bounds.width}×${bounds.height}.`)
} finally {
  if (renderer.isWindowOpen()) renderer.closeWindow()
  loop.stop()
}
