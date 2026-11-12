interface EmoteMatch<T> {
  item: T
  tier: number
  span: number
  caseMatches: number
  length: number
  start: number
}

/** Rank before limiting results; stable ties retain favorite and catalog ordering. */
export function rankEmoteMatches<T extends { label: string }>(
  items: readonly T[],
  query: string,
): T[] {
  if (!query) return []
  const foldedQuery = query.toLowerCase()
  const matches: EmoteMatch<T>[] = []
  for (const item of items) {
    const label = item.label
    const folded = label.toLowerCase()
    const contiguousStart = folded.indexOf(foldedQuery)
    if (contiguousStart >= 0) {
      matches.push({
        item,
        tier: folded === foldedQuery ? 0 : contiguousStart === 0 ? 1 : 2,
        span: foldedQuery.length,
        caseMatches: Number(
          contiguousStart === 0 ? label.startsWith(query) : label.includes(query),
        ),
        length: label.length,
        start: contiguousStart,
      })
      continue
    }
    let end = 0
    let start = -1
    let caseMatches = 0
    let matched = true
    for (const char of query) {
      const foldedChar = char.toLowerCase()
      const next = folded.indexOf(foldedChar, end)
      if (next < 0) {
        matched = false
        break
      }
      if (start < 0) start = next
      if (label.startsWith(char, next)) caseMatches++
      end = next + foldedChar.length
    }
    if (matched)
      matches.push({ item, tier: 3, span: end - start, caseMatches, length: label.length, start })
  }
  return matches.toSorted(compareMatches).map((match) => match.item)
}

function compareMatches<T>(a: EmoteMatch<T>, b: EmoteMatch<T>): number {
  return (
    a.tier - b.tier ||
    a.span - b.span ||
    b.caseMatches - a.caseMatches ||
    a.length - b.length ||
    a.start - b.start
  )
}

export function bareEmoteQuery(text: string): string | undefined {
  return text.match(/(?:^|\s)([\p{L}\p{N}_]+)$/u)?.[1]
}
