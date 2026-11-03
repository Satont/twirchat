import { resolve } from 'node:path'

export async function assertGeneratedSources(paths: readonly string[]): Promise<void> {
  if (!paths.length) throw new Error('No generated TypeScript sources were found.')
  await Promise.all(
    paths.map(async (path) => {
      const source = await Bun.file(path).text()
      if (
        /^\s*(?:\/\/|\/\*)\s*(?:(?:eslint|oxlint)-disable|@ts-(?:ignore|expect-error|nocheck))/mu.test(
          source,
        )
      )
        throw new Error(`Generated source contains a lint/type suppression: ${path}`)
    }),
  )
  const child = Bun.spawn(
    [
      process.execPath,
      'x',
      '--no-install',
      'oxlint',
      '--config',
      resolve(import.meta.dir, 'oxlint.json'),
      '--disable-nested-config',
      '--no-ignore',
      ...paths,
    ],
    {
      cwd: resolve(import.meta.dir, '../../../..'),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, output, errors] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0)
    throw new Error(
      `Generated TypeScript violates the assertion-free contract.\n${output}${errors}`,
    )
}
