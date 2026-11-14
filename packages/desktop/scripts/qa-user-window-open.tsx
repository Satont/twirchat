import assert from 'node:assert/strict'

import { z } from 'zod'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
await import('../src/gpuix/native-bootstrap')
const React = await import('react')
const { useGpuixRequired } = await import('@gpuix/react')
const { getDesktopBackend } = await import('../src/gpuix/backend/server')
const { UserCardDialog } = await import('../src/gpuix/components/UserCardDialog')
const { darkTheme } = await import('../src/gpuix/theme')
const { ThemeContext } = await import('../src/gpuix/theme-context')
const { DesktopWindowManager } = await import('../src/gpuix/window-manager')
import type { DesktopWindowDescriptor } from '../src/services/window-session'

type UserDescriptor = Extract<DesktopWindowDescriptor, { kind: 'user' }>

interface AutomationNode {
  id: number
  text?: string
  children: AutomationNode[]
}
const automationSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    text: z.string().optional(),
    children: z.array(automationSchema).default([]),
  }),
)

const backend = getDesktopBackend()
const target = {
  platform: 'twitch',
  platformUserId: 'qa-user-1',
  displayName: 'QA User',
  username: 'qauser',
  channelId: 'qa-channel',
}

let mainRenderer: import('@gpuix/native').GpuixRenderer | undefined
let userWindowId: string | undefined

function Shell() {
  const renderer = useGpuixRequired()
  const [open, setOpen] = React.useState(true)
  React.useEffect(() => {
    mainRenderer = renderer
  }, [renderer])
  return React.createElement(
    ThemeContext.Provider,
    { value: darkTheme },
    open
      ? React.createElement(UserCardDialog, { target, onClose: () => setOpen(false) })
      : React.createElement('text', null, 'card closed'),
  )
}

function StandaloneUser({ descriptor }: { descriptor: UserDescriptor }) {
  React.useEffect(() => {
    userWindowId = descriptor.id
  }, [descriptor.id])
  return React.createElement(
    ThemeContext.Provider,
    { value: darkTheme },
    React.createElement(UserCardDialog, {
      target: descriptor.target,
      standalone: true,
      onClose: () => {},
    }),
  )
}

const manager = new DesktopWindowManager(
  backend,
  (descriptor) =>
    descriptor.kind === 'user'
      ? React.createElement(StandaloneUser, { descriptor })
      : React.createElement(Shell),
  () => {},
)

function currentRenderer(): import('@gpuix/native').GpuixRenderer {
  const renderer = mainRenderer
  assert(renderer, 'main renderer not ready')
  return renderer
}

function nodes(): AutomationNode[] {
  const root = automationSchema.parse(JSON.parse(currentRenderer().getAutomationTree()))
  const out: AutomationNode[] = []
  function walk(node: AutomationNode): void {
    out.push(node)
    for (const child of node.children) walk(child)
  }
  walk(root)
  return out
}

async function until(check: () => unknown, label: string): Promise<void> {
  const deadline = performance.now() + 8000
  while (!check()) {
    assert.ok(performance.now() < deadline, `Timed out: ${label}`)
    await Bun.sleep(25)
  }
}

try {
  await manager.start()
  await until(() => mainRenderer !== undefined, 'main renderer')
  const button = nodes().find((node) => node.text === 'Open in window')
  assert.ok(button, 'Open in window button')
  const renderer = currentRenderer()
  const bounds = renderer.getElementBounds(button.id)
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0, 'button bounds')
  console.log('[qa] clicking Open in window at', bounds)
  renderer.simulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)
  await until(() => userWindowId !== undefined, 'user window descriptor')
  await Bun.sleep(500)
  console.log('[qa] user window opened without crash')
  if (userWindowId) await manager.close(userWindowId)
  console.log('[qa] completed')
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
