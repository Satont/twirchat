import { Icon, type IconName } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { useTheme } from '@gpuix/theme-context'

import { InlineButton, MetadataState } from './UserCardUI'

interface MetadataItem {
  label: string
  value: string | null
}

interface UserCardMetadataSectionProps {
  supportedByCard: boolean
  metadataLoading: boolean
  metadataError: string | null
  metadata: MetadataItem[] | null
  reloadMetadata: () => void
}

function getIconForLabel(label: string): IconName {
  switch (label) {
    case 'Account age':
      return 'calendar'
    case 'Follow age':
      return 'users'
    case 'Subscription duration':
      return 'gift'
    case 'Sub age':
      return 'clock'
    default:
      return 'calendar'
  }
}

export function UserCardMetadataSection({
  supportedByCard,
  metadataLoading,
  metadataError,
  metadata,
  reloadMetadata,
}: UserCardMetadataSectionProps) {
  const theme = useTheme()

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>Account metadata</Text>
          <Text style={{ fontSize: 13, color: theme.text2 }}>
            Fetched through the backend for this platform.
          </Text>
        </div>

        {supportedByCard ? (
          <InlineButton disabled={metadataLoading} onClick={() => reloadMetadata()}>
            Refresh
          </InlineButton>
        ) : null}
      </div>

      {!supportedByCard ? (
        <MetadataState>
          <Text style={{ fontSize: 13, color: theme.text2 }}>
            Metadata is not supported for this platform yet.
          </Text>
        </MetadataState>
      ) : metadataLoading ? (
        <MetadataState>
          <Text style={{ fontSize: 13, color: theme.text2 }}>Loading metadata…</Text>
        </MetadataState>
      ) : metadataError ? (
        <MetadataState error>
          <Text style={{ fontSize: 13, color: theme.dangerText }}>{metadataError}</Text>
          <InlineButton onClick={() => reloadMetadata()}>Retry</InlineButton>
        </MetadataState>
      ) : metadata ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          {metadata.map((item) => (
            <div
              key={item.label}
              style={{
                flexGrow: 1,
                flexBasis: 150,
                minWidth: 0,
                padding: 12,
                borderWidth: 1,
                borderColor: theme.hairline,
                borderRadius: 10,
                backgroundColor: theme.fill,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Icon name={getIconForLabel(item.label)} size={14} color={theme.text2} />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: theme.text2,
                  }}
                >
                  {item.label.toUpperCase()}
                </Text>
              </div>
              <Text style={{ fontSize: 13, color: theme.text, lineHeight: 19 }}>
                {item.value ?? ''}
              </Text>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
