import { useActionToast } from '@gpuix/components/action-toast'
import { Text } from '@gpuix/components/ui/Text'
import { useT } from '@gpuix/hooks/use-translation'
import { useTheme } from '@gpuix/theme-context'
import { memo, useCallback, useMemo } from 'react'

import type { UserCardMetadataSectionProps } from '../types'
import { InlineButton, MetadataState, SectionHeader, UserCardPanel } from '../UserCardUI'
import { MetadataGrid } from './MetadataGrid'
import { MetadataTile } from './MetadataTile'
import { getSkeletonColors } from './skeleton-colors'

const SKELETON_SIZE = 4

export const UserCardMetadataSection = memo(function UserCardMetadataSection({
  supportedByCard,
  metadataLoading,
  metadataError,
  metadata,
  reloadMetadata,
}: UserCardMetadataSectionProps) {
  const theme = useTheme()
  const { t } = useT()
  const { showToast } = useActionToast()

  const skeletonColors = useMemo(() => getSkeletonColors(theme), [theme])
  const handleReloadMetadata = useCallback(async () => {
    if (await reloadMetadata()) showToast(t('userCard.refresh.success'))
  }, [reloadMetadata, showToast, t])

  const render = () => {
    if (!supportedByCard) {
      return (
        <MetadataState>
          <Text style={{ fontSize: 13, color: theme.text2 }}>
            {t('userCard.metadata.unsupported')}
          </Text>
        </MetadataState>
      )
    }

    if (metadataLoading) {
      return (
        <MetadataGrid busy label={t('common.loading')}>
          {Array.from({ length: SKELETON_SIZE }, (_, i) => (
            <MetadataTile key={i} variant="skeleton" colors={skeletonColors} />
          ))}
        </MetadataGrid>
      )
    }

    if (metadataError) {
      return (
        <MetadataState error>
          <Text style={{ fontSize: 13, color: theme.dangerText }}>{metadataError}</Text>
          <InlineButton onClick={() => void handleReloadMetadata().catch(() => {})}>
            {t('common.retry')}
          </InlineButton>
        </MetadataState>
      )
    }

    if (metadata && metadata.length > 0) {
      const filteredMetadata = metadata.filter((el) => {
        const value = el.value?.trim()
        if (value === 'This user is not currently following this channel.') return false
        if (value === 'Twitch denied follow lookup for this broadcaster token.') return false
        if (
          value === 'Subscription status is only available for your authenticated Twitch channel.'
        )
          return false
        if (
          value ===
          'Twitch does not expose on-demand sub age through the available broadcaster API.'
        )
          return false
        return true
      })

      if (filteredMetadata.length > 0) {
        return (
          <MetadataGrid>
            {filteredMetadata.map((el, i) => (
              <MetadataTile
                key={i}
                variant="data"
                icon={el.icon}
                label={el.label}
                value={el.value}
              />
            ))}
          </MetadataGrid>
        )
      }
    }

    return null
  }

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
              onClick={() => void handleReloadMetadata().catch(() => {})}
            >
              {t('common.refresh')}
            </InlineButton>
          ) : undefined
        }
      />
      {render()}
    </UserCardPanel>
  )
})
