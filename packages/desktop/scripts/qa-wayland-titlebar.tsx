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
async function compositor(
  ...[action, x, y]:
    | [action: 'mapped' | 'focus' | 'release']
    | [action: 'click' | 'press' | 'drag', x: number, y: number]
) {
  const args =
    action === 'click' || action === 'press' || action === 'drag'
      ? `${Math.round(x)} ${Math.round(y)}\n`
      : ''
  await rm(reply, { force: true })
  await Bun.write(`${command}.pending`, `${action}\n${title}\n${args}`)
  await rename(`${command}.pending`, command)
  await until(() => Bun.file(reply).exists(), `Weston ${action} reply`)
  return (await Bun.file(reply).text()).trim() === '1'
}

function paintedContent() {
  return contentId === undefined ? null : renderer.getPaintedElementBounds(contentId)
}

function paintedFrame() {
  const window = renderer.getWindowBounds()
  const body = paintedContent()
  if (!window || !body) return null
  return {
    window,
    body,
    right: window.width - body.x - body.width,
    bottom: window.height - body.y - body.height,
  }
}

async function click(button: 'close' | 'maximize' | 'minimize') {
  const body = paintedContent()
  assert(body && body.y > 0)
  // Aim for the center of the controls in the default right-aligned Linux layout.
  const offset = { close: 22, maximize: 52, minimize: 82 }[button]
  assert(await compositor('focus'))
  assert(await compositor('click', body.x + body.width - offset, body.y - 22))
}

function resizeRequests(trace: string) {
  return Array.from(
    trace.matchAll(/xdg_toplevel[@#]\d+\.resize\(wl_seat[@#]\d+,\s*\d+,\s*(\d+)\)/gu),
    (request) => Number(request[1]),
  )
}

async function dragResize(edge: 'right' | 'bottom-right', dx: number, dy: number) {
  const before = paintedFrame()
  assert(before && before.right > 0 && before.bottom > 0, 'windowed client resize gutters')
  const { body, right, bottom } = before
  const x = body.x + body.width + right / 2
  const y = edge === 'right' ? body.y + body.height / 2 : body.y + body.height + bottom / 2
  const requestCount = resizeRequests(await Bun.file(protocolLog).text()).length
  // xdg_toplevel.resize_edge protocol enum values.
  const requestEdge = edge === 'right' ? 8 : 10
  assert(await compositor('focus'))
  assert(await compositor('press', x, y), `pointer press on ${edge} resize gutter`)
  try {
    await until(
      async () => resizeRequests(await Bun.file(protocolLog).text())[requestCount] === requestEdge,
      `${edge} gutter requests native xdg_toplevel.resize`,
    )
    await until(() => compositor('drag', dx, dy), 'Weston starts its interactive resize grab')
    await until(() => {
      const frame = paintedFrame()
      return (
        frame !== null &&
        Math.abs(frame.window.width - before.window.width - dx) <= 1 &&
        Math.abs(frame.window.height - before.window.height - dy) <= 1 &&
        Math.abs(frame.body.width - body.width - dx) <= 1 &&
        Math.abs(frame.body.height - body.height - dy) <= 1
      )
    }, `${edge} drag resizes the window and its painted content`)
  } finally {
    assert(await compositor('release'), 'pointer release after resize')
  }
}

async function checkMaximizedEdge() {
  await until(() => {
    const frame = paintedFrame()
    return frame !== null && frame.body.x === 0 && frame.right === 0 && frame.bottom === 0
  }, 'maximized content fills the viewport')
  const body = paintedContent()
  assert(body)
  const logStart = (await Bun.file(protocolLog).text()).length
  assert(await compositor('focus'))
  assert(await compositor('press', body.width - 3, body.y + body.height / 2))
  try {
    assert.equal(
      await compositor('drag', 24, 0),
      false,
      'maximized edge cannot start a resize grab',
    )
  } finally {
    assert(await compositor('release'), 'release also works without a compositor grab')
  }
  await until(
    async () =>
      /wl_pointer[@#]\d+\.button\(\d+,\s*\d+,\s*272,\s*0\)/u.test(
        (await Bun.file(protocolLog).text()).slice(logStart),
      ),
    'maximized edge receives pointer release',
  )
  assert.deepEqual(resizeRequests((await Bun.file(protocolLog).text()).slice(logStart)), [])
}

try {
  await until(() => (paintedContent()?.y ?? 0) > 0, 'client chrome reserves space above content')
  await until(() => renderer.getPaintedText().includes(content), 'client content paints')
  await until(() => compositor('mapped'), 'Wayland surface is mapped')
  const initial = paintedFrame()
  assert(
    initial && initial.bottom > 0 && initial.bottom <= 8,
    'a slim bottom gutter fits the frame',
  )

  await dragResize('right', 48, 0)
  await dragResize('bottom-right', -24, 32)

  await click('maximize')
  await until(() => renderer.getWindowBounds()?.mode === 'maximized', 'maximize button')
  await checkMaximizedEdge()
  await click('maximize')
  await until(() => renderer.getWindowBounds()?.mode === 'windowed', 'restore button')
  await until(() => (paintedFrame()?.bottom ?? 0) > 0, 'restore repaints the client frame')

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
  console.log(
    `Wayland title bar and resize passed at ${initial.window.width}×${initial.window.height}.`,
  )
} finally {
  if (renderer.isWindowOpen()) renderer.closeWindow()
  loop.stop()
}
