import type { MessageKey } from '../../i18n'
import type { IconName } from '../../icons'
import type { ReleaseNoteKind } from '../../release-notes'

export interface ChangelogModalProps {
  version: string
  releaseNotes: string
  publishedAt: string
  onClose: () => void
}

export interface ChangelogItem {
  label: string
  description: string
}

export interface ChangelogSectionProps {
  kind: ReleaseNoteKind
  items: ChangelogItem[]
}

export interface ChangelogItemProps {
  item: ChangelogItem
  index: number
}

export interface ChangelogHeaderProps {
  version: string
  releaseDate: string | null
}

export interface ChangelogActionsProps {
  version: string
  onClose: () => void
  onViewGitHub: () => void
}

export const kindLabelKeys: Record<ReleaseNoteKind, MessageKey> = {
  new: 'app.changelog.kind.new',
  improved: 'app.changelog.kind.improved',
  fixed: 'app.changelog.kind.fixed',
  removed: 'app.changelog.kind.removed',
  docs: 'app.changelog.kind.docs',
  other: 'app.changelog.kind.other',
}

export const badgeLabelKeys: Record<ReleaseNoteKind, MessageKey> = {
  new: 'app.changelog.badge.new',
  improved: 'app.changelog.badge.improved',
  fixed: 'app.changelog.badge.fixed',
  removed: 'app.changelog.badge.removed',
  docs: 'app.changelog.badge.docs',
  other: 'app.changelog.badge.other',
}

export const kindIcons: Record<ReleaseNoteKind, IconName> = {
  new: 'sparkle',
  improved: 'sliders',
  fixed: 'check',
  removed: 'trash',
  docs: 'pencil',
  other: 'star',
}
