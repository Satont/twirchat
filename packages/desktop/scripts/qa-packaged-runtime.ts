if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')
const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const executable = resolve(process.argv[2] ?? join(import.meta.dir, '../dist/twirchat'))
const expectedBun = (
  await Bun.file(resolve(import.meta.dir, '../../../.bun-version')).text()
).trim()
assert.ok(await Bun.file(executable).exists(), 'Build and package the desktop executable first.')
const directory = join(process.env.TWIRCHAT_QA_SESSION_DIR!, 'packaged-runtime-check')
await mkdir(join(directory, 'clean-cwd'), { recursive: true })
const source = join(directory, 'probe.ts')
await Bun.write(
  source,
  `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { assertGuiQaEnvironment } from ${JSON.stringify(resolve(import.meta.dir, '../src/services/gui-qa.ts'))}
import { configureNativeRuntime } from ${JSON.stringify(resolve(import.meta.dir, '../src/services/native-runtime.ts'))}
import { initDb } from ${JSON.stringify(resolve(import.meta.dir, '../src/store/db.ts'))}
assertGuiQaEnvironment()
assert.equal(Bun.version, ${JSON.stringify(expectedBun)}, 'Compile the executable with the pinned Bun version.')
delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH
const binding = configureNativeRuntime()
assert.equal(binding, join(dirname(process.execPath), 'native', 'gpuix.' + process.platform + '-' + process.arch + '.node'))
assert.notEqual(process.cwd(), dirname(process.execPath))
const addon = createRequire(import.meta.url)(binding)
assert.equal(addon.getTwirNativeApiVersion(), 3)
const renderer = new addon.GpuixRenderer()
assert.equal(renderer.getTwirNativeApiVersion(), 3)
const db = initDb(process.env.DB_PATH)
assert.equal(db.query('SELECT twir_casefold(?) AS value').get('ПРИВЕТ').value, 'привет')
assert.equal(db.query('SELECT count(*) AS count FROM accounts').get().count, 0)
for (const table of ['accounts', 'active_accounts', 'settings', 'chat_messages', 'watched_channels']) assert.ok(db.query('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', table))
db.close()
console.log(JSON.stringify({ passed: true, apiVersion: 3, bunVersion: Bun.version, databaseInitialized: true, unicodeSql: true, emptyAccounts: true, binding, executable: process.execPath, cwd: process.cwd() }))
`,
)
const result = await Bun.build({
  entrypoints: [source],
  outdir: directory,
  target: 'bun',
  naming: 'probe.js',
})
if (!result.success)
  throw new AggregateError(result.logs, 'Could not build packaged runtime probe.')
const child = Bun.spawn([executable, join(directory, 'probe.js')], {
  cwd: join(directory, 'clean-cwd'),
  env: { ...process.env, BUN_BE_BUN: '1' },
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
  timeout: 30_000,
})
const [stdout, stderr, code] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
])
assert.equal(code, 0, `Packaged native runtime failed: ${stderr}`)
const report = JSON.parse(stdout.trim().split('\n').at(-1)!)
assert.equal(report.passed, true)
assert.equal(report.executable, executable)
await Bun.write(
  join(process.env.TWIRCHAT_QA_SESSION_DIR!, 'packaged-runtime-result.json'),
  JSON.stringify(report, null, 2),
)
console.log(stdout.trim())
