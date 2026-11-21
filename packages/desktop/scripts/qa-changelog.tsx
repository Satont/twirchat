if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
process.env.TWIRCHAT_APP_VERSION = '1.7.1'

import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { z } from 'zod'

const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()

const dbPath = process.env.DB_PATH
assert(dbPath, 'QA database path is missing')

// Previous release in the isolated profile: the startup check must treat this
// as an update and show v1.7.1 notes.
const seed = new Database(dbPath, { create: true })
seed.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
seed.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
  'gpuix_last_seen_version',
  '1.7.0',
])
seed.close()

const releaseUrl = 'https://api.github.com/repos/Satont/twirchat/releases/tags/v1.7.1'
const releaseResponse = JSON.stringify({
  tag_name: 'v1.7.1',
  body: [
    "## What's Changed",
    '* Add a release date to the changelog dialog',
    '* Add colored badges for every change',
    '* Cache release notes between launches',
    '* Reduce layout work in the modal',
    '* Fix the modal header corners',
    '* Fix scrolling for long release notes',
    '* Remove the legacy changelog banner',
    '* Document the changelog preview flag',
    '* Tweak the tooltip shadow',
    '* Add keyboard paging to the changelog',
    '* Add a version badge next to the title',
    '* Add category headings for release notes',
    '* Improve the release-note parser',
    '* Improve spacing between list items',
    '* Keep the header and footer fixed',
    '* Handle empty release notes',
    '* Correct the release date timezone',
    '* Guard against missing published timestamps',
    '* Prevent duplicate changelog entries',
    '* Show a placeholder when notes are empty',
    '* Preserve the scroll position after closing',
    '* Support light and dark badge palettes',
    '* Display a count for every category',
    '* Escape markdown in release notes',
    '* Stabilize the changelog during hot reload',
    '* Simplify the changelog state',
    '* Speed up the modal mount',
    '* Update the changelog docs',
    '* Lay out the footer actions consistently',
    '* Refactor the changelog parser',
    '',
    '## New Contributors',
    '* @infybtw made their first contribution in https://github.com/Satont/twirchat/pull/117',
    '',
    '**Full Changelog**: https://github.com/Satont/twirchat/compare/v1.7.0...v1.7.1',
  ].join('\n'),
  published_at: '2026-11-08T17:20:39Z',
  html_url: 'https://github.com/Satont/twirchat/releases/tag/v1.7.1',
})
const originalFetch = globalThis.fetch
// The QA sandbox has no network; serve the GitHub release fixture locally.
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === releaseUrl)
    return Promise.resolve(
      new Response(releaseResponse, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  return originalFetch(input, init)
}

const { captureGuiQaDisplay, decodeQaFramebuffer } =
  await import('../src/services/gui-qa-screenshot')
const { getNativeQaWindowGeometry } = await import('./qa-x11')
await import('../src/gpuix/main')

interface AutomationNode {
  id: number
  testId?: string
  children: AutomationNode[]
}

interface QaRenderer {
  getAutomationTree(): string
  getPaintedText(): string[]
  getElementBounds(id: number): { x: number; y: number; width: number; height: number } | null
  getScrollOffset(id: number): readonly number[] | null
  simulateClick(x: number, y: number, button: number): void
  simulateScrollWheel(x: number, y: number, deltaX: number, deltaY: number): void
}

const automationNodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    children: z.array(automationNodeSchema).default([]),
  }),
)

function find(renderer: QaRenderer, testId: string): AutomationNode | undefined {
  const visit = (node: AutomationNode): AutomationNode | undefined =>
    node.testId === testId ? node : node.children.map(visit).find(Boolean)
  return visit(automationNodeSchema.parse(JSON.parse(renderer.getAutomationTree())))
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}

interface PaintedBounds {
  x: number
  y: number
  width: number
  height: number
}

interface CloseLabelLegibility {
  background: string
  legiblePixels: number
  bestContrast: number
}

function linearColorChannel(value: number): number {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(red: number, green: number, blue: number): number {
  return (
    0.2126 * linearColorChannel(red) +
    0.7152 * linearColorChannel(green) +
    0.0722 * linearColorChannel(blue)
  )
}

function contrastRatio(one: number, other: number): number {
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05)
}

/**
 * Sample the Close button rect from the private framebuffer and count pixels
 * that reach the WCAG AA text contrast (4.5:1) against the button fill. The
 * label is painted on the accent background, so a muted foreground collapses
 * below the threshold and the regression fails.
 */
async function measureCloseLabelLegibility(bounds: PaintedBounds): Promise<CloseLabelLegibility> {
  const sharp = (await import('sharp')).default
  const geometry = getNativeQaWindowGeometry('TwirChat')
  const frame = decodeQaFramebuffer(
    Buffer.from(await Bun.file(join(session, 'framebuffer', 'Xvfb_screen0')).arrayBuffer()),
  )
  const left = Math.round(geometry.x + bounds.x)
  const top = Math.round(geometry.y + bounds.y)
  const width = Math.max(1, Math.round(bounds.width))
  const height = Math.max(1, Math.round(bounds.height))
  const crop = await sharp(frame.pixels, {
    raw: { width: frame.width, height: frame.height, channels: 4 },
  })
    .extract({ left, top, width, height })
    .raw()
    .toBuffer()
  const buckets = new Int32Array(4096)
  for (let index = 0; index < crop.length; index += 4) {
    const key =
      ((crop[index] ?? 0) >> 4) * 256 +
      ((crop[index + 1] ?? 0) >> 4) * 16 +
      ((crop[index + 2] ?? 0) >> 4)
    buckets[key] = (buckets[key] ?? 0) + 1
  }
  let modalKey = 0
  let modalCount = 0
  for (let key = 0; key < 4096; key++) {
    const count = buckets[key] ?? 0
    if (count > modalCount) {
      modalKey = key
      modalCount = count
    }
  }
  const background = [
    ((modalKey >> 8) & 0xf) * 16 + 8,
    ((modalKey >> 4) & 0xf) * 16 + 8,
    (modalKey & 0xf) * 16 + 8,
  ]
  const backgroundLuminance = relativeLuminance(
    background[0] ?? 0,
    background[1] ?? 0,
    background[2] ?? 0,
  )
  let legiblePixels = 0
  let bestContrast = 1
  for (let index = 0; index < crop.length; index += 4) {
    const contrast = contrastRatio(
      relativeLuminance(crop[index] ?? 0, crop[index + 1] ?? 0, crop[index + 2] ?? 0),
      backgroundLuminance,
    )
    if (contrast > bestContrast) bestContrast = contrast
    if (contrast >= 4.5) legiblePixels++
  }
  return {
    background: `#${background.map((channel) => (channel ?? 0).toString(16).padStart(2, '0')).join('')}`,
    legiblePixels,
    bestContrast: Math.round(bestContrast * 100) / 100,
  }
}

const manager = Reflect.get(globalThis, '__twirchatWindows')
const mounts = Reflect.get(manager, 'mounted')
let main: QaRenderer | undefined
const session = process.env.TWIRCHAT_QA_SESSION_DIR
assert(session, 'Missing isolated QA session directory')

try {
  await until(() => mounts.has('main'), 'main window')
  main = mounts.get('main').renderer
  const window = main
  assert.ok(window, 'Missing main renderer')

  await until(() => find(window, 'update-changelog') !== undefined, 'changelog modal')
  const text = window.getPaintedText().join('')
  assert.ok(text.includes('v1.7.1'), 'Missing version badge')
  assert.ok(text.includes('Version v1.7.1 - November 8, 2026'), 'Missing release date')
  assert.ok(/new features/iu.test(text), 'Missing New features category')
  assert.ok(/fixes/iu.test(text), 'Missing Fixes category')
  // Per-item NEW/FIXED badges were replaced by section headings in the
  // reworked modal; heading coverage above is the regression guard now.
  assert.ok(
    text.includes('Add a release date to the changelog dialog'),
    'Missing release note from the fixture',
  )
  assert.ok(!text.includes('New Contributors'), 'New Contributors section should be hidden')
  const modal = find(window, 'update-changelog')
  assert.ok(modal, 'Missing changelog modal')

  const content = find(window, 'update-changelog-content')
  assert.ok(content, 'Missing changelog content')
  const contentBounds = window.getElementBounds(content.id)
  assert.ok(contentBounds, 'Missing painted changelog content bounds')
  window.simulateScrollWheel(
    contentBounds.x + contentBounds.width / 2,
    contentBounds.y + contentBounds.height / 2,
    0,
    -400,
  )
  await until(
    () => (window.getScrollOffset(content.id)?.[1] ?? 0) < -10,
    'changelog content scrolls',
  )

  const screenshot =
    process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb'
      ? await captureGuiQaDisplay('update-changelog')
      : null
  const continueButton = find(window, 'update-changelog-continue')
  assert.ok(continueButton, 'Missing Continue button')
  const bounds = window.getElementBounds(continueButton.id)
  assert.ok(bounds, 'Missing painted Continue bounds')
  const legibility =
    process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb' ? await measureCloseLabelLegibility(bounds) : null
  if (legibility) {
    assert.ok(
      legibility.legiblePixels >= 30,
      `Close label is unreadable on the accent button (${legibility.legiblePixels} AA pixels, best ${legibility.bestContrast}:1 on ${legibility.background})`,
    )
  }
  window.simulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)

  await until(() => !find(window, 'update-changelog'), 'changelog closes')

  const check = new Database(dbPath, { readonly: true })
  const row = check
    .query<{ value: string }, []>(
      "SELECT value FROM settings WHERE key = 'gpuix_last_seen_version'",
    )
    .get()
  check.close()
  assert.equal(row?.value, '1.7.1')

  await Bun.write(
    join(session, 'changelog-result.json'),
    JSON.stringify({ ok: true, screenshot, legibility }, null, 2),
  )
  console.log('Update changelog QA passed.')

  if (manager !== undefined) await manager.quit()
} catch (error) {
  if (process.env.TWIRCHAT_QA_COMPOSITOR === 'xvfb')
    await captureGuiQaDisplay('changelog-failure').catch(() => {})
  await Bun.write(
    join(session, 'changelog-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        text: main?.getPaintedText() ?? [],
        tree: main ? JSON.parse(main.getAutomationTree()) : null,
      },
      null,
      2,
    ),
  )
  console.error(error)
  process.exit(1)
}
