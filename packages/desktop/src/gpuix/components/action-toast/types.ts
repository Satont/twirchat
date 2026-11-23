import type { Props, PublicInstance } from '@gpuix/react'

export type ActionClickEvent = Parameters<NonNullable<Props['onClick']>>[0]

export interface ActionToastState {
  message: string
  left: number
  top: number
}

export interface ActionToastProps {
  layer: PublicInstance | null
  toast: ActionToastState | null
}
