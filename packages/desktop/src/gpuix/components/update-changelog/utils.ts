export function hexMix(color: string, base: string, ratio: number): string {
  const c1 = parseInt(color.replace('#', ''), 16)
  const c2 = parseInt(base.replace('#', ''), 16)
  const r = Math.round(((c1 >> 16) & 0xff) * ratio + ((c2 >> 16) & 0xff) * (1 - ratio))
  const g = Math.round(((c1 >> 8) & 0xff) * ratio + ((c2 >> 8) & 0xff) * (1 - ratio))
  const b = Math.round((c1 & 0xff) * ratio + (c2 & 0xff) * (1 - ratio))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}
