export type ReleaseNoteKind = 'new' | 'improved' | 'fixed' | 'removed' | 'docs' | 'other'

export interface ReleaseNotesSection {
  kind: ReleaseNoteKind
  items: string[]
}

export const releaseNoteKindLabels: Record<ReleaseNoteKind, string> = {
  new: 'New features',
  improved: 'Improvements',
  fixed: 'Fixes',
  removed: 'Removed',
  docs: 'Documentation',
  other: 'Other changes',
}

export const releaseNoteBadgeLabels: Record<ReleaseNoteKind, string> = {
  new: 'NEW',
  improved: 'IMPROVED',
  fixed: 'FIXED',
  removed: 'REMOVED',
  docs: 'DOCS',
  other: 'OTHER',
}

const kindOrder: readonly ReleaseNoteKind[] = [
  'new',
  'improved',
  'fixed',
  'removed',
  'docs',
  'other',
]
const hiddenSectionTitles = new Set(['new contributors'])
const monthNames: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const newVerbs = new Set([
  'add',
  'browse',
  'create',
  'display',
  'enable',
  'expose',
  'feature',
  'implement',
  'introduce',
  'make',
  'new',
  'provide',
  'show',
  'support',
])
const improvedVerbs = new Set([
  'avoid',
  'cache',
  'improve',
  'lay',
  'optimise',
  'optimize',
  'parallelize',
  'performance',
  'reduce',
  'refactor',
  'reuse',
  'simplify',
  'speed',
  'streamline',
  'update',
])
const fixedVerbs = new Set([
  'clamp',
  'close',
  'correct',
  'deduplicate',
  'ensure',
  'escape',
  'fix',
  'guard',
  'handle',
  'hide',
  'keep',
  'preserve',
  'prevent',
  'repair',
  'resolve',
  'restore',
  'stabilize',
  'stop',
])
const removedVerbs = new Set(['delete', 'deprecate', 'drop', 'remove'])
const docsVerbs = new Set(['doc', 'docs', 'document', 'documentation', 'readme'])

interface ParsedSection {
  title: string
  items: string[]
}

export function parseReleaseNotes(notes: string): ReleaseNotesSection[] {
  if (!notes.trim()) return [{ kind: 'other', items: ['No release notes available.'] }]

  const lines = notes
    .split('\n')
    .map((line) => line.replace(/\s+by\b.*/, '').trim())
    .filter((line) => line.length > 0)

  const firstHeader = lines.findIndex((line) => /^#{2,3}\s+\S/u.test(line))
  const relevantLines = firstHeader >= 0 ? lines.slice(firstHeader) : lines
  const parsed: ParsedSection[] = []
  let current: ParsedSection | null = null

  const pushItem = (item: string) => {
    const value = cleanMarkdown(item)
    if (!value) return
    current ??= { title: 'Changes', items: [] }
    current.items.push(value)
  }

  for (const line of relevantLines) {
    if (/^(-{3,}|\*{3,})$/u.test(line)) continue

    const headerMatch = line.match(/^#{2,3}\s+(.+)$/u)
    if (headerMatch) {
      if (current) parsed.push(current)
      current = { title: cleanMarkdown(headerMatch[1] ?? ''), items: [] }
      continue
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/u)
    if (bulletMatch) {
      pushItem(bulletMatch[1] ?? '')
      continue
    }

    const numberedMatch = line.match(/^\d+\.\s+(.+)$/u)
    if (numberedMatch) {
      pushItem(numberedMatch[1] ?? '')
      continue
    }

    pushItem(line)
  }

  if (current) parsed.push(current)

  const items = parsed
    .filter((section) => !hiddenSectionTitles.has(section.title.toLowerCase()))
    .flatMap((section) => section.items)
    .filter((item) => !isMetadataItem(item))

  const grouped = new Map<ReleaseNoteKind, string[]>()
  for (const item of items) {
    const kind = classifyChange(item)
    const bucket = grouped.get(kind)
    if (bucket) bucket.push(item)
    else grouped.set(kind, [item])
  }

  const sections = kindOrder.flatMap((kind) => {
    const bucket = grouped.get(kind)
    return bucket && bucket.length > 0 ? [{ kind, items: bucket }] : []
  })

  return sections.length > 0
    ? sections
    : [{ kind: 'other', items: ['No release notes available.'] }]
}

export function formatReleaseDate(publishedAt: string): string | null {
  if (!publishedAt) return null
  const date = new Date(publishedAt)
  if (Number.isNaN(date.getTime())) return null
  const month = monthNames[date.getUTCMonth()]
  if (!month) return null
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

function classifyChange(text: string): ReleaseNoteKind {
  const firstWord = text.match(/^[a-z]+/iu)?.[0].toLowerCase() ?? ''
  const stems = new Set([firstWord])
  const base = firstWord.replace(/(?:ing|ed|es|s)$/u, '')
  if (base) {
    stems.add(base)
    stems.add(`${base}e`)
  }

  const matches = (verbs: Set<string>) => [...stems].some((stem) => verbs.has(stem))
  if (matches(removedVerbs)) return 'removed'
  if (matches(fixedVerbs)) return 'fixed'
  if (matches(improvedVerbs)) return 'improved'
  if (matches(docsVerbs)) return 'docs'
  if (matches(newVerbs)) return 'new'
  return 'other'
}

function isMetadataItem(item: string): boolean {
  return /^(backend image|full changelog|source):/iu.test(item)
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/~~([^~]+)~~/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
}
