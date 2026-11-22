import { bareEmoteQuery, rankEmoteMatchesWithTier } from './emoteCompletion'

export interface BareMentionCandidate {
  readonly displayName: string
  readonly insertLabel: string
  readonly username?: string
  readonly currentAlias?: string
}

export interface BareTabCycleState {
  readonly prefix: string
  readonly candidates: readonly [string, ...string[]]
  readonly index: number
  readonly lastText: string
  readonly pendingFrom: string | null
}

interface MentionMatch {
  readonly tier: 0 | 1
  readonly caseExact: boolean
  readonly insertText: string
}

export function bareCompletionQuery(text: string): string | undefined {
  return bareEmoteQuery(text)
}

function matchBareMention(
  candidate: BareMentionCandidate,
  query: string,
  foldedQuery: string,
): MentionMatch | null {
  const displayName = candidate.displayName.trim()
  const insertLabel = candidate.insertLabel.trim() || displayName
  const username = candidate.username?.trim() ?? ''
  const alias = candidate.currentAlias?.trim() ?? ''
  if (!insertLabel && !username) return null

  const foldedDisplay = displayName.toLowerCase()
  const foldedUsername = username.toLowerCase()
  const foldedAlias = alias.toLowerCase()
  const usernameInsert =
    username && foldedUsername !== foldedDisplay ? username : insertLabel || username

  if (displayName && foldedDisplay === foldedQuery) {
    return { tier: 0, caseExact: displayName === query, insertText: insertLabel }
  }
  if (username && foldedUsername === foldedQuery) {
    return { tier: 0, caseExact: username === query, insertText: usernameInsert }
  }
  if (alias && foldedAlias === foldedQuery && insertLabel) {
    return { tier: 0, caseExact: alias === query, insertText: insertLabel }
  }

  if (displayName && foldedDisplay.startsWith(foldedQuery)) {
    return { tier: 1, caseExact: displayName.startsWith(query), insertText: insertLabel }
  }
  if (username && foldedUsername.startsWith(foldedQuery)) {
    return { tier: 1, caseExact: username.startsWith(query), insertText: usernameInsert }
  }
  if (alias && foldedAlias.startsWith(foldedQuery) && insertLabel) {
    return { tier: 1, caseExact: alias.startsWith(query), insertText: insertLabel }
  }

  return null
}

export function rankBareMentionMatches(
  candidates: readonly BareMentionCandidate[],
  query: string,
): { exact: string[]; prefix: string[] } {
  if (!query) return { exact: [], prefix: [] }
  const foldedQuery = query.toLowerCase()
  const exactMatches: MentionMatch[] = []
  const prefixMatches: string[] = []

  for (const candidate of candidates) {
    const match = matchBareMention(candidate, query, foldedQuery)
    if (!match) continue
    if (match.tier === 0) exactMatches.push(match)
    else prefixMatches.push(match.insertText)
  }

  const exact = exactMatches
    .toSorted((a, b) => Number(b.caseExact) - Number(a.caseExact))
    .map((match) => match.insertText)

  return { exact, prefix: prefixMatches }
}

/**
 * Ranks bare Tab completions across emotes and recent chatters.
 * Emotes keep Chatterino's emote-first priority within exact and prefix tiers, while
 * prefix-matched usernames outrank substring/subsequence emote matches so large
 * emote catalogs do not drown out chatters on the first Tab press.
 */
export function rankBareTabCompletions(params: {
  readonly emotes: readonly { readonly label: string }[]
  readonly mentions: readonly BareMentionCandidate[]
  readonly query: string
}): string[] {
  const { emotes, mentions, query } = params
  if (!query) return []

  const rankedEmotes = rankEmoteMatchesWithTier(emotes, query)
  const exactEmotes: string[] = []
  const prefixEmotes: string[] = []
  const weakEmotes: string[] = []
  for (const match of rankedEmotes) {
    if (match.tier === 0) exactEmotes.push(match.item.label)
    else if (match.tier === 1) prefixEmotes.push(match.item.label)
    else weakEmotes.push(match.item.label)
  }

  const { exact: exactMentions, prefix: prefixMentions } = rankBareMentionMatches(mentions, query)
  const ordered = [
    ...exactEmotes,
    ...exactMentions,
    ...prefixEmotes,
    ...prefixMentions,
    ...weakEmotes,
  ]

  const seen = new Set<string>()
  const unique: string[] = []
  for (const label of ordered) {
    if (!label || seen.has(label)) continue
    seen.add(label)
    unique.push(label)
  }
  return unique
}

export function reconcileBareTabCycle(
  cycle: BareTabCycleState | null,
  text: string,
): BareTabCycleState | null {
  if (!cycle) return null
  if (text === cycle.lastText) {
    return cycle.pendingFrom === null ? cycle : { ...cycle, pendingFrom: null }
  }
  return null
}

export function stepBareTabCompletion(params: {
  readonly text: string
  readonly direction: 1 | -1
  readonly cycle: BareTabCycleState | null
  readonly resolveCandidates: (query: string) => readonly string[]
}): { readonly nextText: string; readonly nextCycle: BareTabCycleState } | null {
  const { text, direction, cycle, resolveCandidates } = params

  if (
    cycle &&
    (text === cycle.lastText || (cycle.pendingFrom !== null && text === cycle.pendingFrom))
  ) {
    const count = cycle.candidates.length
    const nextIndex = (cycle.index + direction + count) % count
    const candidate = cycle.candidates[nextIndex]
    if (!candidate) return null
    const nextText = `${cycle.prefix}${candidate} `
    return {
      nextText,
      nextCycle: {
        ...cycle,
        index: nextIndex,
        lastText: nextText,
        pendingFrom: text,
      },
    }
  }

  if (direction === -1) return null

  const query = bareCompletionQuery(text)
  if (!query) return null

  const candidates = resolveCandidates(query)
  const [first, ...rest] = candidates
  if (!first) return null

  const prefix = text.slice(0, -query.length)
  const nextText = `${prefix}${first} `
  return {
    nextText,
    nextCycle: {
      prefix,
      candidates: [first, ...rest],
      index: 0,
      lastText: nextText,
      pendingFrom: text,
    },
  }
}
