import { join } from 'node:path'

import { assertGuiQaEnvironment } from './gui-qa'

/** Decode only the private Xvfb framebuffer, never the host desktop. */
export function decodeQaFramebuffer(buffer: Buffer): {
  width: number
  height: number
  pixels: Buffer
} {
  if (buffer.length < 100) throw new Error('Truncated Xvfb framebuffer header.')
  const field = (index: number) => buffer.readUInt32BE(index * 4)
  const headerBytes = field(0),
    width = field(4),
    height = field(5),
    bytesPerLine = field(12)
  const pixelBytes = field(11) / 8,
    offset = headerBytes + field(19) * 12
  if (
    headerBytes < 100 ||
    field(1) !== 7 ||
    field(2) !== 2 ||
    field(3) !== 24 ||
    field(6) !== 0 ||
    field(7) > 1 ||
    field(13) !== 4 ||
    pixelBytes !== 4 ||
    !width ||
    !height ||
    width * height > 20_000_000 ||
    bytesPerLine < width * pixelBytes ||
    offset + bytesPerLine * height > buffer.length
  )
    throw new Error('Unsupported or incomplete Xvfb framebuffer.')
  const masks = [field(14), field(15), field(16)]
  const shifts = masks.map((mask) => {
    let shift = 0
    while (shift < 32 && !((mask >>> shift) & 1)) shift++
    return shift
  })
  if (
    !masks.every((mask, index) => mask !== 0 && mask >>> (shifts[index] ?? 0) === 255) ||
    (masks[0] ?? 0) & (masks[1] ?? 0) ||
    (masks[0] ?? 0) & (masks[2] ?? 0) ||
    (masks[1] ?? 0) & (masks[2] ?? 0)
  )
    throw new Error('Unsupported Xvfb framebuffer channel masks.')
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source = offset + y * bytesPerLine + x * pixelBytes
      const value = field(7) === 0 ? buffer.readUInt32LE(source) : buffer.readUInt32BE(source)
      const target = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++)
        pixels[target + channel] = (value & (masks[channel] ?? 0)) >>> (shifts[channel] ?? 0)
      pixels[target + 3] = 255
    }
  return { width, height, pixels }
}

export async function captureGuiQaDisplay(name = 'screenshot'): Promise<string> {
  assertGuiQaEnvironment()
  if (!/^[a-z0-9_-]{1,80}$/iu.test(name)) throw new Error('Invalid GUI QA screenshot name.')
  const session = process.env.TWIRCHAT_QA_SESSION_DIR
  if (!session) throw new Error('Missing isolated GUI QA session directory.')
  const frame = decodeQaFramebuffer(
    Buffer.from(await Bun.file(join(session, 'framebuffer', 'Xvfb_screen0')).arrayBuffer()),
  )
  const sharp = (await import('sharp')).default
  const path = join(session, `${name}.png`)
  await sharp(frame.pixels, { raw: { width: frame.width, height: frame.height, channels: 4 } })
    .png()
    .toFile(path)
  return path
}
