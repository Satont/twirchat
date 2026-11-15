import type { PublicInstance } from '@gpuix/react'
import type { RefObject } from 'react'

import { parseReleaseNotes } from '../../release-notes'
import { ChangelogSection } from './ChangelogSection'
import { SECTION_GAP, CONTENT_PADDING } from './constants'

interface ChangelogContentProps {
  releaseNotes: string
  viewportRef: RefObject<PublicInstance | null>
}

export function ChangelogContent({ releaseNotes, viewportRef }: ChangelogContentProps) {
  const sections = parseReleaseNotes(releaseNotes)

  return (
    <div
      ref={viewportRef}
      testId="update-changelog-content"
      style={{
        flexGrow: 1,
        flexShrink: 1,
        minHeight: 0,
        padding: CONTENT_PADDING,
        display: 'flex',
        flexDirection: 'column',
        gap: SECTION_GAP,
        overflowY: 'scroll',
        overflowX: 'hidden',
        scrollbarWidth: 0,
        scrollbarColor: 'transparent transparent',
      }}
    >
      {sections.map((section) => (
        <ChangelogSection key={section.kind} kind={section.kind} items={section.items} />
      ))}
    </div>
  )
}
