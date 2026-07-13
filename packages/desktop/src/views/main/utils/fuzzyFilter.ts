/**
 * Returns items whose label contains all characters of query in order (case-insensitive).
 * Items are sorted by how early the first character of the match appears (lower index = higher rank).
 */
export function fuzzyFilter<T extends { label: string }>(items: T[], query: string): T[] {
  if (!query) return items

  const q = query.toLowerCase()

  return items
    .filter((item) => {
      let qi = 0

      for (const ch of item.label.toLowerCase()) {
        if (ch === q[qi]) qi++
        if (qi === q.length) return true
      }

      return false
    })
    .sort((a, b) => {
      const ai = a.label.toLowerCase().indexOf(q[0]!)
      const bi = b.label.toLowerCase().indexOf(q[0]!)

      return ai - bi
    })
}
