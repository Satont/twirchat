import assert from 'node:assert/strict'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

import { prepareLinuxUpdateLocator } from '../src/gpuix/linux-update-runtime'
import { assertGuiQaEnvironment } from '../src/services/gui-qa'

assertGuiQaEnvironment()
const sourceUpdater = process.argv[2]
if (process.argv.length !== 3 || !sourceUpdater || !isAbsolute(sourceUpdater)) {
  throw new Error('Usage inside qa:gui: bun scripts/qa-linux-update.ts /absolute/path/UpdateNix')
}
const session = process.env.TWIRCHAT_QA_SESSION_DIR
if (!session) throw new Error('Missing private GUI QA session directory.')

const packageId = 'dev.twirchat.qa.update'
const fixture = await mkdtemp(join(session, 'Linux update fixture '))
const currentBinaryDir = join(fixture, 'mounted image', 'usr', 'bin')
const packagesDirectory = join(fixture, 'package cache')
const appImage = join(fixture, 'integrated application', 'TwirChat QA.AppImage')
const marker = join(fixture, 'restart marker')
const logPath = join(fixture, 'updater log')
const packagePath = join(packagesDirectory, `${packageId}-1.1.0-linux-${process.arch}-full.nupkg`)
const targetManifest = join(fixture, 'target manifest')
const targetAppImage = join(fixture, 'target AppImage')
const targetScript =
  '#!/bin/sh\nprintf \'%s\\n%s\\n\' "$0" "$VELOPACK_RESTART" > "$TWIRCHAT_UPDATE_QA_MARKER"\n'
const deadline = Date.now() + 15_000

function releaseManifest(version: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2010/07/nuspec.xsd">
  <metadata>
    <id>${packageId}</id><title>TwirChat update QA</title><description>Private update fixture</description>
    <authors>TwirChat</authors><version>${version}</version><channel>linux-${process.arch}</channel>
    <mainExe>twirchat</mainExe><os>linux</os><rid>linux-${process.arch}</rid>
    <machineArchitecture>${process.arch}</machineArchitecture>
  </metadata>
</package>`
}

async function beforeDeadline<T>(task: Promise<T>, cancel: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            cancel()
            reject(new Error(`Linux update QA timed out; fixture: ${fixture}`))
          },
          Math.max(1, deadline - Date.now()),
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function waitForFile(path: string, pattern: RegExp): Promise<string> {
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    if (await Bun.file(path).exists()) {
      // eslint-disable-next-line no-await-in-loop
      const contents = await Bun.file(path).text()
      if (pattern.test(contents)) return contents
    }
    // eslint-disable-next-line no-await-in-loop
    await Bun.sleep(20)
  }
  throw new Error(`Linux update QA did not observe ${pattern} in ${path}`)
}

await mkdir(currentBinaryDir, { recursive: true })
await mkdir(packagesDirectory, { recursive: true })
await mkdir(dirname(appImage), { recursive: true })
await copyFile(sourceUpdater, join(currentBinaryDir, 'UpdateNix'))
await Bun.write(join(currentBinaryDir, 'sq.version'), releaseManifest('1.0.0'))
await Bun.write(appImage, '#!/bin/sh\nexit 17\n')
await chmod(appImage, 0o755)
await Bun.write(targetManifest, releaseManifest('1.1.0'))
await Bun.write(targetAppImage, targetScript)

const createPackage = Bun.spawn(
  [
    'python3',
    '-c',
    `import pathlib, sys, zipfile
package, manifest, appimage, package_id = sys.argv[1:]
with zipfile.ZipFile(package, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr(package_id + '.nuspec', pathlib.Path(manifest).read_bytes())
    archive.writestr('lib/app/' + package_id + '.AppImage', pathlib.Path(appimage).read_bytes())
`,
    packagePath,
    targetManifest,
    targetAppImage,
    packageId,
  ],
  { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' },
)
const packageErrors = new Response(createPackage.stderr).text()
assert.equal(
  await beforeDeadline(createPackage.exited, () => createPackage.kill()),
  0,
  await packageErrors,
)

const locator = await prepareLinuxUpdateLocator({
  appImage,
  currentBinaryDir,
  runtimeDirectory: join(fixture, 'independent runtime'),
  packagesDirectory,
})
const { FileSource, UpdateManager } = await import('velopack')
const manager = new UpdateManager(new FileSource(packagesDirectory), undefined, locator)
assert.equal(manager.getCurrentVersion(), '1.0.0')
assert.equal(manager.getAppId(), packageId)

const parent = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
  stdin: 'ignore',
  stdout: 'ignore',
  stderr: 'ignore',
})
const updater = Bun.spawn(
  [
    locator.UpdateExePath,
    'apply',
    '--silent',
    '--root',
    locator.RootAppDir,
    '--packageDir',
    packagesDirectory,
    '--package',
    packagePath,
    '--waitPid',
    String(parent.pid),
    '--log',
    logPath,
  ],
  {
    cwd: dirname(locator.UpdateExePath),
    env: { ...process.env, TWIRCHAT_UPDATE_QA_MARKER: marker },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  },
)
const output = Promise.all([
  new Response(updater.stdout).text(),
  new Response(updater.stderr).text(),
])
try {
  await waitForFile(logPath, /Waiting .*for process/u)
  await rm(join(fixture, 'mounted image'), { recursive: true })
  parent.kill()
  await beforeDeadline(parent.exited, () => parent.kill('SIGKILL'))
  const exitCode = await beforeDeadline(updater.exited, () => updater.kill('SIGKILL'))
  const [stdout, stderr] = await output
  assert.equal(
    exitCode,
    0,
    `Updater failed:\n${stdout}\n${stderr}\n${await readFile(logPath, 'utf8')}`,
  )
  assert.equal(await readFile(appImage, 'utf8'), targetScript)
  assert.equal((await stat(appImage)).mode & 0o777, 0o755)
  assert.equal(await waitForFile(marker, /true\n$/u), `${appImage}\ntrue\n`)
  console.log(
    JSON.stringify({
      fixture,
      updaterExitCode: exitCode,
      sourceRemoved: true,
      originalAppImageRestarted: true,
      executableMode: '0755',
    }),
  )
} finally {
  if (parent.exitCode === null) parent.kill('SIGKILL')
  if (updater.exitCode === null) updater.kill('SIGKILL')
  await Promise.all([parent.exited, updater.exited, output])
}
