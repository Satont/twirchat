export function formatTabMentions(count: number): string {
  if (count <= 0) return ''
  return count > 99 ? '99+' : String(count)
}
