import { Icon, type IconName } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'

import { InlineButton, MetadataState } from './UserCardUI'

interface MetadataItem {
  label: string
  value: string | null
  icon: IconName
}

interface UserCardMetadataSectionProps {
  supportedByCard: boolean
  metadataLoading: boolean
  metadataError: string | null
  metadata: MetadataItem[] | null
  reloadMetadata: () => void
}

export function UserCardMetadataSection({
  supportedByCard,
  metadataLoading,
  metadataError,
  metadata,
  reloadMetadata,
}: UserCardMetadataSectionProps) {
  const theme = useTheme()
  const { t } = useT()

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
          <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
            {t('userCard.metadata.title')}
          </Text>
          <Text style={{ fontSize: 13, color: theme.text2 }}>{t('userCard.metadata.hint')}</Text>
        </div>

        {supportedByCard ? (
          <InlineButton disabled={metadataLoading} onClick={() => reloadMetadata()}>
            {t('common.refresh')}
          </InlineButton>
        ) : null}
      </div>

      {!supportedByCard ? (
        <MetadataState>
          <Text style={{ fontSize: 13, color: theme.text2 }}>
            {t('userCard.metadata.unsupported')}
          </Text>
        </MetadataState>
      ) : metadataLoading ? (
        <MetadataState>
          <Text style={{ fontSize: 13, color: theme.text2 }}>{t('userCard.metadata.loading')}</Text>
        </MetadataState>
      ) : metadataError ? (
        <MetadataState error>
          <Text style={{ fontSize: 13, color: theme.dangerText }}>{metadataError}</Text>
          <InlineButton onClick={() => reloadMetadata()}>{t('common.retry')}</InlineButton>
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
                <Icon name={item.icon} size={14} color={theme.text2} />
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
