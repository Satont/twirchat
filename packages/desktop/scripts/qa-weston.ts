import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const VERSION = '15.0.1-3'
const ARCHIVE = `weston-${VERSION}-x86_64.pkg.tar.zst`
const SHA256 = '92fe0bfe2cf1ae02105b0e6573f6695c6bbd4637c9a6b20299a6fea8c3d23b4d'

/** A pinned Arch package is extracted privately; no host packages are installed. */
export async function prepareQaWeston(): Promise<string> {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('The pinned headless Weston QA tool currently requires x86-64 Linux.')
  const root = join(tmpdir(), `twirchat-weston-${VERSION}`)
  await mkdir(root, { mode: 0o700, recursive: true })
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.uid !== process.getuid?.())
    throw new Error('Headless Weston QA cache must be a directory owned by this user.')
  await chmod(root, 0o700)
  const archivePath = join(root, 'weston.pkg.tar.zst')
  const archive = Bun.file(archivePath)
  if (!(await archive.exists())) {
    const response = await fetch(`https://archive.archlinux.org/packages/w/weston/${ARCHIVE}`, {
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`Headless Weston download failed (HTTP ${response.status}).`)
    const bytes = await response.arrayBuffer()
    if (
      bytes.byteLength > 5 * 1024 * 1024 ||
      createHash('sha256').update(Buffer.from(bytes)).digest('hex') !== SHA256
    )
      throw new Error('Headless Weston package checksum does not match its pinned release.')
    await Bun.write(archive, bytes)
  }
  if (
    createHash('sha256')
      .update(await archive.bytes())
      .digest('hex') !== SHA256
  )
    throw new Error('Headless Weston package checksum does not match its pinned release.')
  if (!(await Bun.file(join(root, 'usr/bin/weston')).exists())) {
    const extract = Bun.spawn(['/usr/bin/bsdtar', '-xf', archivePath, '-C', root], {
      stdout: 'ignore',
      stderr: 'pipe',
    })
    const [error, code] = await Promise.all([new Response(extract.stderr).text(), extract.exited])
    if (code !== 0) throw new Error(`Headless Weston extraction failed: ${error}`)
  }
  return root
}

export async function prepareQaWestonControls(root: string, session: string): Promise<string> {
  const flags = Bun.spawn(
    ['/usr/bin/pkg-config', '--cflags', 'pixman-1', 'wayland-server', 'xkbcommon'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [output, error, code] = await Promise.all([
    new Response(flags.stdout).text(),
    new Response(flags.stderr).text(),
    flags.exited,
  ])
  if (code !== 0) throw new Error(`Weston QA control dependencies are missing: ${error}`)
  const module = join(session, 'qa-weston-controls.so')
  const compiler = Bun.spawn(
    [
      '/usr/bin/cc',
      '-shared',
      '-fPIC',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-isystem',
      join(root, 'usr/include/libweston-15'),
      ...output.trim().split(/\s+/u).filter(Boolean),
      join(import.meta.dir, 'qa-weston-controls.c'),
      `-L${join(root, 'usr/lib')}`,
      '-lweston-15',
      '-lwayland-server',
      '-o',
      module,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [compileOutput, compileError, compileCode] = await Promise.all([
    new Response(compiler.stdout).text(),
    new Response(compiler.stderr).text(),
    compiler.exited,
  ])
  if (compileCode !== 0)
    throw new Error(`Weston QA control module failed: ${compileOutput}${compileError}`)
  return module
}
