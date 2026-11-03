if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
if (
  process.env.TWIRCHAT_QA_COMPOSITOR !== 'weston' ||
  process.env.DISPLAY ||
  process.env.WAYLAND_DISPLAY !== 'twirchat-qa'
)
  throw new Error('Wayland smoke requires the private Weston compositor.')
if (!process.argv.includes('--native-child')) {
  const directory = process.env.TWIRCHAT_QA_SESSION_DIR
  if (!directory) throw new Error('Missing private QA artifacts directory.')
  const child = Bun.spawn([process.execPath, import.meta.path, '--native-child'], {
    env: { ...process.env, WAYLAND_DEBUG: 'client' },
    stdout: 'inherit',
    stderr: Bun.file(`${directory}/wayland-client.log`),
  })
  process.exit(await child.exited)
}
await import('../src/gpuix/native-bootstrap')

import assert from 'node:assert/strict'
import { join } from 'node:path'

const React = await import('react')
const { createRenderer, createRoot, startFrameLoop } = await import('@gpuix/react')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { nativeWindow } = await import('../src/gpuix/native-window')
const directory = process.env.TWIRCHAT_QA_SESSION_DIR
const weston = process.env.TWIRCHAT_QA_WESTON_ROOT
assert(directory && weston)
const renderer = nativeWindow(createRenderer())
initializeManagedRenderer(renderer, {
  title: 'TwirChat private Wayland visibility',
  appName: 'TwirChat',
  appId: process.env.TWIRCHAT_QA_APP_ID,
  width: 620,
  height: 360,
})
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)
root.render(
  React.createElement(
    'div',
    {
      style: { width: '100%', height: '100%', backgroundColor: '#443066', padding: 24 },
    },
    React.createElement(
      'text',
      { style: { color: '#ffffff', fontSize: 24 } },
      'TwirChat native Wayland visibility smoke',
    ),
  ),
)

async function until(check: () => boolean, label: string): Promise<void> {
  const end = performance.now() + 8000
  while (!check()) {
    assert(performance.now() < end, `Timed out: ${label}`)
    await Bun.sleep(25)
  }
}
try {
  assert.equal(renderer.getTwirNativeApiVersion(), 3)
  await until(
    () => renderer.getPaintedText().includes('TwirChat native Wayland visibility smoke'),
    'Wayland native text paints',
  )
  const protocolTrace = await Bun.file(join(directory, 'wayland-client.log')).text()
  const version = Number(protocolTrace.match(/\.bind\(\d+,\s*"xdg_wm_base",\s*(\d+),/)?.[1])
  assert(
    Number.isSafeInteger(version) && version > 0,
    'The smoke must record the actual negotiated xdg-shell version.',
  )
  if (version >= 6)
    await until(
      () => renderer.getWindowVisibility() === 'visible',
      'xdg-shell v6 visibility is observed',
    )
  else
    assert.equal(
      renderer.getWindowVisibility(),
      'unknown',
      'Older Wayland protocols must suppress alerts conservatively.',
    )
  assert.equal(
    renderer.getWindowCapabilities().position,
    false,
    'The renderer must use native Wayland.',
  )
  await renderer.configureTray(true, true)
  const bus = Bun.spawn(
    [
      '/usr/bin/gdbus',
      'call',
      '--session',
      '--dest',
      'org.freedesktop.DBus',
      '--object-path',
      '/org/freedesktop/DBus',
      '--method',
      'org.freedesktop.DBus.ListNames',
    ],
    { stdout: 'pipe', stderr: 'pipe', timeout: 5000 },
  )
  const [names, busError, code] = await Promise.all([
    new Response(bus.stdout).text(),
    new Response(bus.stderr).text(),
    bus.exited,
  ])
  assert.equal(code, 0, busError)
  assert(
    names.includes('org.kde.StatusNotifierItem-'),
    'Wayland tray must register on its private D-Bus.',
  )
  const started = performance.now()
  for (let index = 0; index < 10000; index++) renderer.getWindowVisibility()
  const readsMs = performance.now() - started
  assert(readsMs < 500)
  const capture = Bun.spawn([join(weston, 'usr/bin/weston-screenshooter')], {
    cwd: directory,
    env: { ...process.env, LD_LIBRARY_PATH: `${weston}/usr/lib:${weston}/usr/lib/weston` },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 5000,
  })
  const [captureOutput, captureError, captureCode] = await Promise.all([
    new Response(capture.stdout).text(),
    new Response(capture.stderr).text(),
    capture.exited,
  ])
  const screenshots = [...new Bun.Glob('wayland-screenshot*.png').scanSync({ cwd: directory })].map(
    (name) => join(directory, name),
  )
  const captureAvailable =
    captureCode === 0 && !/unauthorized|output capture error/i.test(captureError)
  await Bun.write(
    join(directory, 'wayland-visibility-result.json'),
    JSON.stringify(
      {
        passed: true,
        apiVersion: 3,
        backend: 'wayland',
        negotiatedXdgShellVersion: version,
        visibility: renderer.getWindowVisibility(),
        paintedText: renderer.getPaintedText(),
        privateTray: true,
        readsMs,
        captureCode,
        captureOutput,
        captureError,
        captureAvailable,
        screenshots: captureAvailable ? screenshots : [],
      },
      null,
      2,
    ),
  )
  console.log('Native Wayland visibility and private tray smoke passed.')
} finally {
  await renderer.configureTray(false, false).catch(() => {})
  root.unmount()
  renderer.closeWindow()
  await Bun.sleep(100)
  loop.stop()
}
