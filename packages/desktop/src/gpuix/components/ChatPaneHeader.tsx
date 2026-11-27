import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import { useState, type ReactNode } from 'react'

import { useT } from '../i18n'
import { useTheme } from '../theme-context'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

/** Live stream facts for a channel pane, Chatterino style. */
export interface ChatPaneStreamInfo {
  isLive: boolean
  viewerCount?: number
  categoryName?: string
  title?: string
}

/** Watchers summed over the pane's sources, shown when it has more than one channel. */
export interface ChatPaneViewers {
  count: number
  liveCount: number
}

export interface ChatPaneHeaderProps {
  leading?: ReactNode
  stream?: ChatPaneStreamInfo
  hideViewerCount?: boolean
  /** Short channel names for combined panes; rendered as plain text, no badges. */
  names?: readonly string[]
  /** Combined live viewers; undefined when no source of the pane streams now. */
  viewers?: ChatPaneViewers
  /** Extra state markers (read-only, pane account) kept next to the actions. */
  meta?: ReactNode
  onEditSources?: () => void
  /** Action buttons on the right, laid out by the caller. */
  children?: ReactNode
  /** Highlight wash used when the pane receives an emphasised mention. */
  background?: string
}

function formatViewers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
  return String(count)
}

function MetaSeparator() {
  const theme = useTheme()
  return (
    <Text style={{ fontSize: 11, color: theme.text2, opacity: 0.6, flexShrink: 0 }}>{'·'}</Text>
  )
}

export function ChatPaneHeader({
  leading,
  stream,
  hideViewerCount,
  names,
  viewers,
  meta,
  onEditSources,
  children,
  background,
}: ChatPaneHeaderProps) {
  const theme = useTheme()
  const { t } = useT()
  const showNames = names !== undefined && names.length > 0

  return (
    <div
      testId="chat-header"
      style={{
        backgroundColor: background,
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 10,
        paddingRight: 8,
        borderBottomWidth: 1,
        borderColor: theme.border,
        flexShrink: 0,
        minHeight: 34,
        userSelect: 'none',
      }}
    >
      {leading}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
        }}
      >
        {stream ? (
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              flexShrink: 0,
              backgroundColor: stream.isLive ? '#22c55e' : theme.text2,
            }}
          />
        ) : null}
        {stream && !stream.isLive ? (
          <Text style={{ fontSize: 11, color: theme.text2, flexShrink: 0 }}>
            {t('chat.header.offline')}
          </Text>
        ) : null}

        {stream && stream.isLive && stream.viewerCount !== undefined && !hideViewerCount ? (
          <>
            <MetaSeparator />
            <Text
              testId="chat-header-viewers"
              style={{ fontSize: 11, fontWeight: 600, color: '#22c55e', flexShrink: 0 }}
            >
              {formatViewers(stream.viewerCount)}
            </Text>
          </>
        ) : null}

        {stream && stream.isLive && stream.categoryName ? (
          <>
            <MetaSeparator />
            <Text
              testId="chat-header-category"
              style={{
                fontSize: 11,
                color: theme.text2,
                flexShrink: 1,
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {stream.categoryName}
            </Text>
          </>
        ) : null}

        {stream && stream.isLive && stream.title ? (
          <>
            <MetaSeparator />
            <Text
              testId="chat-header-stream-title"
              style={{
                fontSize: 11,
                color: theme.text2,
                flexShrink: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {stream.title}
            </Text>
          </>
        ) : null}

        {showNames ? (
          <Text
            testId="chat-header-channels"
            style={{
              fontSize: 11,
              color: theme.text2,
              flexShrink: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {names.join(', ')}
          </Text>
        ) : null}

        {viewers ? (
          <>
            {showNames ? <MetaSeparator /> : null}
            <div
              testId="chat-header-viewers-total"
              aria-label={t('chat.header.viewersTotal', {
                count: viewers.count.toLocaleString(),
                live: viewers.liveCount,
              })}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: '#22c55e',
                }}
              />
              {!hideViewerCount ? (
                <Text style={{ fontSize: 11, fontWeight: 600, color: '#22c55e', flexShrink: 0 }}>
                  {formatViewers(viewers.count)}
                </Text>
              ) : null}
              <Text style={{ fontSize: 11, color: theme.text2, flexShrink: 0 }}>
                {t('chat.header.liveChannels', { count: viewers.liveCount })}
              </Text>
            </div>
          </>
        ) : null}

        {meta}

        {onEditSources ? (
          <HeaderButton
            testId="chat-feed-manage"
            title={t('chat.feed.editSources')}
            onClick={onEditSources}
          >
            <Icon name="settings" size={13} color={theme.text2} />
          </HeaderButton>
        ) : null}
      </div>

      {children ? (
        <div
          testId="chat-header-actions"
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 2,
            flexShrink: 0,
            maxWidth: '100%',
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function HeaderButton({
  children,
  onClick,
  testId,
  title,
  active,
}: {
  children: ReactNode
  onClick?: () => void
  testId?: string
  title?: string
  active?: boolean
}) {
  const theme = useTheme()
  const [hovered, setHovered] = useState(false)
  const button = (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 22,
        height: 22,
        flexShrink: 0,
        borderRadius: 4,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hovered || active ? theme.fillHover : undefined,
      }}
    >
      {children}
    </div>
  )
  return title ? (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        style={{ backgroundColor: theme.popover, color: theme.text, padding: 7, borderRadius: 5 }}
      >
        <Text style={{ fontSize: 12, color: theme.text }}>{title}</Text>
      </TooltipContent>
    </Tooltip>
  ) : (
    button
  )
}
