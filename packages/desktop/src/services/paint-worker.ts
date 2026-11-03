import { z } from 'zod'

import { setRuntimeConfig } from '../runtime-config'
import { avatarThumbnailer } from './avatar-image'
import { getPaintNameImage, cosmeticPaintSchema } from './cosmetics'
import { modifiedEmoteImage } from './emote-image'

try {
  const input = await Bun.stdin.text()
  if (input.length > 100_000) throw new Error('Paint job is too large.')
  const job = z
    .object({
      kind: z.unknown().optional(),
      path: z.unknown().optional(),
      width: z.unknown().optional(),
      height: z.unknown().optional(),
      modifiers: z.unknown().optional(),
      name: z.unknown().optional(),
      paint: z.unknown().optional(),
      fontSize: z.unknown().optional(),
      fontFamily: z.unknown().optional(),
      dbPath: z.unknown().optional(),
      backendUrl: z.string().url().optional(),
      size: z.unknown().optional(),
      scale: z.unknown().optional(),
    })
    .parse(JSON.parse(input))
  if (job.kind === 'avatar') {
    const avatar = z
      .object({ path: z.string(), size: z.number(), scale: z.number(), dbPath: z.string() })
      .parse(job)
    setRuntimeConfig({ dbPath: avatar.dbPath })
    const path = await avatarThumbnailer.render(avatar.path, avatar.size, avatar.scale)
    process.stdout.write(JSON.stringify({ path }))
  } else if (job.kind === 'emote') {
    if (
      typeof job.path !== 'string' ||
      typeof job.width !== 'number' ||
      typeof job.height !== 'number' ||
      typeof job.dbPath !== 'string' ||
      !Array.isArray(job.modifiers) ||
      !job.modifiers.every((value) => typeof value === 'string')
    )
      throw new Error('Invalid emote job.')
    setRuntimeConfig({
      dbPath: job.dbPath,
      ...(job.backendUrl ? { backendUrl: job.backendUrl } : {}),
    })
    const path = await modifiedEmoteImage(job.path, job.width, job.height, job.modifiers)
    process.stdout.write(JSON.stringify({ path }))
  } else {
    if (
      typeof job.name !== 'string' ||
      !job.paint ||
      typeof job.paint !== 'object' ||
      typeof job.dbPath !== 'string'
    )
      throw new Error('Invalid paint job.')
    setRuntimeConfig({
      dbPath: job.dbPath,
      ...(job.backendUrl ? { backendUrl: job.backendUrl } : {}),
    })
    const output = await getPaintNameImage(
      job.name,
      cosmeticPaintSchema.parse(job.paint),
      typeof job.fontSize === 'number' ? job.fontSize : 14,
      typeof job.fontFamily === 'string' ? job.fontFamily : 'Inter',
    )
    process.stdout.write(JSON.stringify(output))
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
