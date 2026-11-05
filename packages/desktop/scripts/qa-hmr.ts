import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'

import { z } from 'zod'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session, 'The isolated launcher must supply a session directory.')
const desktop = resolve(import.meta.dir, '..')
const entry = join(session, 'hmr-entry.ts')
const reports = join(session, 'hmr-rounds.jsonl')
const react = Bun.resolveSync('react', desktop)
const gpuix = Bun.resolveSync('@gpuix/react', desktop)
const source = `
import ${JSON.stringify(join(desktop, 'src/gpuix/native-bootstrap.ts'))}
import * as React from ${JSON.stringify(react)}
import { useGpuixRequired } from ${JSON.stringify(gpuix)}
import { appendFileSync } from 'node:fs'
import { getDesktopBackend } from ${JSON.stringify(join(desktop, 'src/gpuix/backend/server.ts'))}
import { useBackend } from ${JSON.stringify(join(desktop, 'src/gpuix/backend/context.ts'))}
import { useDesktopWindows } from ${JSON.stringify(join(desktop, 'src/gpuix/state/desktop-windows.ts'))}
import { useWindowScope } from ${JSON.stringify(join(desktop, 'src/gpuix/state/window-scope.ts'))}
import { useStore } from ${JSON.stringify(join(desktop, 'src/gpuix/state/create-store.ts'))}
import { registerHotkeyActions } from ${JSON.stringify(join(desktop, 'src/gpuix/state/hotkeys.ts'))}
import { focusNativeQaWindow } from ${JSON.stringify(join(desktop, 'scripts/qa-x11.ts'))}
import { moderationRevisionStore } from ${JSON.stringify(join(desktop, 'src/gpuix/state/app.ts'))}
import { mountDesktopWindows } from ${JSON.stringify(join(desktop, 'src/gpuix/window-manager.tsx'))}
declare global {
  var __hmrRound: number | undefined
  var __hmrFirstReact: typeof React | undefined
  var __hmrFirstRenderer: ReturnType<typeof useGpuixRequired> | undefined
  var __hmrFirstBackend: ReturnType<typeof getDesktopBackend> | undefined
}
const round = globalThis.__hmrRound = (globalThis.__hmrRound ?? 0) + 1
const stage = __HMR_STAGE__
globalThis.__hmrFirstReact ??= React
const backend = getDesktopBackend()
globalThis.__hmrFirstBackend ??= backend
function Probe() {
  const currentBackend = useBackend()
  const windows = useDesktopWindows()
  const scope = useWindowScope()
  const renderer = useGpuixRequired()
  const retained = useStore(moderationRevisionStore)
  const [count] = React.useState(round)
  const [clicked, setClicked] = React.useState(false)
  const [shortcuts, setShortcuts] = React.useState(0)
  const button = React.useRef<{ id: number } | null>(null)
  React.useEffect(() => registerHotkeyActions({
    openAddChannel() {},
    openTabSelector: () => setShortcuts(value => value + 1),
  }, scope), [scope])
  React.useEffect(() => {
    let active = true
    async function interact() {
      await focusNativeQaWindow('TwirChat')
      await Bun.sleep(80)
      if (!active || !button.current) return
      const bounds = renderer.getElementBounds(button.current.id)
      if (!bounds) throw new Error('The HMR button was not painted.')
      renderer.simulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)
      renderer.simulateKeystrokes('ctrl-k')
    }
    void interact().catch(error => console.error('HMR interaction failed:', error))
    return () => { active = false }
  }, [renderer])
  React.useEffect(() => {
    if (!clicked || shortcuts !== 1) return
    globalThis.__hmrFirstRenderer ??= renderer
    appendFileSync(${JSON.stringify(reports)}, JSON.stringify({
      round, stage, count, scope, window: windows?.descriptor.id,
      sameReact: globalThis.__hmrFirstReact === React,
      sameRenderer: globalThis.__hmrFirstRenderer === renderer,
      sameBackend: currentBackend === globalThis.__hmrFirstBackend,
      retained, clicked, shortcuts,
    }) + '\\n')
    moderationRevisionStore.set(stage)
  }, [currentBackend, windows, scope, renderer, retained, count, clicked, shortcuts])
  return React.createElement('div', {
    testId:'hmr-probe', ref:button, onClick:() => setClicked(true),
    style:{width:180,height:60,padding:12,backgroundColor:'#333344'},
  }, 'HMR round ' + round)
}
mountDesktopWindows(backend, () => React.createElement(Probe), () => process.exit(0))
`
const roundSchema = z.object({
  round: z.number(),
  stage: z.number(),
  sameReact: z.boolean(),
  sameRenderer: z.boolean(),
  sameBackend: z.boolean(),
  scope: z.string(),
  window: z.string().optional(),
  retained: z.number(),
  clicked: z.boolean(),
  shortcuts: z.number(),
})
await Bun.write(entry, source.replace('__HMR_STAGE__', '1'))
const child = Bun.spawn([process.execPath, '--hot', entry], {
  cwd: desktop,
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
})
const output = new Response(child.stdout).text()
const errors = new Response(child.stderr).text()
const rounds: z.infer<typeof roundSchema>[] = []
let stderr = ''
try {
  for (let round = 1; round <= 8; round++) {
    if (round > 1) await Bun.write(entry, source.replace('__HMR_STAGE__', String(round)))
    const deadline = performance.now() + 7000
    let seen = false
    while (performance.now() < deadline) {
      if (await Bun.file(reports).exists()) {
        const entries = (await Bun.file(reports).text()).trim().split('\n').filter(Boolean)
        for (const line of entries) {
          const report = roundSchema.parse(JSON.parse(line))
          if (report.stage !== round) continue
          assert(report.sameRenderer, 'HMR created a different native renderer.')
          assert(report.sameBackend, 'HMR replaced the backend singleton.')
          assert.equal(report.window, 'main', 'The new component lost its window provider.')
          assert.equal(report.scope, 'main')
          assert(report.clicked, 'The remounted native click handler did not run.')
          assert.equal(report.shortcuts, 1, 'The remounted native hotkey plan did not run once.')
          assert(
            report.retained >= round - 1 && report.retained <= round,
            'HMR reset the retained store.',
          )
          rounds.push(report)
          seen = true
          break
        }
      }
      if (seen) break
      if (child.exitCode !== null) throw new Error(`HMR child exited (${child.exitCode}).`)
      await Bun.sleep(30)
    }
    assert(seen, `HMR round ${round} did not render through the current providers.`)
    await Bun.sleep(100)
  }
} finally {
  child.kill()
  await child.exited
  await Bun.write(join(session, 'hmr-stdout.log'), await output)
  stderr = await errors
  await Bun.write(join(session, 'hmr-stderr.log'), stderr)
  await Bun.write(join(session, 'hmr-result.json'), JSON.stringify({ rounds }, null, 2))
}
assert(!stderr.includes('Invalid hook call'), 'A reload emitted an invalid-hook warning.')
console.log(JSON.stringify({ passed: true, rounds: rounds.length }))
