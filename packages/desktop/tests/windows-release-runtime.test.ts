import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('Windows release stages all MinGW runtimes required by Velopack', async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, '../../../.github/workflows/release.yml'),
  ).text()

  expect(workflow).toMatch(
    /name: Stage MinGW runtime dependencies[\s\S]*if: matrix.target == 'win'/,
  )
  expect(workflow).toContain('$gccDirectory = Split-Path -Parent (Get-Command gcc).Source')
  expect(workflow).toContain("$runtimeDlls = 'libgcc_s_seh-1.dll', 'libwinpthread-1.dll'")
  expect(workflow).toContain('foreach ($runtimeDllName in $runtimeDlls) {')
  expect(workflow).toContain('$runtimeDll = Join-Path $gccDirectory $runtimeDllName')
  expect(workflow).toContain(
    "Copy-Item -LiteralPath $runtimeDll -Destination (Join-Path 'bin' $runtimeDllName)",
  )
})

test('Windows release builds a GUI-subsystem executable', async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, '../../../.github/workflows/release.yml'),
  ).text()

  expect(workflow).toContain('goLdflags="$goLdflags -H windowsgui"')
})
