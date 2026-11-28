import { expect, test } from 'bun:test'

const inspectYouTubeKey = `
  import { config } from './src/config.ts'
  console.write(JSON.stringify(config.YOUTUBE_API_KEY ?? null))
`

test.each([
  ['omitted', undefined, null],
  ['empty', '', null],
  ['whitespace-only', ' \t ', null],
  ['padded', '  example-youtube-key\t', 'example-youtube-key'],
])('normalizes a %s YouTube API key at startup', (_description, input, expected) => {
  const env = { ...process.env }
  if (input === undefined) delete env.YOUTUBE_API_KEY
  else env.YOUTUBE_API_KEY = input

  const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', inspectYouTubeKey], {
    cwd: import.meta.dir + '/..',
    env,
    timeout: 5_000,
  })
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toBe(JSON.stringify(expected))
})
