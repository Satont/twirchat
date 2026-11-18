import { chatMessageKey } from '@gpuix/chat-tools'
import { Text } from '@gpuix/components/ui/Text'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'
import {
  HISTORY_DISPLAY_LIMIT,
  historyRowVisible,
  historySourceNotice,
} from '@views/main/utils/history-display'
import { useCallback } from 'react'

import { GhostButton, SectionHeader, UserCardPanel } from '../UserCardUI'
import { HISTORY_STATE_MIN_HEIGHT } from './constants'
import { HistoryLoadOlderButton } from './HistoryLoadOlderButton'
import { HistoryMessageRow } from './HistoryMessageRow'
import { HistoryRetryButton } from './HistoryRetryButton'
import { HistoryState } from './HistoryState'
import { useChatHistory } from './hooks'
import type { UserChatHistoryProps } from './types'

interface VisibleRangeEvent {
  startIndex?: number
  endIndex?: number
}

export function UserChatHistoryContent({
  platform,
  platformUserId,
  channelId,
  username,
  onViewport,
}: UserChatHistoryProps) {
  const theme = useTheme()
  const { t, language } = useT()
  const {
    messages,
    loadingInitial,
    loadingOlder,
    error,
    history,
    visibleRange,
    canLoadOlder,
    loadInitial,
    loadOlder,
    updateVisibleRange,
  } = useChatHistory(platform, platformUserId, channelId, username)

  const sourceNotice = historySourceNotice(history)
  const showLoadOlder = canLoadOlder || loadingOlder

  const handleRefresh = useCallback(() => {
    runUiTask(loadInitial())
  }, [loadInitial])

  const handleLoadOlder = useCallback(() => {
    runUiTask(loadOlder())
  }, [loadOlder])

  const handleVisibleRange = useCallback(
    (event: VisibleRangeEvent) => {
      updateVisibleRange(event.startIndex ?? 0, event.endIndex ?? 0)
    },
    [updateVisibleRange],
  )

  return (
    <UserCardPanel style={{ minHeight: 0 }}>
      <SectionHeader
        icon="clock"
        title={t('userCard.history.title')}
        hint={
          channelId
            ? t('userCard.history.subtitleIn', { channel: channelId })
            : t('userCard.history.subtitle')
        }
        action={
          <GhostButton icon="refresh" disabled={loadingInitial} onClick={handleRefresh}>
            {t('common.refresh')}
          </GhostButton>
        }
      />

      {sourceNotice ? (
        <Text
          testId="user-card-history-source-status"
          style={{ fontSize: 11, color: theme.text2, marginBottom: 8 }}
        >
          {sourceNotice}
        </Text>
      ) : null}
      {error && messages.length ? (
        <Text style={{ fontSize: 12, color: theme.dangerText, marginBottom: 8 }}>{error}</Text>
      ) : null}
      {messages.length >= HISTORY_DISPLAY_LIMIT ? (
        <Text style={{ fontSize: 11, color: theme.text2, marginBottom: 8 }}>
          {t('userCard.history.limitNotice', {
            limit: HISTORY_DISPLAY_LIMIT.toLocaleString(language),
          })}
        </Text>
      ) : null}

      {loadingInitial && !messages.length ? (
        <HistoryState minHeight={HISTORY_STATE_MIN_HEIGHT}>
          <Text style={{ fontSize: 13, color: theme.text2 }}>{t('userCard.history.loading')}</Text>
        </HistoryState>
      ) : error && !messages.length ? (
        <HistoryState minHeight={HISTORY_STATE_MIN_HEIGHT} error>
          <Text style={{ fontSize: 13, color: theme.dangerText }}>{error}</Text>
          <HistoryRetryButton onClick={handleRefresh} />
        </HistoryState>
      ) : !messages.length ? (
        <HistoryState minHeight={HISTORY_STATE_MIN_HEIGHT}>
          <Text style={{ fontSize: 13, color: theme.text2 }}>{t('userCard.history.empty')}</Text>
        </HistoryState>
      ) : (
        <div
          style={{
            minHeight: 0,
            borderWidth: 1,
            borderColor: theme.hairline,
            borderRadius: 10,
            overflow: 'hidden',
            backgroundColor: theme.fill,
          }}
        >
          <virtual-list
            ref={onViewport}
            testId="user-card-history-viewport"
            alignment="bottom"
            estimatedItemHeight={44}
            onVisibleRange={handleVisibleRange}
            style={{ height: 260, scrollbarColor: theme.scrollbar, scrollbarWidth: 4 }}
          >
            {showLoadOlder ? (
              <HistoryLoadOlderButton
                key="load-older"
                canLoad={canLoadOlder}
                loading={loadingOlder}
                onClick={handleLoadOlder}
              />
            ) : null}
            {messages.map((message, index) => (
              <HistoryMessageRow
                key={chatMessageKey(message)}
                message={message}
                visible={historyRowVisible(
                  index,
                  messages.length,
                  visibleRange,
                  showLoadOlder ? 1 : 0,
                )}
              />
            ))}
          </virtual-list>
        </div>
      )}
    </UserCardPanel>
  )
}
