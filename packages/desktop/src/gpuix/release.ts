import { runVelopackStartup } from './velopack-startup'

runVelopackStartup()

if (process.argv.includes('--twirchat-release-smoke')) {
  const { releaseSmokeReport } = await import('./release-smoke')
  console.log(JSON.stringify(releaseSmokeReport()))
} else {
  await import('./main')
}
