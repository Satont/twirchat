import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { z } from 'zod'

import { backendWebSocketUrl } from '../src/build-info'
import { validateNativeRuntimeManifest } from '../src/services/native-runtime'
import { buildNative, nativeArtifactName } from './build-gpuix-native'
import { packageRuntimeAssets } from './package-runtime-assets'

const releaseVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u)
const releaseUrlSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  )
}, 'Backend URL must be HTTP(S), without credentials, query or fragment.')
const smokeReportSchema = z.object({
  version: z.string(),
  backendUrl: z.string(),
  backendWsUrl: z.string(),
  environment: z.literal('production'),
  bunVersion: z.string(),
  target: z.string(),
  nativeApiVersion: z.literal(3),
  reactVersion: z.string(),
  reactMode: z.literal('production'),
  jsxRuntime: z.literal('production'),
  velopackStartup: z.literal(true),
  executable: z.string(),
  cwd: z.string(),
})
const desktop = resolve(import.meta.dir, '..')

export function parseReleaseBuildArguments(args: string[]) {
  const [version, backendUrl] = z.tuple([releaseVersionSchema, releaseUrlSchema]).parse(args)
  return { version, backendUrl: backendUrl.replace(/\/$/u, '') }
}

export function releaseBuildPaths(platform = process.platform) {
  const output = join(desktop, 'bin')
  switch (platform) {
    case 'darwin': {
      const app = join(output, 'TwirChat.app')
      const runtime = join(app, 'Contents', 'MacOS')
      return { output, packDirectory: app, runtime, executable: join(runtime, 'TwirChat') }
    }
    case 'win32':
      return {
        output,
        packDirectory: output,
        runtime: output,
        executable: join(output, 'twirchat.exe'),
      }
    case 'linux':
      return {
        output,
        packDirectory: output,
        runtime: output,
        executable: join(output, 'twirchat'),
      }
    default:
      throw new Error(`Unsupported desktop release platform: ${platform}`)
  }
}

export async function sameFileSystemPath(actual: string, expected: string): Promise<boolean> {
  const [actualPath, expectedPath] = await Promise.all([realpath(actual), realpath(expected)])
  return actualPath === expectedPath
}

async function run(args: string[]): Promise<void> {
  const child = Bun.spawn(args, {
    cwd: desktop,
    env: { ...process.env, NODE_ENV: 'production' },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await child.exited
  if (code !== 0) throw new Error(`Release build command failed (${code}): ${args[0]}`)
}

async function createMacBundle(app: string, version: string): Promise<void> {
  const resources = join(app, 'Contents', 'Resources')
  await mkdir(resources, { recursive: true })
  await run(['iconutil', '-c', 'icns', 'assets/icon.iconset', '-o', join(resources, 'icon.icns')])
  await Bun.write(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>TwirChat</string>
  <key>CFBundleDisplayName</key><string>TwirChat</string>
  <key>CFBundleIdentifier</key><string>dev.twirchat.app</string>
  <key>CFBundleExecutable</key><string>TwirChat</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>${version.split('-')[0]}</string>
  <key>CFBundleShortVersionString</key><string>${version.split('-')[0]}</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
`,
  )
  await run(['plutil', '-lint', join(app, 'Contents', 'Info.plist')])
}

export async function refreshSignedNativeManifest(path: string): Promise<void> {
  const manifest = z.record(z.string(), z.unknown()).parse(await Bun.file(`${path}.json`).json())
  validateNativeRuntimeManifest(manifest, `${process.platform}-${process.arch}`)
  const bytes = await Bun.file(path).bytes()
  await Bun.write(
    `${path}.json`,
    JSON.stringify(
      { ...manifest, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      null,
      2,
    ) + '\n',
  )
}

export function isMachO(header: Uint8Array): boolean {
  if (header.length < 4) return false
  const magic = Buffer.from(header).readUInt32BE(0)
  return [
    0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca,
  ].includes(magic)
}

async function signMacRuntime(directory: string): Promise<void> {
  const identity = process.env.MACOS_SIGN_APP_IDENTITY
  const keychain = process.env.MACOS_KEYCHAIN_PATH
  if (!identity && !keychain) return
  if (!identity || !keychain)
    throw new Error(
      'Mac signing requires MACOS_SIGN_APP_IDENTITY and MACOS_KEYCHAIN_PATH together.',
    )
  const queue = [directory]
  for (const current of queue) {
    // Keep filesystem traversal and codesign bounded to one operation at a time.
    // eslint-disable-next-line no-await-in-loop
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) queue.push(path)
      else if (
        entry.isFile() &&
        // eslint-disable-next-line no-await-in-loop
        isMachO(await Bun.file(path).slice(0, 4).bytes())
      ) {
        // eslint-disable-next-line no-await-in-loop
        await run([
          'codesign',
          '--force',
          '--options',
          'runtime',
          '--timestamp',
          '--sign',
          identity,
          '--keychain',
          keychain,
          '--entitlements',
          join(desktop, 'build', 'bun.entitlements'),
          path,
        ])
      }
    }
  }
  await refreshSignedNativeManifest(join(directory, 'native', nativeArtifactName()))
}

export async function buildRelease(args = process.argv.slice(2)): Promise<void> {
  const { version, backendUrl } = parseReleaseBuildArguments(args)
  const expectedBun = (await Bun.file(resolve(desktop, '../../.bun-version')).text()).trim()
  if (Bun.version !== expectedBun)
    throw new Error(`Build releases with pinned Bun ${expectedBun}; found ${Bun.version}.`)
  const paths = releaseBuildPaths()
  await buildNative(['build'])
  await run([process.execPath, 'run', 'build:overlay'])
  await rm(paths.output, { recursive: true, force: true })
  await mkdir(paths.runtime, { recursive: true })
  const compiled = await Bun.build({
    entrypoints: [join(desktop, 'src/gpuix/release.ts')],
    target: 'bun',
    minify: true,
    jsx: { runtime: 'automatic', importSource: '@gpuix/react', development: false },
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __BACKEND_URL__: JSON.stringify(backendUrl),
      'process.env.NODE_ENV': '"production"',
    },
    compile: {
      outfile: paths.executable,
      autoloadDotenv: false,
      autoloadBunfig: false,
      ...(process.platform === 'win32'
        ? {
            windows: {
              icon: join(desktop, 'assets/icon.ico'),
              hideConsole: true,
              title: 'TwirChat',
            },
          }
        : {}),
    },
  })
  if (!compiled.success)
    throw new AggregateError(compiled.logs, 'Could not compile desktop release.')
  await packageRuntimeAssets(paths.runtime)
  if (process.platform === 'darwin') {
    await createMacBundle(paths.packDirectory, version)
    await signMacRuntime(paths.runtime)
  }
  const cwd = await mkdtemp(join(tmpdir(), 'twirchat-release-smoke-'))
  try {
    const env = { ...process.env }
    delete env.CHATRIX_BACKEND_WS_URL
    const child = Bun.spawn([paths.executable, '--twirchat-release-smoke'], {
      cwd,
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (code !== 0) throw new Error(`Compiled release smoke failed (${code}): ${stderr}`)
    const report = smokeReportSchema.parse(JSON.parse(stdout.trim()))
    const expected = {
      version,
      backendUrl,
      backendWsUrl: backendWebSocketUrl(backendUrl),
      bunVersion: Bun.version,
      target: `${process.platform}-${process.arch}`,
      executable: paths.executable,
      cwd,
    }
    const [sameExecutable, sameCwd] = await Promise.all([
      sameFileSystemPath(report.executable, expected.executable),
      sameFileSystemPath(report.cwd, expected.cwd),
    ])
    if (
      report.version !== expected.version ||
      report.backendUrl !== expected.backendUrl ||
      report.backendWsUrl !== expected.backendWsUrl ||
      report.bunVersion !== expected.bunVersion ||
      report.target !== expected.target ||
      !sameExecutable ||
      !sameCwd
    )
      throw new Error(
        `Compiled release smoke does not match the requested build: ${JSON.stringify({ expected, actual: report })}`,
      )
    await Bun.write(
      join(paths.output, 'release-smoke.json'),
      JSON.stringify(report, null, 2) + '\n',
    )
    console.log(`Compiled release smoke passed: ${JSON.stringify(report)}`)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

if (import.meta.main) await buildRelease()
