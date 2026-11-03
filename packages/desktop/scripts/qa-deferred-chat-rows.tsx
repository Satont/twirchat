import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { Props, PublicInstance, VirtualListProps } from '@gpuix/react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { createRenderer, createRoot, startFrameLoop } = await import('@gpuix/react')
const { initializeManagedRenderer } = await import('../src/gpuix/managed-renderer')
const { nativeWindow } = await import('../src/gpuix/native-window')
const { captureGuiQaDisplay } = await import('../src/services/gui-qa-screenshot')
const { focusNativeQaWindow } = await import('./qa-x11')

interface SurfaceControl {
  elements: Map<string, number>
  update: Dispatch<SetStateAction<number[]>> | null
  remember(name: string): (element: PublicInstance | null) => void
}

function host(
  tag: 'div' | 'text' | 'virtual-list',
  props: Props | VirtualListProps,
  ...children: ReactNode[]
) {
  return React.createElement<Props>(tag, props, ...children)
}

const control: SurfaceControl = {
  elements: new Map(),
  update: null,
  remember(name) {
    return (element) => {
      if (element) control.elements.set(name, element.id)
      else control.elements.delete(name)
    }
  },
}

function Surface() {
  const [rows, update] = React.useState(() => Array.from({ length: 200 }, (_, index) => index))
  React.useEffect(() => {
    control.update = update
    return () => {
      control.update = null
    }
  }, [])
  return host(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#16161c',
      },
    },
    host(
      'div',
      {
        ref: control.remember('header'),
        style: { height: 32, flexShrink: 0, padding: 6, backgroundColor: '#302945' },
      },
      host('text', { style: { color: '#ffffff', fontSize: 14 } }, 'Private deferred chat rows'),
    ),
    host(
      'virtual-list',
      {
        ref: control.remember('list'),
        alignment: 'bottom',
        followTail: true,
        estimatedItemHeight: 24,
        style: { flexGrow: 1, minHeight: 0 },
      },
      ...rows.map((row) =>
        host(
          'div',
          {
            key: row,
            ref: control.remember(`row-${row}`),
            tabIndex: 0,
            style: {
              height: 24,
              paddingLeft: 8,
              backgroundColor: row % 2 ? '#1d1b25' : '#22202b',
            },
          },
          host('text', { style: { color: '#ffffff', fontSize: 14 } }, `CHAT_ROW_${row}`),
        ),
      ),
    ),
  )
}

const directory = process.env.TWIRCHAT_QA_SESSION_DIR
assert(directory)
const renderer = nativeWindow(createRenderer())
const title = 'TwirChat private deferred row QA'
initializeManagedRenderer(renderer, { title, appName: 'TwirChat', width: 620, height: 480 })
const root = createRoot(renderer)
const loop = startFrameLoop(renderer)
function elementId(name: string): number {
  const id = control.elements.get(name)
  assert(id !== undefined, `${name} must be mounted`)
  return id
}
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 5000
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(10)
  }
}
const samples: Array<{ update: number; header: boolean; survivingRows: number }> = []
try {
  root.render(React.createElement(Surface))
  await until(() => control.update !== null && control.elements.has('row-199'), 'initial rows')
  await until(() => renderer.getPaintedElementBounds(elementId('row-198')) !== null, 'tail paint')
  await focusNativeQaWindow(title)
  const focusedRow = elementId('row-198')
  renderer.focusElement(focusedRow)
  await until(() => renderer.getFocusedElementId() === focusedRow, 'row focus')
  const before = await captureGuiQaDisplay('deferred-rows-before')
  const update = control.update
  assert(update)
  for (let turn = 0; turn < 8; turn++) {
    const surviving = [197 + turn, 198 + turn, 199 + turn].map((row) => elementId(`row-${row}`))
    update((rows) => [...rows.slice(1), 200 + turn])
    const deadline = performance.now() + 100
    while (performance.now() < deadline) {
      const header = renderer.getPaintedElementBounds(elementId('header'))
      const survivingRows = surviving.filter(
        (id) => renderer.getPaintedElementBounds(id) !== null,
      ).length
      samples.push({ update: turn + 1, header: header !== null, survivingRows })
      assert(
        survivingRows > 0,
        'A retained-window append must not blank all surviving visible rows.',
      )
      await Bun.sleep(2)
    }
    await until(
      () => renderer.getPaintedText().some((text) => text.includes(`CHAT_ROW_${200 + turn}`)),
      'arriving row paints',
    )
    assert.equal(
      renderer.getFocusedElementId(),
      focusedRow,
      'Surviving row keeps its native focus handle.',
    )
  }
  const after = await captureGuiQaDisplay('deferred-rows-after')
  assert(samples.length > 0)
  assert.equal(control.elements.size, 202, 'Retained window stays at 200 rows plus header/list.')
  await Bun.write(
    join(directory, 'deferred-chat-rows-result.json'),
    JSON.stringify(
      {
        ok: true,
        controlledAppends: 8,
        retainedRows: 200,
        sampledPaints: samples.length,
        blankChatSamples: samples.filter((sample) => sample.survivingRows === 0).length,
        rowFocusPreserved: true,
        screenshots: [before, after],
      },
      null,
      2,
    ),
  )
} finally {
  root.unmount()
  renderer.closeWindow()
  await Bun.sleep(100)
  loop.stop()
}
