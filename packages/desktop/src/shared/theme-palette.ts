export function normalizePaletteColor(input: string): string | null {
  const color = input.trim().toLowerCase()
  if (!/^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(color)) return null
  const hex = color.startsWith('#') ? color.slice(1) : color
  return `#${hex.length === 3 ? hex.replace(/./g, (digit) => digit + digit) : hex}`
}
