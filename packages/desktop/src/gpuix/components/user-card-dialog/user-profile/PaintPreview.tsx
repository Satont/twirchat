import { memo } from 'react'

import type { PaintPreviewProps } from './types'

export const PaintPreview = memo(function PaintPreview({ paintImage }: PaintPreviewProps) {
  if (!paintImage) return null
  return (
    <img src={paintImage.path} style={{ width: paintImage.width, height: paintImage.height }} />
  )
})
