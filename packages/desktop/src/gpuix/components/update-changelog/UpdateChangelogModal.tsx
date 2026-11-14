import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { useRef } from 'react'

import { usePopupHotkeys, scrollPopupPage } from '../../hooks/use-popup-hotkeys'
import { Modal } from '../ui/Modal'
import { ChangelogActions } from './ChangelogActions'
import { ChangelogContent } from './ChangelogContent'
import { ChangelogHeader } from './ChangelogHeader'
import { MODAL_WIDTH } from './constants'
import type { ChangelogModalProps } from './types'

export function UpdateChangelogModal({
  version,
  releaseNotes,
  publishedAt,
  onClose,
}: ChangelogModalProps) {
  const renderer = useGpuixRequired()
  const viewportRef = useRef<PublicInstance | null>(null)

  const popupContextId = usePopupHotkeys('update-changelog', {
    delete: onClose,
    scrollPage: ([direction]) => scrollPopupPage(renderer, viewportRef, direction ?? 'down'),
  })

  return (
    <Modal hotkeyContextId={popupContextId} width={MODAL_WIDTH} onClose={onClose}>
      <div
        testId="update-changelog"
        tabIndex={-1}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <ChangelogHeader version={version} publishedAt={publishedAt} />
        <ChangelogContent releaseNotes={releaseNotes} viewportRef={viewportRef} />
        <ChangelogActions version={version} onClose={onClose} />
      </div>
    </Modal>
  )
}
