import type { NormalizedChatMessage, TimestampFormat } from '@twirchat/shared/types'
import type { ReactNode } from 'react'

import { useT } from '../hooks/use-translation'
import { twitchActivitiesStore } from '../state/twitch-activities'
import { useStoreSelector } from '../state/use-store'
import { TwitchChatNotice } from './TwitchChatNotice'

interface TwitchRewardNoticeProps {
  message: NormalizedChatMessage
  rewardId: string
  channelSlug?: string
  fontSize: number
  authorName?: string
  time?: string
  chatTheme?: 'modern' | 'compact'
  timestampFormat?: TimestampFormat
  sourceLabel?: ReactNode
  children?: ReactNode
}

export function TwitchRewardNotice({
  message,
  rewardId,
  channelSlug,
  fontSize,
  authorName,
  time,
  chatTheme,
  timestampFormat,
  sourceLabel,
  children,
}: TwitchRewardNoticeProps) {
  const { language, tPlural } = useT()
  const title = message.metadata?.rewardTitle
  const cost = message.metadata?.rewardCost
  const sourceId = message.metadata?.sharedChat?.sourceChannelId
  const channel = (channelSlug ?? message.channelId).toLowerCase()
  const reward = useStoreSelector(twitchActivitiesStore, (activities) => {
    if (title && cost !== undefined) return undefined
    if (sourceId) {
      for (const { snapshot } of activities.values()) {
        if (snapshot?.channelId === sourceId)
          return snapshot.rewards.find((entry) => entry.id === rewardId)
      }
      return undefined
    }
    return activities.get(channel)?.snapshot?.rewards.find((entry) => entry.id === rewardId)
  })
  const points = cost ?? reward?.cost
  const summary = [
    authorName,
    title || reward?.title,
    points === undefined
      ? undefined
      : tPlural('activities.rewards.points', points, { count: points.toLocaleString(language) }),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <TwitchChatNotice
      id={message.id}
      kind="reward_redemption"
      fontSize={fontSize}
      summary={summary}
      time={time}
      chatTheme={chatTheme}
      timestampFormat={timestampFormat}
      sourceLabel={sourceLabel}
    >
      {children}
    </TwitchChatNotice>
  )
}
