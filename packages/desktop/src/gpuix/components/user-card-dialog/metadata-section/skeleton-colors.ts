import { withAlpha, type Theme } from '@gpuix/theme'

export type SkeletonColors = {
  iconBg: string
  iconInner: string
  labelBar: string
  valueBar: string
}

export const getSkeletonColors = (theme: Theme): SkeletonColors => {
  return {
    iconBg: withAlpha(theme.text2, 0.15),
    iconInner: withAlpha(theme.text2, 0.3),
    labelBar: withAlpha(theme.text2, 0.15),
    valueBar: withAlpha(theme.text2, 0.1),
  }
}
