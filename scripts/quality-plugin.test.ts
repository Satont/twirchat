import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface QualityFixture {
  code: string
  extension?: 'ts' | 'tsx' | 'vue'
  directory?: string
  workspaceImports?: number
  assertions?: number
  localTypes?: number
  blockingGeometry?: number
  anchoredEvents?: number
}
interface QualityDiagnostic {
  filename: string
  code: string
}
const fixtures: QualityFixture[] = [
  { code: 'const value: string = "safe"' },
  { code: 'const value = { mode: "windowed" } satisfies Bounds' },
  {
    code: 'function isString(value: unknown): value is string { return typeof value === "string" }',
  },
  { code: 'import { value as renamed } from "module"' },
  { code: 'export { value as renamed }' },
  { code: 'const result = identity<string>("value")' },
  { code: 'const view = <div title="as const" />', extension: 'tsx' },
  { code: 'const value = input as string', assertions: 1 },
  { code: 'const value = input as const', assertions: 1 },
  { code: 'const value = <string>input', assertions: 1 },
  { code: 'const value = <const>[1, 2]', assertions: 1 },
  { code: 'const value = input as unknown as string', assertions: 2 },
  { code: 'const view = <div value={input as string} />', extension: 'tsx', assertions: 1 },
  {
    code: 'interface WindowBounds { width: number }; function getBounds(): WindowBounds { return { width: 320 } }',
  },
  { code: 'type WindowId = string; const identity = (id: WindowId): WindowId => id' },
  { code: 'function identity<T>(value: T): T { return value }' },
  { code: 'const handler: (value: string) => void = console.log' },
  { code: 'function render() { interface Bounds { width: number } }', localTypes: 1 },
  { code: 'const render = () => { type Bounds = { width: number } }', localTypes: 1 },
  { code: 'const render = function () { interface Bounds { width: number } }', localTypes: 1 },
  { code: 'class View { render() { type Bounds = { width: number } } }', localTypes: 1 },
  { code: 'async function render() { if (true) { interface Bounds {} } }', localTypes: 1 },
  { code: 'renderer.getPaintedElementBounds(id)' },
  { code: 'renderer.getPaintedElementBounds?.(id)' },
  { code: 'const label = "getElementBounds"' },
  { code: 'renderer.getElementBounds(id)', blockingGeometry: 1 },
  { code: 'renderer.getElementBounds?.(id)', blockingGeometry: 1 },
  { code: 'renderer?.getElementBounds(id)', blockingGeometry: 1 },
  { code: 'renderer["getElementBounds"](id)', blockingGeometry: 1 },
  { code: 'const read = renderer.getElementBounds', blockingGeometry: 1 },
  {
    code: 'const view = <anchored onClick={open} onMouseEnter={show} onMouseLeave={hide} onFileDrop={drop} />',
    extension: 'tsx',
  },
  {
    code: 'const view = <anchored><div onMouseDownOutside={close} /></anchored>',
    extension: 'tsx',
  },
  { code: 'const view = <div onMouseDownOutside={close} />', extension: 'tsx' },
  {
    code: 'const view = <anchored onMouseDownOutside={close} />',
    extension: 'tsx',
    anchoredEvents: 1,
  },
  {
    code: 'const view = <anchored deferred onKeyDown={key} onMouseDown={press}><div /></anchored>',
    extension: 'tsx',
    anchoredEvents: 2,
  },
]
const desktop = 'packages/desktop/src'
const backend = 'packages/backend/src'
const shared = 'packages/shared'
const gpuix = `${desktop}/gpuix`
const directory = mkdtempSync(join(tmpdir(), 'twirchat-quality-'))
fixtures.push(
  { directory: desktop, code: 'import type { Message } from "@twirchat/shared/types"' },
  { directory: `${gpuix}/components`, code: 'import { useBackend } from "../backend/context"' },
  { directory: `${gpuix}/components`, code: 'import { useT } from "@gpuix/hooks/use-translation"' },
  { directory: `${gpuix}/backend`, code: 'import "@gpuix/backend/events"' },
  { directory: `${gpuix}/backend`, code: 'import "@desktop/services/chat-transcript"' },
  { directory: `${gpuix}/backend`, code: 'import "../chat-tools"', workspaceImports: 1 },
  { directory: `${gpuix}/backend`, code: 'import("@gpuix/components/App")', workspaceImports: 1 },
  {
    directory: `${gpuix}/backend`,
    code: 'type T = import("@desktop/gpuix/state/app").MainTab',
    workspaceImports: 1,
  },
  {
    directory: `${gpuix}/backend`,
    code: 'export * from "../backend-tools/types"',
    workspaceImports: 1,
  },
  {
    directory: `${gpuix}/backend`,
    code: 'import { useT } from "../hooks/use-translation"',
    workspaceImports: 1,
  },
  { directory: `${desktop}/services`, code: 'import { t } from "../i18n"' },
  { directory: `${desktop}/i18n`, code: 'import { createStore } from "../state/create-store"' },
  { directory: `${desktop}/i18n`, code: 'import "react/jsx-runtime"', workspaceImports: 1 },
  { directory: `${desktop}/state`, code: 'import "@gpuix/react"', workspaceImports: 1 },
  { directory: `${desktop}/state`, code: 'import "@gpuix/native"', workspaceImports: 1 },
  {
    directory: `${desktop}/i18n`,
    code: 'type Locale = import("@gpuix/backend/api").DesktopApi',
    workspaceImports: 1,
  },
  {
    directory: `${desktop}/i18n`,
    code: 'import "@desktop/gpuix/hooks/use-translation"',
    workspaceImports: 1,
  },
  {
    directory: `${desktop}/services`,
    code: 'import("@gpuix/hooks/use-translation.ts")',
    workspaceImports: 1,
  },
  {
    directory: `${desktop}/platforms`,
    code: 'export * from "../gpuix/hooks/use-translation"',
    workspaceImports: 1,
  },
  { directory: `${desktop}/services`, code: 'import "@gpuix/native/host"' },
  { directory: `${desktop}/services`, code: 'import "@desktop/gpuix-tools"' },
  { directory: 'packages/desktop/tests', code: 'import "../src/gpuix/backend/api"' },
  { directory: 'packages/desktop/scripts', code: 'import "../src/gpuix/native-window"' },
  {
    directory: `${desktop}/services`,
    code: 'import type { NativeWindowBounds } from "../gpuix/native-window"',
    workspaceImports: 1,
  },
  {
    directory: `${desktop}/services`,
    code: 'import("@gpuix/backend/api")',
    workspaceImports: 1,
  },
  {
    directory: `${desktop}/views/main/utils`,
    code: 'export type { ChatterRole } from "@desktop/gpuix/backend/api"',
    workspaceImports: 1,
  },
  {
    directory: `${desktop}/services`,
    code: 'const ui = require("../../node_modules/@twirchat/desktop/src/gpuix/backend/api")',
    workspaceImports: 1,
  },
  {
    directory: `${desktop}/services`,
    code: `import(${JSON.stringify(pathToFileURL(join(directory, gpuix, 'native-window.ts')).href)})`,
    workspaceImports: 1,
  },
  { directory: `${gpuix}/state`, code: 'import { createStore } from "../../state/create-store"' },
  { directory: `${gpuix}/backend`, code: 'import { getDb } from "../../store/db"' },
  { directory: `${gpuix}/backend`, code: 'import "@desktop/platforms/twitch/adapter"' },
  { directory: `${desktop}/services`, code: 'import { getDb } from "../store/db"' },
  { directory: `${gpuix}/components`, code: 'import "@desktop/storehouse"' },
  { directory: gpuix, code: 'import "@desktop/gpuix/state/create-store?path=../foo/../bar"' },
  { directory: gpuix, code: 'import "@desktop/store?reload"', workspaceImports: 1 },
  { directory: gpuix, code: 'import "@desktop//store/db"', workspaceImports: 1 },
  { directory: gpuix, code: 'import "../store?reload"', workspaceImports: 1 },
  { directory: gpuix, code: 'import "../store/db?reload=/../other"', workspaceImports: 1 },
  {
    directory: `${gpuix}/components`,
    code: 'import { SettingsStore } from "../../store"',
    workspaceImports: 1,
  },
  {
    directory: `${gpuix}/state`,
    code: 'import(`../.././platforms/twitch/adapter`)',
    workspaceImports: 1,
  },
  {
    directory: `${gpuix}/hooks`,
    code: 'type Query = import("@desktop/store/message-store").ChatHistoryQuery',
    workspaceImports: 1,
  },
  {
    directory: `${gpuix}/backend-tools`,
    code: 'export * from "@desktop/platforms/kick/adapter"',
    workspaceImports: 1,
  },
  {
    directory: gpuix,
    code: 'const adapter = require("@twirchat/desktop/src/platforms/youtube/adapter")',
    workspaceImports: 1,
  },
  {
    directory: gpuix,
    code: 'import "../../node_modules/@twirchat/desktop/src/store/db"',
    workspaceImports: 1,
  },
  {
    directory: gpuix,
    code: `import(${JSON.stringify(pathToFileURL(join(directory, desktop, 'store/db.ts')).href)})`,
    workspaceImports: 1,
  },
  { directory: backend, code: 'import("@twirchat/shared/youtube/session")' },
  { directory: shared, code: 'export { value } from "./types"' },
  {
    directory: desktop,
    code: 'import { render } from "@gpuix/components/Example"',
    workspaceImports: 1,
  },
  { directory: backend, code: 'import "@gpuix/react/jsx-runtime"' },
  { directory: shared, code: 'import "@gpuix/native-linux-x64-gnu"' },
  { directory: 'scripts', code: 'import "../packages/backend/tests/fixture"' },
  { directory: 'packages/desktop/tests', code: 'import "../../../plugins/streamx"' },
  { directory: desktop, code: 'import "@twirchat/backend"', workspaceImports: 1 },
  {
    directory: desktop,
    code: 'import "@twirchat/shared/../backend/src/config"',
    workspaceImports: 1,
  },
  { directory: desktop, code: 'import "@desktop/../../backend/src/config"', workspaceImports: 1 },
  { directory: shared, code: 'import "@gpuix/native-window"', workspaceImports: 1 },
  {
    directory: shared,
    code: `import(${JSON.stringify(pathToFileURL(join(directory, backend, 'config.ts')).href)})`,
    workspaceImports: 1,
  },
  { directory: desktop, code: 'export * from "../.././backend/src/api"', workspaceImports: 1 },
  {
    directory: desktop,
    code: `import ${JSON.stringify('..\\..\\backend\\src\\config.ts')}`,
    workspaceImports: 1,
  },
  {
    directory: desktop,
    code: 'import "../node_modules/@twirchat/shared/types.ts"',
    workspaceImports: 1,
  },
  {
    directory: desktop,
    code: 'import type { Message } from "../../shared/types"',
    workspaceImports: 1,
  },
  { directory: backend, code: 'export type { View } from "@desktop/entry"', workspaceImports: 1 },
  { directory: backend, code: 'import(`@gpuix/backend/api`)', workspaceImports: 1 },
  { directory: backend, code: 'import "@views/overlay/protocol"', workspaceImports: 1 },
  { directory: shared, code: 'type T = import("@twirchat/desktop").T', workspaceImports: 1 },
  { directory: shared, code: 'import server = require("@backend/ws")', workspaceImports: 1 },
  { directory: shared, code: 'const server = require("../backend/src/ws")', workspaceImports: 1 },
  {
    directory: desktop,
    extension: 'vue',
    code: '<script setup lang="ts">import "@twirchat/backend"</script>',
    workspaceImports: 1,
  },
)
let diagnostics: QualityDiagnostic[] = []
function readDiagnostics(value: unknown): QualityDiagnostic[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('diagnostics' in value) ||
    !Array.isArray(value.diagnostics)
  )
    throw new Error('Oxlint did not return diagnostic JSON.')
  return value.diagnostics.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('filename' in entry) ||
      typeof entry.filename !== 'string' ||
      !('code' in entry) ||
      typeof entry.code !== 'string'
    )
      throw new Error('Oxlint returned an invalid diagnostic.')
    return { filename: basename(entry.filename), code: entry.code }
  })
}
beforeAll(async () => {
  const config = join(directory, 'oxlint.json')
  const pluginDirectory = join(directory, 'scripts')
  mkdirSync(pluginDirectory, { recursive: true })
  await Bun.write(
    join(pluginDirectory, 'quality-plugin.mjs'),
    Bun.file(resolve(import.meta.dir, 'quality-plugin.mjs')),
  )
  await Bun.write(
    config,
    JSON.stringify({
      plugins: [],
      categories: { correctness: 'off' },
      jsPlugins: ['./scripts/quality-plugin.mjs'],
      rules: {
        'project-quality/workspace-import-boundaries': 'error',
        'project-quality/no-type-assertions': 'error',
        'project-quality/no-local-type-declarations': 'error',
        'project-quality/no-blocking-native-geometry': 'error',
        'project-quality/no-unsupported-anchored-events': 'error',
      },
    }),
  )
  await Promise.all(
    fixtures.map((fixture, index) => {
      const parent = join(directory, fixture.directory ?? '')
      mkdirSync(parent, { recursive: true })
      return Bun.write(join(parent, `fixture-${index}.${fixture.extension ?? 'ts'}`), fixture.code)
    }),
  )
  // Oxlint's RuleTester raw-transfer parser cannot run under Bun. Exercise the
  // actual pinned CLI and plugin host, including its TypeScript/TSX parser.
  const result = Bun.spawnSync(
    [
      resolve(import.meta.dir, '../node_modules/.bin/oxlint'),
      '--config',
      config,
      '--format',
      'json',
      directory,
    ],
    { cwd: join(directory, desktop), stdout: 'pipe', stderr: 'pipe' },
  )
  expect(result.exitCode, result.stderr.toString()).toBe(1)
  const decoded: unknown = JSON.parse(result.stdout.toString())
  diagnostics = readDiagnostics(decoded)
})
afterAll(() => rmSync(directory, { recursive: true, force: true }))
for (const [index, fixture] of fixtures.entries()) {
  test(`quality rules: ${fixture.code}`, () => {
    const found = diagnostics.filter(
      (diagnostic) => diagnostic.filename === `fixture-${index}.${fixture.extension ?? 'ts'}`,
    )
    expect(
      found.filter((diagnostic) => diagnostic.code === 'project-quality(no-type-assertions)'),
    ).toHaveLength(fixture.assertions ?? 0)
    expect(
      found.filter(
        (diagnostic) => diagnostic.code === 'project-quality(no-local-type-declarations)',
      ),
    ).toHaveLength(fixture.localTypes ?? 0)
    expect(
      found.filter(
        (diagnostic) => diagnostic.code === 'project-quality(no-blocking-native-geometry)',
      ),
    ).toHaveLength(fixture.blockingGeometry ?? 0)
    expect(
      found.filter(
        (diagnostic) => diagnostic.code === 'project-quality(no-unsupported-anchored-events)',
      ),
    ).toHaveLength(fixture.anchoredEvents ?? 0)
    expect(
      found.filter(
        (diagnostic) => diagnostic.code === 'project-quality(workspace-import-boundaries)',
      ),
    ).toHaveLength(fixture.workspaceImports ?? 0)
    expect(found).toHaveLength(
      (fixture.workspaceImports ?? 0) +
        (fixture.assertions ?? 0) +
        (fixture.localTypes ?? 0) +
        (fixture.blockingGeometry ?? 0) +
        (fixture.anchoredEvents ?? 0),
    )
  })
}

test('import sorting keeps native bootstrap before native module imports', () => {
  const result = Bun.spawnSync(
    [
      resolve(import.meta.dir, '../node_modules/.bin/oxfmt'),
      '--stdin-filepath',
      'native-bootstrap-fixture.ts',
    ],
    {
      stdin: Buffer.from(
        "import './native-bootstrap'\nimport { createRenderer } from '@gpuix/react'\nimport { App } from './App'\n",
      ),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  expect(result.stdout.toString().trimStart().startsWith("import './native-bootstrap'\n")).toBe(
    true,
  )
})
