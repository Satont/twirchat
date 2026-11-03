import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

import { assertGeneratedSources } from './guard'
import { prepareGenerator } from './prepare'

const protoRoot = resolve(import.meta.dir, '..')

async function generatedPaths(root: string): Promise<string[]> {
  const files = await Array.fromAsync(new Bun.Glob('**/*.ts').scan({ cwd: root, onlyFiles: true }))
  return files.toSorted().map((path) => resolve(root, path))
}

export async function generateProtobuf(inputRoot: string, outputRoot?: string): Promise<string> {
  await prepareGenerator()
  const buf = Bun.resolveSync('@bufbuild/buf/bin/buf', import.meta.dir)
  const args = [
    process.execPath,
    buf,
    'generate',
    inputRoot,
    '--template',
    resolve(protoRoot, 'buf.gen.yaml'),
  ]
  const destination = outputRoot ?? inputRoot
  args.push('--output', destination)
  const child = Bun.spawn(args, {
    cwd: protoRoot,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await child.exited) !== 0) throw new Error('YouTube protobuf generation failed.')
  const output = resolve(destination, 'gen')
  await assertGeneratedSources(await generatedPaths(output))
  return output
}

export function generateYouTube(outputRoot?: string): Promise<string> {
  return generateProtobuf(protoRoot, outputRoot)
}

export async function checkGeneratedYouTube(): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'twirchat-youtube-codegen-'))
  try {
    const generated = await generateYouTube(temporary)
    const expected = await generatedPaths(resolve(protoRoot, 'gen'))
    const actual = await generatedPaths(generated)
    const expectedRelative = expected.map((path) => path.slice(resolve(protoRoot, 'gen').length))
    const actualRelative = actual.map((path) => path.slice(generated.length))
    if (JSON.stringify(expectedRelative) !== JSON.stringify(actualRelative))
      throw new Error('Generated YouTube file set is stale. Run bun run gen:youtube.')
    await Promise.all(
      expected.map(async (path) => {
        const counterpart = resolve(generated, relative(resolve(protoRoot, 'gen'), path))
        const [checkedIn, fresh] = await Promise.all([
          Bun.file(path).text(),
          Bun.file(counterpart).text(),
        ])
        if (checkedIn !== fresh) throw new Error(`Generated YouTube source is stale: ${path}`)
      }),
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  if (process.argv.length > 3 || (process.argv[2] !== undefined && process.argv[2] !== '--check'))
    throw new Error('Usage: bun youtube/codegen/generate.ts [--check]')
  if (process.argv[2] === '--check') await checkGeneratedYouTube()
  else await generateYouTube()
}
