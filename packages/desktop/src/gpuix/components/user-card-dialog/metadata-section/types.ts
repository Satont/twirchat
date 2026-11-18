import type { ReactNode } from 'react'

import type { MetadataItem } from '../types'
import type { SkeletonColors } from './skeleton-colors'

export type MetadataTileDataProps = MetadataItem & {
  variant: 'data'
}

export type MetadataTileSkeletonProps = {
  variant: 'skeleton'
  colors: SkeletonColors
}

export type MetadataTileProps = MetadataTileDataProps | MetadataTileSkeletonProps

export type MetadataGridProps = {
  children?: ReactNode
  busy?: boolean
  label?: string
}
