import { useTheme } from '@gpuix/theme-context'

export function ProfileDescription({ description }: { description?: string }) {
  const theme = useTheme()
  if (!description) return null
  return (
    <div style={{ fontSize: 13, lineHeight: 19, color: theme.text, paddingLeft: 4 }}>
      {description}
    </div>
  )
}
