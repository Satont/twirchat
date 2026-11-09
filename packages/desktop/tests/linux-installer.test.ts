import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readlink, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const installer = resolve(import.meta.dir, '../../../scripts/install-linux.sh')
const filename = 'dev.twirchat.app-1.0.0-linux-x64.AppImage'
const payload = `#!/usr/bin/env bash
test "$1" = --appimage-extract || exit 70
mkdir -p squashfs-root
printf 'fixture icon' > squashfs-root/twirchat.png
`
const curl = `#!/usr/bin/env bash
set -euo pipefail
output=''
url=''
while (($#)); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "$INSTALLER_FIXTURE/requests"
case "$url" in
  https://api.github.com/repos/Satont/twirchat/releases/latest)
    cat "$INSTALLER_FIXTURE/downloads/release.json" ;;
  https://github.com/Satont/twirchat/releases/download/v1.0.0/*)
    cp "$INSTALLER_FIXTURE/downloads/\${url##*/}" "$output" ;;
  *) echo 'Unexpected network request' >&2; exit 99 ;;
esac
`
const uname = `#!/usr/bin/env bash
case "$1" in
  -s) echo Linux ;;
  -m) echo "$INSTALLER_ARCH" ;;
  *) exit 2 ;;
esac
`
const commands = {
  curl,
  uname,
  'update-desktop-database': '#!/usr/bin/env bash\nexit 0\n',
}

interface InstallerFixture {
  home: string
  downloads: string
  requests: string
  run: (arch?: string) => Promise<{ code: number; stdout: string; stderr: string }>
}

async function withFixture(run: (fixture: InstallerFixture) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'twirchat-installer-'))
  const home = join(directory, 'home with spaces')
  const downloads = join(directory, 'downloads')
  const bin = join(directory, 'bin')
  const requests = join(directory, 'requests')
  try {
    await Promise.all([mkdir(home), mkdir(downloads), mkdir(bin)])
    await Bun.write(requests, '')
    await Bun.write(join(downloads, filename), payload)
    await Bun.write(
      join(downloads, 'SHA256SUMS'),
      `${createHash('sha256').update(payload).digest('hex')}  ${filename}\n`,
    )
    await Bun.write(
      join(downloads, 'release.json'),
      JSON.stringify({
        tag_name: 'v1.0.0',
        assets: [filename, 'SHA256SUMS'].map((name) => ({
          name,
          browser_download_url: `https://github.com/Satont/twirchat/releases/download/v1.0.0/${name}`,
        })),
      }),
    )
    for (const [name, contents] of Object.entries(commands)) {
      const path = join(bin, name)
      // eslint-disable-next-line no-await-in-loop
      await Bun.write(path, contents)
      // eslint-disable-next-line no-await-in-loop
      await chmod(path, 0o755)
    }
    await run({
      home,
      downloads,
      requests,
      async run(arch = 'x86_64') {
        const child = Bun.spawn(['bash', installer], {
          cwd: directory,
          env: {
            HOME: home,
            PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
            INSTALLER_FIXTURE: directory,
            INSTALLER_ARCH: arch,
          },
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 5000,
        })
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        return { code, stdout, stderr }
      },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform !== 'linux')('Linux installer', () => {
  test('installs the verified x64 package and desktop integration', () =>
    withFixture(async ({ home, run }) => {
      const result = await run()
      expect(result).toMatchObject({ code: 0, stderr: '' })
      const app = join(home, '.local/share/dev.twirchat.app/TwirChat.AppImage')
      expect(await Bun.file(app).text()).toBe(payload)
      expect((await stat(app)).mode & 0o111).toBe(0o111)
      expect(await readlink(join(home, '.local/bin/twirchat'))).toBe(app)
      expect(await Bun.file(join(home, '.local/share/dev.twirchat.app/icon.png')).text()).toBe(
        'fixture icon',
      )
      const desktop = await Bun.file(
        join(home, '.local/share/applications/dev.twirchat.app.desktop'),
      ).text()
      expect(desktop).toContain(`Exec="${app}" %u`)
      expect(desktop).toContain('StartupWMClass=dev.twirchat.app\n')
      expect(
        await Bun.file(join(home, '.local/share/applications/twirchat.desktop')).exists(),
      ).toBe(false)
    }))

  test('migrates the previous installer desktop entry', () =>
    withFixture(async ({ home, run }) => {
      const app = join(home, '.local/share/dev.twirchat.app/TwirChat.AppImage')
      const legacy = join(home, '.local/share/applications/twirchat.desktop')
      await Bun.write(
        legacy,
        `[Desktop Entry]\nVersion=1.0\nType=Application\nName=TwirChat\nComment=Multi-platform chat manager for streamers\nExec="${app}" %u\nIcon=twirchat\nTerminal=false\nStartupWMClass=TwirChat\nCategories=Network;InstantMessaging;\n`,
      )
      expect(await run()).toMatchObject({ code: 0, stderr: '' })
      expect(await Bun.file(legacy).exists()).toBe(false)
      expect(
        await Bun.file(join(home, '.local/share/applications/dev.twirchat.app.desktop')).text(),
      ).toContain('StartupWMClass=dev.twirchat.app\n')
    }))

  test.each(['Exec', 'Name', 'StartupWMClass'])(
    'preserves a legacy-named desktop entry with a custom %s',
    (customField) =>
      withFixture(async ({ home, run }) => {
        const app = join(home, '.local/share/dev.twirchat.app/TwirChat.AppImage')
        const legacy = join(home, '.local/share/applications/twirchat.desktop')
        const fields = {
          Exec: `"${app}" %u`,
          Name: 'TwirChat',
          StartupWMClass: 'TwirChat',
        }
        const contents = `[Desktop Entry]\n${Object.entries(fields)
          .map(([key, value]) => `${key}=${key === customField ? 'custom' : value}`)
          .join('\n')}\n`
        await Bun.write(legacy, contents)
        expect(await run()).toMatchObject({ code: 0, stderr: '' })
        expect(await Bun.file(legacy).text()).toBe(contents)
        expect(
          await Bun.file(join(home, '.local/share/applications/dev.twirchat.app.desktop')).exists(),
        ).toBe(true)
      }),
  )

  test('preserves an unrelated legacy-named desktop file', () =>
    withFixture(async ({ home, run }) => {
      const legacy = join(home, '.local/share/applications/twirchat.desktop')
      const contents = '[Desktop Entry]\nName=Other application\nExec=/opt/other\n'
      await Bun.write(legacy, contents)
      expect(await run()).toMatchObject({ code: 0, stderr: '' })
      expect(await Bun.file(legacy).text()).toBe(contents)
    }))

  test('rejects a damaged download without replacing the existing installation', () =>
    withFixture(async ({ home, downloads, run }) => {
      const app = join(home, '.local/share/dev.twirchat.app/TwirChat.AppImage')
      await mkdir(join(home, '.local/share/dev.twirchat.app'), { recursive: true })
      await Bun.write(app, 'previous installation')
      await Bun.write(join(downloads, filename), 'damaged download')
      const result = await run()
      expect(result.code).not.toBe(0)
      expect(result.stdout).toContain('FAILED')
      expect(await Bun.file(app).text()).toBe('previous installation')
      expect(
        await Bun.file(join(home, '.local/share/applications/dev.twirchat.app.desktop')).exists(),
      ).toBe(false)
    }))

  test('rejects unsupported architectures before downloading or installing', () =>
    withFixture(async ({ home, requests, run }) => {
      const result = await run('aarch64')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('supports Linux x64 only')
      expect(await Bun.file(requests).text()).toBe('')
      expect(
        await Bun.file(join(home, '.local/share/dev.twirchat.app/TwirChat.AppImage')).exists(),
      ).toBe(false)
    }))
})
