import { Icon } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'

import type { UserCardMetadataSectionProps } from './types'
import { InlineButton, MetadataState, SectionHeader, UserCardPanel } from './UserCardUI'
import { userCardWellColor } from './utils'

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
    <UserCardPanel>
      <SectionHeader
        icon="calendar"
        title={t('userCard.metadata.title')}
        hint={t('userCard.metadata.hint')}
        action={
          supportedByCard ? (
            <InlineButton
              icon="refresh"
              disabled={metadataLoading}
              onClick={() => reloadMetadata()}
            >
              {t('common.refresh')}
            </InlineButton>
          ) : undefined
        }
      />

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
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                flexGrow: 1,
                flexBasis: 150,
                minWidth: 0,
                padding: 14,
                borderWidth: 1,
                borderColor: theme.hairline,
                borderRadius: 12,
                backgroundColor: userCardWellColor(theme),
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.accent.tint12,
                  }}
                >
                  <Icon name={item.icon} size={13} color={theme.accent.primary} />
                </div>

                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: theme.text2,
                  }}
                >
                  {item.label.toUpperCase()}
                </Text>
              </div>
              <Text style={{ fontSize: 12, lineHeight: 18, color: theme.text }}>
                {item.value ?? ''}
              </Text>
            </div>
          ))}
        </div>
      ) : null}
    </UserCardPanel>
  )
}
