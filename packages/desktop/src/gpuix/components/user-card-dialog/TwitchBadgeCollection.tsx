import { Text } from '@gpuix/components/ui/Text'
import { useTwitchUserBadges } from '@gpuix/hooks/user-card-dialog/use-twitch-user-badges'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'
import { memo } from 'react'

import { Badge } from './Badge'
import { InlineButton, MetadataState, SectionHeader, UserCardPanel } from './UserCardUI'

interface TwitchBadgeCollectionProps {
  username: string
  channelSlug?: string
  channelId?: string
}

export const TwitchBadgeCollection = memo(function TwitchBadgeCollection({
  username,
  channelSlug,
  channelId,
}: TwitchBadgeCollectionProps) {
  const { t } = useT()
  const theme = useTheme()
  const { state, retry } = useTwitchUserBadges({ username, channelSlug, channelId })

  return (
    <UserCardPanel>
      <SectionHeader icon="twitch" title={t('userCard.badges.title')} />
      {state.kind === 'loaded' && state.badges.length > 0 ? (
        <div
          testId="twitch-badge-collection-grid"
          style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
        >
          {state.badges.map((badge) => (
            <Badge key={badge.id} badge={badge} size={24} showTooltip />
          ))}
        </div>
      ) : state.kind === 'error' ? (
        <MetadataState error>
          <Text style={{ color: theme.dangerText, fontSize: 13 }}>
            {t('userCard.badges.unavailable')}
          </Text>
          <InlineButton onClick={retry}>{t('common.retry')}</InlineButton>
        </MetadataState>
      ) : (
        <Text style={{ color: theme.text2, fontSize: 13 }}>
          {t(state.kind === 'loading' ? 'userCard.badges.loading' : 'userCard.badges.empty')}
        </Text>
      )}
    </UserCardPanel>
  )
})
