import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { readBenchmarkProvenance } from './bench-metrics'

const [chatTheme = 'modern', ...extra] = process.argv.slice(2)
if (extra.length || (chatTheme !== 'compact' && chatTheme !== 'modern'))
  throw new Error('Usage: bun run profile:chat [modern|compact]')
if (process.platform !== 'linux') throw new Error('Chat CPU profiling requires Linux.')

const pprof = Bun.which('pprof')
if (!pprof) throw new Error('Install the standalone Go pprof command and add it to PATH.')

const repository = resolve(import.meta.dir, '../../..')
const directory = await mkdtemp(join(tmpdir(), 'twirchat-chat-profile-'))
const provenance = await readBenchmarkProvenance(repository)
const config = { case: 'live', media: 'mixed', chatTheme, durationSeconds: 18, profileCpu: true }
console.log(`CPU profile artifacts at ${directory}`)

const qa = Bun.spawn(
  [
    process.execPath,
    'run',
    'qa:gui',
    '--node-env',
    'production',
    '--compositor',
    'weston',
    '--weston-shell',
    'desktop',
    '--weston-controls',
    '--display-width',
    '1400',
    '--display-height',
    '1480',
    '--timeout',
    '70',
    '--artifacts',
    directory,
    '--',
    process.execPath,
    'scripts/qa-emote-resources.tsx',
    JSON.stringify(config),
    JSON.stringify(provenance),
  ],
  { cwd: join(import.meta.dir, '..'), stdout: 'inherit', stderr: 'inherit' },
)
if ((await qa.exited) !== 0) throw new Error(`Chat profiling fixture failed. See ${directory}.`)

const sessions = (await readdir(directory, { withFileTypes: true })).filter(
  (entry) => entry.isDirectory() && entry.name.startsWith('twirchat-gui-qa-'),
)
const [session] = sessions
if (sessions.length !== 1 || !session)
  throw new Error(`Expected one isolated GUI session in ${directory}.`)
const profile = join(directory, session.name, 'gui.prof')
if (!(await Bun.file(profile).exists())) throw new Error(`CPU profile is missing at ${profile}.`)

const symbolizedProfile = join(directory, 'chat.pb.gz')
const symbolize = Bun.spawn(
  [pprof, '-proto', '-symbolize=fastlocal', `-output=${symbolizedProfile}`, profile],
  { stdout: 'inherit', stderr: 'inherit' },
)
if ((await symbolize.exited) !== 0) throw new Error(`pprof failed to symbolize ${profile}.`)

const reports = await Promise.all(
  ['flat', 'cumulative'].map(async (report) => {
    const args = ['-top', '-symbolize=none', '-nodecount=20']
    if (report === 'cumulative') args.push('-cum')
    const child = Bun.spawn([pprof, ...args, symbolizedProfile], {
      stdout: 'pipe',
      stderr: 'inherit',
    })
    const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    if (code !== 0) throw new Error(`pprof failed to produce the ${report} report for ${profile}.`)
    const outputPath = join(directory, `top-${report}.txt`)
    await Bun.write(outputPath, output)
    return `\n${report} report at ${outputPath}\n${output.trimEnd()}`
  }),
)
for (const report of reports) console.log(report)
