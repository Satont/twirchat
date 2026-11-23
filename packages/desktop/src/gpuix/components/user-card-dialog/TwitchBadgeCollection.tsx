import { ActionButton } from '@gpuix/components/ui/Form'
import { Text } from '@gpuix/components/ui/Text'
import { useTwitchUserBadges } from '@gpuix/hooks/user-card-dialog/use-twitch-user-badges'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'
import { memo } from 'react'

import { Badge } from './Badge'
import { MetadataState, SectionHeader, UserCardPanel } from './UserCardUI'

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

  const render = () => {
    if (state.kind === 'loaded' && state.badges.length > 0) {
      return (
        <div
          testId="twitch-badge-collection-grid"
          style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
        >
          {state.badges.map((badge) => (
            <Badge key={badge.id} badge={badge} size={24} showTooltip />
          ))}
        </div>
      )
    }
    if (state.kind === 'error') {
      return (
        <MetadataState error>
          <Text style={{ color: theme.dangerText, fontSize: 13 }}>
            {t('userCard.badges.unavailable')}
          </Text>
          <ActionButton onClick={retry}>{t('common.retry')}</ActionButton>
        </MetadataState>
      )
    }
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          fontSize: 14,
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 12,
          paddingRight: 12,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
          backgroundColor: theme.bg,
          color: theme.text2,
        }}
      >
        {state.kind === 'loading' ? t('common.loading') : t('userCard.badges.empty')}
      </div>
    )
  }

  return (
    <UserCardPanel>
      <SectionHeader icon="twitch" title={t('userCard.badges.title')} />
      {render()}
    </UserCardPanel>
  )
})
