import { t } from '../i18n'

export type ReleaseNoteKind = 'new' | 'improved' | 'fixed' | 'removed' | 'docs' | 'other'

export interface ChangelogItem {
  label: string
  description: string
}

export interface ReleaseNotesSection {
  kind: ReleaseNoteKind
  items: ChangelogItem[]
}

export const releaseNoteKindLabels: Record<ReleaseNoteKind, string> = {
  get new() {
    return t('commands.release.kind.new')
  },
  get improved() {
    return t('commands.release.kind.improved')
  },
  get fixed() {
    return t('commands.release.kind.fixed')
  },
  get removed() {
    return t('commands.release.kind.removed')
  },
  get docs() {
    return t('commands.release.kind.docs')
  },
  get other() {
    return t('commands.release.kind.other')
  },
}

export const releaseNoteBadgeLabels: Record<ReleaseNoteKind, string> = {
  get new() {
    return t('commands.release.badge.new')
  },
  get improved() {
    return t('commands.release.badge.improved')
  },
  get fixed() {
    return t('commands.release.badge.fixed')
  },
  get removed() {
    return t('commands.release.badge.removed')
  },
  get docs() {
    return t('commands.release.badge.docs')
  },
  get other() {
    return t('commands.release.badge.other')
  },
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
  'perf',
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
  if (!notes.trim())
    return [{ kind: 'other', items: [{ label: '', description: t('commands.release.noNotes') }] }]

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
    current ??= { title: t('commands.release.changes'), items: [] }
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

  const grouped = new Map<ReleaseNoteKind, ChangelogItem[]>()
  for (const item of items) {
    const kind = classifyChange(item)
    const parsedItem = parseCommitMessage(item)
    const bucket = grouped.get(kind)
    if (bucket) bucket.push(parsedItem)
    else grouped.set(kind, [parsedItem])
  }

  const sections = kindOrder.flatMap((kind) => {
    const bucket = grouped.get(kind)
    return bucket && bucket.length > 0 ? [{ kind, items: bucket }] : []
  })

  return sections.length > 0
    ? sections
    : [{ kind: 'other', items: [{ label: '', description: t('commands.release.noNotes') }] }]
}

export function formatReleaseDate(publishedAt: string): string | null {
  if (!publishedAt) return null

  return new Date(publishedAt).toLocaleDateString(t('commands.release.dateFormat'), {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function classifyChange(text: string): ReleaseNoteKind {
  // Check for conventional commit type prefix: type(scope)!: subject
  const typeMatch = text.match(/^([a-z]+)(\([^)]+\))?(!)?:\s*/u)
  if (typeMatch && typeMatch[1]) {
    const type = typeMatch[1].toLowerCase()
    // Map conventional commit types to release note kinds
    if (type === 'feat' || type === 'feature') return 'new'
    if (type === 'fix') return 'fixed'
    if (type === 'perf' || type === 'improvement') return 'improved'
    if (type === 'refactor') return 'improved'
    if (type === 'docs') return 'docs'
    if (
      type === 'chore' ||
      type === 'build' ||
      type === 'ci' ||
      type === 'style' ||
      type === 'test'
    )
      return 'other'
    if (type === 'revert') return 'removed'
    if (type === 'remove') return 'removed'
  }

  // Fallback: classify by first verb
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

function parseCommitMessage(message: string): ChangelogItem {
  // Parse conventional commit format: type(scope)!: subject
  // e.g., "feat(desktop/chat) close chat tabs with middle click"
  const commitMatch = message.match(/^[a-z]+(\([^)]+\))?(!)?:\s*(.+)$/u)
  if (commitMatch) {
    const subject = commitMatch[4] ?? message
    const label = generateLabel(subject)
    return { label, description: subject }
  }
  // Fallback: use first phrase as label, full text as description
  const label = generateLabel(message)
  return { label, description: message }
}

function generateLabel(text: string): string {
  // Convert verb phrase to gerund for label: "close chat tabs" -> "Closing chat tabs"
  // "add new feature" -> "Adding new feature"
  // "fix bug in renderer" -> "Fixing bug in renderer"
  const firstVerb = text.match(/^[a-z]+/iu)?.[0].toLowerCase() ?? ''
  const rest = text.slice(firstVerb.length).trim()
  const baseVerb = verbToBaseForm(firstVerb)
  const gerund = verbToGerund(baseVerb)
  // If no recognized verb, just return the original text
  return gerund ? `${gerund} ${rest}`.trim() : text
}

function verbToBaseForm(verb: string): string {
  // Convert past tense / participles to base form
  const pastToBase: Record<string, string> = {
    added: 'add',
    browsed: 'browse',
    created: 'create',
    displayed: 'display',
    enabled: 'enable',
    exposed: 'expose',
    featured: 'feature',
    implemented: 'implement',
    introduced: 'introduce',
    made: 'make',
    provided: 'provide',
    shown: 'show',
    supported: 'support',
    avoided: 'avoid',
    cached: 'cache',
    improved: 'improve',
    laid: 'lay',
    optimised: 'optimise',
    optimized: 'optimize',
    parallelized: 'parallelize',
    reduced: 'reduce',
    refactored: 'refactor',
    reused: 'reuse',
    simplified: 'simplify',
    sped: 'speed',
    streamlined: 'streamline',
    updated: 'update',
    clamped: 'clamp',
    closed: 'close',
    corrected: 'correct',
    deduplicated: 'deduplicate',
    ensured: 'ensure',
    escaped: 'escape',
    fixed: 'fix',
    guarded: 'guard',
    handled: 'handle',
    hid: 'hide',
    kept: 'keep',
    preserved: 'preserve',
    prevented: 'prevent',
    repaired: 'repair',
    resolved: 'resolve',
    restored: 'restore',
    stabilized: 'stabilize',
    stopped: 'stop',
    deleted: 'delete',
    deprecated: 'deprecate',
    dropped: 'drop',
    removed: 'remove',
    documented: 'document',
  }
  if (pastToBase[verb]) return pastToBase[verb]
  // Only strip "ed" or "d" if not a double consonant ending (add, fix, etc.)
  if (/[aeiou][bcdfghjklmnpqrstvwxyz]{2}$/u.test(verb)) return verb
  return verb.replace(/(?:ed|d)$/u, '').replace(/ied$/u, 'y')
}

function verbToGerund(verb: string): string | undefined {
  const gerunds: Record<string, string> = {
    add: 'Adding',
    browse: 'Browsing',
    create: 'Creating',
    display: 'Displaying',
    enable: 'Enabling',
    expose: 'Exposing',
    feature: 'Featuring',
    implement: 'Implementing',
    introduce: 'Introducing',
    make: 'Making',
    new: 'Adding',
    provide: 'Providing',
    show: 'Showing',
    support: 'Supporting',
    avoid: 'Avoiding',
    cache: 'Caching',
    improve: 'Improving',
    lay: 'Laying out',
    optimise: 'Optimising',
    optimize: 'Optimizing',
    parallelize: 'Parallelizing',
    performance: 'Improving performance',
    perf: 'Improving performance',
    reduce: 'Reducing',
    refactor: 'Refactoring',
    reuse: 'Reusing',
    simplify: 'Simplifying',
    speed: 'Speeding up',
    streamline: 'Streamlining',
    update: 'Updating',
    tweak: 'Tweaking',
    chore: 'Updating',
    clamp: 'Clamping',
    close: 'Closing',
    correct: 'Correcting',
    deduplicate: 'Deduplicating',
    ensure: 'Ensuring',
    escape: 'Escaping',
    fix: 'Fixing',
    guard: 'Guarding',
    handle: 'Handling',
    hide: 'Hiding',
    keep: 'Keeping',
    preserve: 'Preserving',
    prevent: 'Preventing',
    repair: 'Repairing',
    resolve: 'Resolving',
    restore: 'Restoring',
    stabilize: 'Stabilizing',
    stop: 'Stopping',
    delete: 'Deleting',
    deprecate: 'Deprecating',
    drop: 'Dropping',
    remove: 'Removing',
    doc: 'Documenting',
    docs: 'Documenting',
    document: 'Documenting',
    documentation: 'Documenting',
    readme: 'Updating readme',
  }
  // Return undefined for unknown verbs instead of blindly appending "ing"
  return gerunds[verb]
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
