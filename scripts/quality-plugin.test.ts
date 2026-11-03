import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

interface QualityFixture {
  code: string
  extension?: 'ts' | 'tsx'
  assertions?: number
  localTypes?: number
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
]
const directory = mkdtempSync(join(tmpdir(), 'twirchat-quality-'))
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
  await Bun.write(
    config,
    JSON.stringify({
      plugins: [],
      categories: { correctness: 'off' },
      jsPlugins: [resolve(import.meta.dir, 'quality-plugin.mjs')],
      rules: {
        'project-quality/no-type-assertions': 'error',
        'project-quality/no-local-type-declarations': 'error',
      },
    }),
  )
  await Promise.all(
    fixtures.map((fixture, index) =>
      Bun.write(join(directory, `fixture-${index}.${fixture.extension ?? 'ts'}`), fixture.code),
    ),
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
    { stdout: 'pipe', stderr: 'pipe' },
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
    expect(found).toHaveLength((fixture.assertions ?? 0) + (fixture.localTypes ?? 0))
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
