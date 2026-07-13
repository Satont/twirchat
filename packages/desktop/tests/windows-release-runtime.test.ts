import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('Windows release stages the MinGW runtime required by Velopack', async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, '../../../.github/workflows/release.yml'),
  ).text()

  expect(workflow).toMatch(/name: Stage MinGW GCC runtime[\s\S]*if: matrix.target == 'win'/)
  expect(workflow).toContain('$gccDirectory = Split-Path -Parent (Get-Command gcc).Source')
  expect(workflow).toContain("Join-Path $gccDirectory 'libgcc_s_seh-1.dll'")
  expect(workflow).toContain(
    'Copy-Item -LiteralPath $runtimeDll -Destination bin/libgcc_s_seh-1.dll',
  )
})
