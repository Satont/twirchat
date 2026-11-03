import { prepareGenerator } from './prepare'

const plugin = await prepareGenerator()
const child = Bun.spawn([process.execPath, plugin], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exit(await child.exited)
