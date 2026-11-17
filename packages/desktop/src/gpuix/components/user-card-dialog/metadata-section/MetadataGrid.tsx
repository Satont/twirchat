import type { MetadataGridProps } from './types'

export function MetadataGrid({ busy, label, children }: MetadataGridProps) {
  return (
    <div
      role={busy ? 'status' : undefined}
      aria-label={busy ? label : undefined}
      aria-busy={busy || undefined}
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
      }}
    >
      {children}
    </div>
  )
}
