import { useBackend } from '@gpuix/backend/context'
import { BadgeTooltip } from '@gpuix/components/ui/BadgeTooltip'
import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { Text } from '@gpuix/components/ui/Text'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'
import type { Badge } from '@twirchat/shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'

import { InlineButton, MetadataState, SectionHeader, UserCardPanel } from './UserCardUI'

interface TwitchBadgeCollectionProps {
  username: string
  channelSlug?: string
  channelId?: string
}

type CollectionState = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; badges: Badge[] }

export function TwitchBadgeCollection({
  username,
  channelSlug,
  channelId,
}: TwitchBadgeCollectionProps) {
  const { api } = useBackend()
  const { t } = useT()
  const theme = useTheme()
  const pending = useRef<AbortController | null>(null)
  const [state, setState] = useState<CollectionState>({ kind: 'loading' })

  const loadBadges = useCallback(() => {
    pending.current?.abort()
    const request = new AbortController()
    pending.current = request
    api
      .getTwitchUserBadges({ username, channelSlug, channelId, signal: request.signal })
      .then((badges): CollectionState => ({ kind: 'loaded', badges }))
      .then((result) => {
        if (!request.signal.aborted) setState(result)
        return result
      })
      .catch(() => {
        if (!request.signal.aborted) setState({ kind: 'error' })
      })
  }, [api, username, channelSlug, channelId])

  useEffect(() => {
    loadBadges()
    return () => pending.current?.abort()
  }, [loadBadges])

  return (
    <UserCardPanel>
      <SectionHeader icon="twitch" title={t('userCard.badges.title')} />
      {state.kind === 'loaded' && state.badges.length > 0 ? (
        <div
          testId="twitch-badge-collection-grid"
          style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
        >
          {state.badges.map((badge) => (
            <BadgeTooltip key={badge.id} badge={badge} platform="twitch">
              <RemoteImage
                url={badge.imageUrl}
                style={{ width: 24, height: 24, pointerEvents: 'none' }}
              />
            </BadgeTooltip>
          ))}
        </div>
      ) : state.kind === 'error' ? (
        <MetadataState error>
          <Text style={{ color: theme.dangerText, fontSize: 13 }}>
            {t('userCard.badges.unavailable')}
          </Text>
          <InlineButton
            onClick={() => {
              setState({ kind: 'loading' })
              loadBadges()
            }}
          >
            {t('common.retry')}
          </InlineButton>
        </MetadataState>
      ) : (
        <Text style={{ color: theme.text2, fontSize: 13 }}>
          {t(state.kind === 'loading' ? 'userCard.badges.loading' : 'userCard.badges.empty')}
        </Text>
      )}
    </UserCardPanel>
  )
}
