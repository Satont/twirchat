if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
const { useWindowScope } = await import('../src/gpuix/state/window-scope')
const { useTextInputFocusTracking, isTextInputFocused } = await import('../src/gpuix/state/focus')
const { useOverlayClose, hasOpenOverlay } = await import('../src/gpuix/state/overlays')
const { useHotkeyContext, useHotkeyRoute, refreshNativeHotkeyPlan, dispatchCustomHotkey } =
  await import('../src/gpuix/state/action-bindings')
const { registerHotkeyActions, invokeHotkeyUiAction } = await import('../src/gpuix/state/hotkeys')
const { setActivePane, getActivePane, activePaneByWindowStore } =
  await import('../src/gpuix/state/active-pane')
const { chatWindowsStore } = await import('../src/gpuix/state/chat-windows')
const { windowActivityStore } = await import('../src/gpuix/state/window-activity')
const { focusNativeQaWindow } = await import('./qa-x11')
const values = new Map(),
  layouts = new Map()
const backend = {
  api: {
    getUiState: async ({ key }) => values.get(key) ?? null,
    setUiState: async ({ key, value }) => {
      values.set(key, value)
    },
    getWatchedChannelsLayout: async ({ tabId }) =>
      structuredClone(
        layouts.get(tabId) ?? {
          version: 2,
          root: {
            id: 'pane',
            type: 'panel',
            flex: 100,
            content: { type: 'watched', channelId: 'mock' },
          },
        },
      ),
    setWatchedChannelsLayout: async ({ tabId, layout }) => {
      layouts.set(tabId, structuredClone(layout))
    },
    removeWatchedChannelsLayout: async ({ tabId }) => {
      layouts.delete(tabId)
    },
  },
}
const weak = new Map(),
  mounts = new Map(),
  disposals = new Map(),
  planCalls = new Map()
const finalizations = new Set()
const finalizer = new FinalizationRegistry((id) => finalizations.add(id))
function Content({ descriptor }) {
  const renderer = useGpuixRequired(),
    scope = useWindowScope()
  const focus = useTextInputFocusTracking()
  useOverlayClose(descriptor.kind !== 'main', () => {})
  useHotkeyContext({ id: 'churn', category: 'window', handlers: { quit() {} } })
  useHotkeyRoute(['churn'])
  React.useEffect(() => {
    Object.defineProperty(renderer, '__qaWindowId', { value: scope, configurable: true })
    weak.set(scope, new WeakRef(renderer))
    finalizer.register(renderer, scope)
    mounts.set(scope, (mounts.get(scope) ?? 0) + 1)
    setActivePane({ tabId: scope, paneId: 'pane' }, scope)
    const original = renderer.setHotkeyPlan
    Object.defineProperty(renderer, 'setHotkeyPlan', {
      configurable: true,
      writable: true,
      value(this: typeof renderer, json: string) {
        planCalls.set(scope, (planCalls.get(scope) ?? 0) + 1)
        Reflect.apply(original, this, [json])
      },
    })
    const stop = registerHotkeyActions({ openAddChannel() {}, openTabSelector() {} }, scope)
    return () => {
      stop()
      disposals.set(scope, (disposals.get(scope) ?? 0) + 1)
    }
  }, [renderer, scope])
  return React.createElement(
    'div',
    { style: { width: '100%', height: '100%', backgroundColor: '#202028', padding: 12 } },
    React.createElement('text', { style: { color: '#ffffff' } }, `Lifecycle ${descriptor.kind}`),
    React.createElement('input', {
      testId: 'churn-editor',
      autoFocus: true,
      value: 'isolated lifecycle',
      ...focus,
      style: { width: 250, height: 40, color: '#ffffff' },
    }),
  )
}
const samples = [],
  closed = []
let manager = new DesktopWindowManager(
  backend,
  (descriptor) => React.createElement(Content, { descriptor }),
  () => {},
)
const requestedIterations = Number(process.env.TWIRCHAT_QA_CHURN_ITERATIONS ?? 20)
assert.ok(
  Number.isInteger(requestedIterations) && requestedIterations >= 1 && requestedIterations <= 20,
)
const started = performance.now(),
  initialRss = process.memoryUsage().rss
async function settle(ms = 100) {
  await Bun.sleep(ms)
  Bun.gc(true)
  await Bun.sleep(40)
  Bun.gc(true)
}
function closedAliveIds() {
  return closed.filter((id) => weak.get(id)?.deref() !== undefined)
}
function snapshot(iteration) {
  const memory = process.memoryUsage()
  const procStatus = readFileSync('/proc/self/status', 'utf8')
  const native = Object.fromEntries(
    ['Threads', 'RssAnon', 'RssFile', 'VmSize', 'VmRSS'].map((name) => [
      name,
      procStatus
        .split('\n')
        .find((line) => line.startsWith(`${name}:`))
        ?.trim()
        .split(/\s+/)[1] ?? null,
    ]),
  )
  native.openFds = String(readdirSync('/proc/self/fd').length)
  const sample = {
    iteration,
    elapsedMs: Math.round(performance.now() - started),
    ...memory,
    native,
    stdinDataListeners: process.stdin.listenerCount('data'),
    closedAlive: closedAliveIds().length,
    finalized: closed.filter((id) => finalizations.has(id)).length,
  }
  samples.push(sample)
  console.log(JSON.stringify(sample))
  if (memory.rss - initialRss > 512 * 1024 * 1024)
    throw new Error('Stopped: RSS grew beyond the 512 MiB safety bound.')
}
function assertClosed(id) {
  assert.equal(mounts.get(id), 1)
  assert.equal(disposals.get(id), 1)
  assert.equal(chatWindowsStore.get().has(id), false)
  assert.equal(windowActivityStore.get().has(id), false)
  assert.equal(getActivePane(id), null)
  assert.equal(isTextInputFocused(id), false)
  assert.equal(hasOpenOverlay(id), false)
  assert.throws(() => invokeHotkeyUiAction('openTabSelector', id), /unavailable/)
  const before = planCalls.get(id)
  refreshNativeHotkeyPlan(id)
  assert.equal(planCalls.get(id), before, 'closed native plan observer must be disposed')
  assert.equal(
    dispatchCustomHotkey(
      {
        elementId: 0,
        eventType: 'keyDown',
        key: 'k',
        modifiers: { ctrl: true },
        preventDefault() {},
        stopPropagation() {},
      },
      id,
    ),
    false,
  )
}
interface AllocatorDiagnostic {
  before: ReturnType<typeof process.memoryUsage>
  after: ReturnType<typeof process.memoryUsage>
  trimmed: number
  smapsBefore: string
  smapsAfter: string
}
let allocatorDiagnostic: AllocatorDiagnostic | undefined
let failure
try {
  await manager.start()
  await settle()
  snapshot(0)
  for (let index = 1; index <= requestedIterations; index++) {
    assert.ok(performance.now() - started < 38_000, 'bounded churn deadline')
    const id = await manager.openChat('source')
    await focusNativeQaWindow('TwirChat chat')
    await settle(80)
    assert.equal(mounts.get(id), 1)
    assert.ok(isTextInputFocused(id), 'actual native editor focus registered')
    await manager.close(id)
    closed.push(id)
    await settle(80)
    assertClosed(id)
    assert.deepEqual([...chatWindowsStore.get().keys()], ['main'])
    assert.deepEqual([...activePaneByWindowStore.get().keys()], ['main'])
    snapshot(index)
  }
  await settle(1000)
  snapshot(21)
} catch (error) {
  failure = error
  console.error(error)
} finally {
  await settle(2000)
  if (process.env.TWIRCHAT_QA_CHURN_TRIM_DIAGNOSTIC === '1') {
    const { dlopen, FFIType } = await import('bun:ffi')
    const before = process.memoryUsage()
    const smapsBefore = readFileSync('/proc/self/smaps_rollup', 'utf8')
    const library = dlopen('/usr/lib/libc.so.6', {
      malloc_trim: { args: [FFIType.u64], returns: FFIType.i32 },
    })
    const trimmed = library.symbols.malloc_trim(0n)
    library.close()
    await Bun.sleep(100)
    allocatorDiagnostic = {
      before,
      after: process.memoryUsage(),
      trimmed,
      smapsBefore,
      smapsAfter: readFileSync('/proc/self/smaps_rollup', 'utf8'),
    }
  }
  const initiallyAliveIds = closedAliveIds()
  // WeakRef.deref keeps its target alive until the current job ends. Cross real
  // timer jobs before the final collection, without touching any weak targets.
  await settle(40)
  await settle(40)
  const aliveIds = closedAliveIds()
  samples.push({
    ...process.memoryUsage(),
    iteration: 22,
    elapsedMs: Math.round(performance.now() - started),
    closedAlive: aliveIds.length,
    finalized: finalizations.size,
    cooldown: true,
  })
  // Bun's conservative stack scan can retain the most recently used WeakRef
  // target despite forced GC. All older windows must still be collectible.
  // https://github.com/oven-sh/bun/blob/main/test/js/node/diagnostics_channel/diagnostics_channel.test.ts
  const lastConservativeSurvivor = aliveIds.length === 1 && aliveIds[0] === closed.at(-1)
  if (!failure && aliveIds.length && !lastConservativeSurvivor)
    failure = new Error('Earlier closed native renderers remain reachable after bounded forced GC.')
  let heapSnapshotPath: string | undefined
  if (failure) {
    // Do not dereference a WeakRef in the snapshot job: that would itself retain
    // the wrapper under investigation. The marker permits offline attribution.
    await settle(40)
    heapSnapshotPath = join(process.env.TWIRCHAT_QA_SESSION_DIR, 'window-churn-heap.heapsnapshot')
    await Bun.write(heapSnapshotPath, Bun.generateHeapSnapshot('v8'))
  }
  const threadNames = {}
  const threadWaits = []
  for (const task of readdirSync('/proc/self/task')) {
    try {
      const name = readFileSync(`/proc/self/task/${task}/comm`, 'utf8').trim()
      threadNames[name] = (threadNames[name] ?? 0) + 1
      if (name === 'gpuix-ui' || name === 'Timer')
        threadWaits.push({
          id: task,
          name,
          wait: readFileSync(`/proc/self/task/${task}/wchan`, 'utf8').trim(),
        })
    } catch {}
  }
  const trend = samples.filter((sample) => sample.iteration >= 3 && sample.iteration <= 20)
  const first = trend[0],
    last = trend.at(-1)
  const resourceBaseline = requestedIterations <= 3 ? samples[0] : first
  const nativeGrowth =
    resourceBaseline && last
      ? {
          threads: Number(last.native.Threads) - Number(resourceBaseline.native.Threads),
          openFds: Number(last.native.openFds) - Number(resourceBaseline.native.openFds),
        }
      : null
  if (!failure && nativeGrowth && (nativeGrowth.threads > 8 || nativeGrowth.openFds > 4))
    failure = new Error(
      `Native resources did not stabilize after warmup: ${JSON.stringify(nativeGrowth)}`,
    )
  const report = {
    passed: !failure,
    error: failure ? String(failure) : undefined,
    warmedIterationsExcluded: 3,
    requestedIterations,
    elapsedMs: Math.round(performance.now() - started),
    stdinIsTTY: !!process.stdin.isTTY,
    threadNames,
    threadWaits,
    closed: closed.length,
    closedIds: [...closed],
    closedAlive: samples.at(-1)?.closedAlive,
    initiallyAliveIds,
    aliveIds,
    lastConservativeSurvivor,
    finalizedIds: [...finalizations],
    heapSnapshotPath,
    finalized: finalizations.size,
    nativeGrowth,
    allocatorDiagnostic,
    postWarmGrowth:
      first && last
        ? {
            rss: last.rss - first.rss,
            heapUsed: last.heapUsed - first.heapUsed,
            external: last.external - first.external,
            rssPerWindow: Math.round(
              (last.rss - first.rss) / Math.max(1, last.iteration - first.iteration),
            ),
          }
        : null,
    samples,
  }
  await Bun.write(
    join(process.env.TWIRCHAT_QA_SESSION_DIR, 'window-churn.json'),
    JSON.stringify(report, null, 2),
  )
  if (failure && process.env.TWIRCHAT_QA_CHURN_HOLD_ON_FAILURE === '1') {
    console.error(`Private churn failure ready for inspection, namespace PID ${process.pid}`)
    await Bun.sleep(10_000)
  }
  await manager.quit()
  manager = null
  await settle()
  process.exit(failure ? 1 : 0)
}
