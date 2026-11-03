import type { decodeQaFramebuffer } from '../src/services/gui-qa-screenshot'

export function distributionFrameHasPaint(frame: ReturnType<typeof decodeQaFramebuffer>): boolean {
  const colors = new Set<number>()
  let sampled = 0
  let nonblack = 0
  for (let y = 0; y < frame.height; y += 8)
    for (let x = 0; x < frame.width; x += 8) {
      const color = frame.pixels.readUInt32LE((y * frame.width + x) * 4) & 0xffffff
      sampled++
      if ((color & 255) > 8 || ((color >>> 8) & 255) > 8 || ((color >>> 16) & 255) > 8) nonblack++
      if (colors.size < 16) colors.add(color)
    }
  return colors.size >= 16 && nonblack >= sampled * 0.05
}
