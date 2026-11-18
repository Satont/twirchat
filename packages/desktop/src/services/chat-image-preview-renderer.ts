import { z } from 'zod'

import { loadSharp } from './paint-renderer'

export const chatImagePreviewSchema = z
  .object({
    thumbnail: z.string(),
    full: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .optional()

export type ChatImagePreview = NonNullable<z.infer<typeof chatImagePreviewSchema>>

function imageSource(data: Buffer): string {
  return `data:image/webp;base64,${data.toString('base64')}`
}

export async function prepareChatImage(bytes: Uint8Array): Promise<ChatImagePreview | undefined> {
  const sharp = loadSharp()
  const full = await sharp(bytes, { limitInputPixels: 16_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86 })
    .toBuffer()
  if (full.length > 1024 * 1024) return undefined
  const preview = await sharp(full)
    .resize({ width: 240, height: 160, fit: 'inside', withoutEnlargement: true })
    .webp()
    .toBuffer({ resolveWithObject: true })
  return {
    thumbnail: imageSource(preview.data),
    full: imageSource(full),
    width: preview.info.width,
    height: preview.info.height,
  }
}
