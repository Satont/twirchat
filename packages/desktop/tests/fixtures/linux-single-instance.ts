import { establishLinuxSingleInstance } from '../../src/services/linux-single-instance'

const profile = process.argv[2]
const marker = process.argv[3]
if (!profile || !marker) throw new Error('Missing fixture arguments')
const instance = await establishLinuxSingleInstance(profile)
await Bun.write(`${marker}.ready`, instance.kind)
if (instance.kind === 'forwarded') process.exit(0)
if (instance.kind !== 'primary') throw new Error('Linux is required')
await Bun.sleep(Number(process.env.ACTIVATION_DELAY ?? 0))
instance.bindActivation(() => {
  void Bun.write(`${marker}.activated`, 'activated').catch(() => process.exit(2))
  return true
})
