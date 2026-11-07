import { setRuntimeConfig } from '../runtime-config'
import { avatarThumbnailer } from './avatar-image'
import { getPaintNameImage, cosmeticPaintSchema } from './cosmetics'
import { modifiedEmoteImage } from './emote-image'
import {
  paintWorkerJobSchema,
  paintWorkerRequestSchema,
  type PaintWorkerReply,
} from './paint-worker-client'

if (!process.send) throw new Error('The image worker requires desktop IPC.')

async function runJob(input: unknown): Promise<unknown> {
  const job = paintWorkerJobSchema.parse(input)
  setRuntimeConfig({
    dbPath: job.dbPath,
    ...(job.kind !== 'avatar' && job.backendUrl ? { backendUrl: job.backendUrl } : {}),
  })
  switch (job.kind) {
    case 'avatar':
      return { path: await avatarThumbnailer.render(job.path, job.size, job.scale) }
    case 'emote':
      return { path: await modifiedEmoteImage(job.path, job.width, job.height, job.modifiers) }
    case 'paint':
      return getPaintNameImage(
        job.name,
        cosmeticPaintSchema.parse(job.paint),
        job.fontSize,
        job.fontFamily,
      )
  }
}

function reply(message: PaintWorkerReply): void {
  process.send?.(message)
}

process.on('message', (data: unknown) => {
  const request = paintWorkerRequestSchema.safeParse(data)
  if (!request.success) return
  const { id, job } = request.data
  runJob(job).then(
    (value) => reply({ id, ok: true, value }),
    (error: unknown) =>
      reply({ id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
})
process.on('disconnect', () => process.exit(0))
