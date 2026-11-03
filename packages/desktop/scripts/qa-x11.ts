import { assertGuiQaEnvironment } from '../src/services/gui-qa'

function privateWindowId(title: string): string {
  assertGuiQaEnvironment()
  if (process.env.TWIRCHAT_QA_COMPOSITOR !== 'xvfb' || process.env.DISPLAY !== ':99')
    throw new Error('Native QA requires the private Xvfb display.')
  if (!title || title.length > 256) throw new Error('Invalid native QA window title.')
  const listing = Bun.spawnSync(['/usr/bin/xdotool', 'search', '--onlyvisible', '--name', '.*'], {
    env: process.env,
    timeout: 5000,
  })
  if (listing.exitCode !== 0)
    throw new Error(`Private X11 window lookup failed: ${listing.stderr.toString()}`)
  const deadline = performance.now() + 5000
  // Search reads legacy WM_NAME; getwindowname correctly decodes _NET_WM_NAME UTF-8.
  for (const id of listing.stdout.toString().trim().split('\n')) {
    if (performance.now() > deadline) break
    if (!/^\d+$/u.test(id)) continue
    const result = Bun.spawnSync(['/usr/bin/xdotool', 'getwindowname', id], {
      env: process.env,
      timeout: 1000,
    })
    if (result.exitCode === 0 && result.stdout.toString().trimEnd() === title) return id
  }
  throw new Error(`Private X11 window not found: ${title}`)
}

/** Xvfb has no window manager to handle GPUI's _NET_ACTIVE_WINDOW request. */
export async function focusNativeQaWindow(title: string): Promise<void> {
  const id = privateWindowId(title)
  const result = Bun.spawnSync(['/usr/bin/xdotool', 'windowfocus', '--sync', id], {
    env: process.env,
    timeout: 5000,
  })
  if (result.exitCode !== 0)
    throw new Error(`Private X11 focus failed: ${result.stderr.toString()}`)
  await Bun.sleep(80)
}

export function closeNativeQaWindow(title: string): void {
  const id = privateWindowId(title)
  if (process.arch !== 'x64' && process.arch !== 'arm64')
    throw new Error('Private X11 close requires a 64-bit Linux ABI.')
  // Xvfb has no WM to forward _NET_CLOSE_WINDOW. Send the client protocol directly.
  const library = dlopen('libX11.so.6', {
    XOpenDisplay: { args: [FFIType.ptr], returns: FFIType.ptr },
    XInternAtom: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.u64 },
    XSendEvent: {
      args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i64, FFIType.ptr],
      returns: FFIType.i32,
    },
    XCloseDisplay: { args: [FFIType.ptr], returns: FFIType.i32 },
  })
  const display = library.symbols.XOpenDisplay(null)
  if (!display) {
    library.close()
    throw new Error('Could not open the private X11 display.')
  }
  try {
    const protocolsName = Buffer.from('WM_PROTOCOLS\0')
    const deleteName = Buffer.from('WM_DELETE_WINDOW\0')
    const protocols = library.symbols.XInternAtom(display, ptr(protocolsName), 0)
    const deleteWindow = library.symbols.XInternAtom(display, ptr(deleteName), 0)
    const event = Buffer.alloc(192)
    const view = new DataView(event.buffer, event.byteOffset, event.byteLength)
    view.setInt32(0, 33, true)
    view.setInt32(16, 1, true)
    view.setBigUint64(24, BigInt(display), true)
    view.setBigUint64(32, BigInt(id), true)
    view.setBigUint64(40, BigInt(protocols), true)
    view.setInt32(48, 32, true)
    view.setBigUint64(56, BigInt(deleteWindow), true)
    if (!library.symbols.XSendEvent(display, BigInt(id), 0, 0n, ptr(event)))
      throw new Error('Could not send the private WM_DELETE_WINDOW event.')
  } finally {
    library.symbols.XCloseDisplay(display)
    library.close()
  }
}

export function getNativeQaWindowGeometry(title: string): {
  x: number
  y: number
  width: number
  height: number
} {
  const id = privateWindowId(title)
  const result = Bun.spawnSync(['/usr/bin/xdotool', 'getwindowgeometry', '--shell', id], {
    env: process.env,
    timeout: 5000,
  })
  if (result.exitCode !== 0)
    throw new Error(`Private X11 geometry failed: ${result.stderr.toString()}`)
  const fields = Object.fromEntries(
    result.stdout
      .toString()
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  )
  const bounds = {
    x: Number(fields.X),
    y: Number(fields.Y),
    width: Number(fields.WIDTH),
    height: Number(fields.HEIGHT),
  }
  if (!Object.values(bounds).every(Number.isFinite))
    throw new Error('Invalid private X11 geometry response.')
  return bounds
}
import { dlopen, FFIType, ptr } from 'bun:ffi'
