import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { Props, PublicInstance } from '@gpuix/react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'

import type { NativePaintedElementBounds } from '../src/gpuix/native-window'
import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { createRenderer, createRoot, startFrameLoop } = await import('@gpuix/react')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { focusNativeQaWindow } = await import('./qa-x11')

interface SurfaceState {
  order: string[]
  showRemovable: boolean
}
interface SurfaceControl {
  elements: Map<string, number>
  commits: number
  update: Dispatch<SetStateAction<SurfaceState>> | null
  onCommit: () => void
  onReady: (update: Dispatch<SetStateAction<SurfaceState>> | null) => void
  remember: (name: string) => (element: PublicInstance | null) => void
}

type Renderer = ReturnType<typeof createRenderer>

function host(tag: 'div' | 'text', props: Props, ...children: ReactNode[]) {
  return React.createElement<Props>(tag, props, ...children)
}

function createSurfaceControl(): SurfaceControl {
  const control: SurfaceControl = {
    elements: new Map(),
    commits: 0,
    update: null,
    onCommit() {
      control.commits++
    },
    onReady(update) {
      control.update = update
    },
    remember(name) {
      return (element) => {
        if (element) control.elements.set(name, element.id)
        else control.elements.delete(name)
      }
    },
  }
  return control
}

function Surface({ control }: { control: SurfaceControl }) {
  const [state, update] = React.useState<SurfaceState>({
    order: Array.from({ length: 12 }, (_, index) => `tab-${index}`),
    showRemovable: true,
  })
  React.useEffect(() => {
    control.onCommit()
  })
  React.useEffect(() => {
    control.onReady(update)
    return () => control.onReady(null)
  }, [control])
  const remember = control.remember
  return host(
    'div',
    {
      ref: remember('root'),
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: 12,
        gap: 12,
        backgroundColor: '#16161c',
      },
    },
    host(
      'div',
      {
        ref: remember('scroll'),
        style: {
          display: 'flex',
          flexDirection: 'row',
          width: '100%',
          height: 48,
          minWidth: 0,
          flexShrink: 0,
          overflowX: 'scroll',
          overflowY: 'hidden',
          backgroundColor: '#24222d',
        },
      },
      host(
        'div',
        {
          style: { display: 'flex', flexDirection: 'row', width: 1440, flexShrink: 0 },
        },
        ...state.order.map((name) =>
          host(
            'div',
            {
              key: name,
              ref: remember(name),
              style: { width: 120, minWidth: 120, height: 40, flexShrink: 0, padding: 8 },
            },
            host('text', { style: { color: '#ffffff', fontSize: 14 } }, name),
          ),
        ),
      ),
    ),
    host(
      'div',
      { style: { display: 'flex', width: '100%', height: 30, justifyContent: 'flex-end' } },
      host('div', {
        ref: remember('right-edge'),
        style: { width: 50, height: 22, flexShrink: 0, backgroundColor: '#8355ad' },
      }),
    ),
    state.showRemovable
      ? host('div', {
          ref: remember('removable'),
          style: { width: 60, height: 24, backgroundColor: '#3c7f5f' },
        })
      : null,
    host('div', {
      ref: remember('hidden'),
      style: { width: 60, height: 24, visibility: 'hidden' },
    }),
  )
}

function elementId(control: SurfaceControl, name: string): number {
  const id = control.elements.get(name)
  assert(id !== undefined, `${name} must be mounted`)
  return id
}

function painted(renderer: Renderer, control: SurfaceControl, name: string) {
  return nativeWindow(renderer).getPaintedElementBounds(elementId(control, name))
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 7000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(20)
  }
}

function requireBounds(value: NativePaintedElementBounds | null, label: string) {
  assert(value, `${label} must have completed a paint`)
  return value
}

const directory = process.env.TWIRCHAT_QA_SESSION_DIR
assert(directory, 'The launcher must provide a private artifact directory.')
const first = nativeWindow(createRenderer())
const second = nativeWindow(createRenderer())
const firstControl = createSurfaceControl()
const secondControl = createSurfaceControl()
const firstTitle = 'TwirChat private painted geometry first'
initializeManagedRenderer(first, {
  title: firstTitle,
  appName: 'TwirChat',
  width: 620,
  height: 320,
  x: 20,
  y: 20,
})
initializeManagedRenderer(second, {
  title: 'TwirChat private painted geometry second',
  appName: 'TwirChat',
  width: 360,
  height: 250,
  x: 700,
  y: 20,
})
const firstRoot = createRoot(first)
const secondRoot = createRoot(second)
const firstLoop = startFrameLoop(first)
const secondLoop = startFrameLoop(second)

try {
  assert.equal(first.getPaintedElementBounds(999999), null)
  assert.equal(second.getPaintedElementBounds(999999), null)
  firstRoot.render(React.createElement(Surface, { control: firstControl }))
  secondRoot.render(React.createElement(Surface, { control: secondControl }))
  await until(
    () =>
      firstControl.elements.has('tab-2') &&
      secondControl.elements.has('root') &&
      painted(first, firstControl, 'tab-2') !== null &&
      painted(second, secondControl, 'root') !== null &&
      firstControl.update !== null,
    'both independent windows paint',
  )
  await focusNativeQaWindow(firstTitle)
  const firstBounds = requireBounds(painted(first, firstControl, 'root'), 'first root')
  const secondBounds = requireBounds(painted(second, secondControl, 'root'), 'second root')
  assert.equal(firstBounds.width, 620)
  assert.equal(secondBounds.width, 360)
  assert.equal(painted(first, firstControl, 'hidden'), null, 'hidden elements have no painted box')

  const tabId = elementId(firstControl, 'tab-2')
  const beforeScroll = requireBounds(first.getPaintedElementBounds(tabId), 'tab before scroll')
  const scroll = requireBounds(painted(first, firstControl, 'scroll'), 'scroll viewport')
  const beforeScrollCommits = firstControl.commits
  first.simulateScrollWheel(scroll.x + 200, scroll.y + 20, -140, 0)
  await until(() => {
    const bounds = first.getPaintedElementBounds(tabId)
    return bounds !== null && bounds.x < beforeScroll.x - 50
  }, 'cached position updates after native horizontal scrolling')
  const afterScroll = requireBounds(first.getPaintedElementBounds(tabId), 'tab after scroll')
  assert.equal(afterScroll.width, beforeScroll.width)
  assert.equal(firstControl.commits, beforeScrollCommits, 'native scroll does not rerender React')

  first.scrollTo(elementId(firstControl, 'scroll'), 0, 0)
  await until(
    () => Math.abs((first.getPaintedElementBounds(tabId)?.x ?? Infinity) - beforeScroll.x) < 1,
    'cached position updates after native programmatic scrolling',
  )
  const reorderedId = elementId(firstControl, 'tab-1')
  const beforeReorder = requireBounds(
    first.getPaintedElementBounds(reorderedId),
    'tab before reorder',
  )
  const update = firstControl.update
  assert(update)
  update((state) => ({
    ...state,
    order: ['tab-1', 'tab-0', ...state.order.slice(2)],
  }))
  await until(() => {
    const bounds = first.getPaintedElementBounds(reorderedId)
    return bounds !== null && bounds.x < beforeReorder.x - 50
  }, 'cached position updates after a same-size keyed reorder')
  assert.equal(
    elementId(firstControl, 'tab-1'),
    reorderedId,
    'keyed reorder preserves element identity',
  )

  const edgeId = elementId(firstControl, 'right-edge')
  const beforeResize = requireBounds(first.getPaintedElementBounds(edgeId), 'edge before resize')
  await first.setWindowBounds({ width: 480, height: 320 })
  await until(() => {
    const bounds = first.getPaintedElementBounds(edgeId)
    return bounds !== null && bounds.x < beforeResize.x - 100
  }, 'cached position updates after window resize')
  const afterResize = requireBounds(first.getPaintedElementBounds(edgeId), 'edge after resize')
  assert.equal(afterResize.width, beforeResize.width)
  assert.equal(
    requireBounds(painted(second, secondControl, 'root'), 'independent second root').width,
    360,
  )

  const removedId = elementId(firstControl, 'removable')
  assert(first.getPaintedElementBounds(removedId))
  update((state) => ({ ...state, showRemovable: false }))
  await until(() => first.getPaintedElementBounds(removedId) === null, 'removed IDs leave snapshot')

  const firstRootId = elementId(firstControl, 'root')
  const started = performance.now()
  let paintedReads = 0
  for (let index = 0; index < 10000; index++) {
    if (first.getPaintedElementBounds(firstRootId)) paintedReads++
  }
  const readsMs = performance.now() - started
  assert(paintedReads > 9000, 'stable snapshots remain available during rapid reads')
  assert(readsMs < 500, 'cached reads must not wait for layout frames')

  first.closeWindow()
  await until(() => !first.isWindowOpen(), 'first window closes')
  assert.equal(first.getPaintedElementBounds(firstRootId), null)
  assert(second.isWindowOpen())
  assert.equal(
    requireBounds(painted(second, secondControl, 'root'), 'second after first closes').width,
    360,
  )
  await Bun.write(
    join(directory, 'painted-geometry-result.json'),
    JSON.stringify(
      {
        ok: true,
        apiVersion: first.getTwirNativeApiVersion(),
        readsMs,
        paintedReads,
        firstBounds,
        secondBounds,
        beforeScroll,
        afterScroll,
        beforeResize,
        afterResize,
        sameSizeScrollWithoutReactCommit: true,
        sameSizeReorder: true,
        removedIdsPruned: true,
        independentWindows: true,
        closedSnapshotsCleared: true,
      },
      null,
      2,
    ),
  )
  console.log('Native completed-paint geometry QA passed.')
} finally {
  firstRoot.unmount()
  secondRoot.unmount()
  first.closeWindow()
  second.closeWindow()
  await Bun.sleep(100)
  firstLoop.stop()
  secondLoop.stop()
}
