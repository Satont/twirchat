import { DEFAULT_SETTINGS, type TimestampFormat } from '@twirchat/shared/types'
import { memo } from 'react'

import {
  chunkGraphemes,
  sanitizeDisplayText,
  truncateGraphemes,
} from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT, type MessageKey } from '../i18n'
import { decideTwitchAutoModMessage, type TwitchAutoModRow } from '../state/twitch-automod'
import { semantic, withAlpha } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { formatMessageTime, timestampSize } from '../timestamp-format'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

interface TwitchAutoModChatRowProps {
  row: TwitchAutoModRow
  hideBlockedTerms?: boolean
  fontSize?: number
  showTimestamp?: boolean
  timestampFormat?: TimestampFormat
  chatTheme?: typeof DEFAULT_SETTINGS.chatTheme
}

const wrappingRow = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  minWidth: 0,
}

const resolutionText = {
  approved: ['chatMessages.autoMod.allowed', 'chatMessages.autoMod.allowedBy'],
  denied: ['chatMessages.autoMod.denied', 'chatMessages.autoMod.deniedBy'],
  expired: ['chatMessages.autoMod.expired', 'chatMessages.autoMod.expired'],
} satisfies Record<string, [MessageKey, MessageKey]>

/** Words become flex items so long text wraps inside the chat row's width. */
function wrapWords(text: string, style: object) {
  let position = 0
  return (text.match(/\S+ ?/g) ?? []).flatMap((word) =>
    [...chunkGraphemes(word, 28)].map((part) => {
      const key = position
      position += part.length
      return (
        <text key={key} style={style}>
          {part}
        </text>
      )
    }),
  )
}

export const TwitchAutoModChatRow = memo(function TwitchAutoModChatRow({
  row,
  hideBlockedTerms,
  fontSize = DEFAULT_SETTINGS.fontSize,
  showTimestamp,
  timestampFormat,
  chatTheme = DEFAULT_SETTINGS.chatTheme,
}: TwitchAutoModChatRowProps) {
  const { api } = useBackend()
  const theme = useTheme()
  const fontFamily = useFont()
  const { t } = useT()
  const { hold } = row
  const compact = chatTheme === 'compact'
  const style = {
    fontSize,
    fontFamily,
    color: theme.text,
    lineHeight: Math.round(fontSize * 1.45),
  }
  const small = { ...style, fontSize: timestampSize(fontSize) }
  const reason = hold.blockedTerm
    ? t('chatMessages.autoMod.reason.blockedTerm')
    : hold.category
      ? t('chatMessages.autoMod.reason.category', { category: hold.category.replaceAll('_', ' ') })
      : t('chatMessages.autoMod.reason.generic')
  const accent =
    row.state === 'resolved'
      ? row.resolution === 'approved'
        ? semantic.success
        : row.resolution === 'denied'
          ? semantic.error
          : theme.text2
      : semantic.warning
  const decide = (decision: 'approve' | 'deny') =>
    runUiTask(
      decideTwitchAutoModMessage(api, {
        channelSlug: hold.channelSlug,
        messageId: hold.messageId,
        decision,
      }),
    )

  const text =
    hideBlockedTerms && hold.blockedTerm
      ? t('chatMessages.autoMod.hiddenBlockedTerm')
      : sanitizeDisplayText(hold.text)
  const body = wrapWords(text, style)

  let headline = reason
  let status = null
  if (row.state === 'pending')
    status = (
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text
          testId={`twitch-automod-approve-${hold.messageId}`}
          onClick={() => decide('approve')}
          style={{
            ...small,
            fontWeight: 700,
            color: theme.link,
            cursor: 'pointer',
            hover: { opacity: 0.8 },
          }}
        >
          {t('chatMessages.autoMod.approve')}
        </Text>
        <Text style={{ ...small, color: theme.text2 }}>•</Text>
        <Text
          testId={`twitch-automod-deny-${hold.messageId}`}
          onClick={() => decide('deny')}
          style={{
            ...small,
            fontWeight: 700,
            color: theme.link,
            cursor: 'pointer',
            hover: { opacity: 0.8 },
          }}
        >
          {t('chatMessages.autoMod.deny')}
        </Text>
      </div>
    )
  else if (row.state === 'deciding')
    status = (
      <Text style={{ ...small, color: theme.text2 }}>{t('chatMessages.autoMod.submitting')}</Text>
    )
  else {
    const [plain, withName] = resolutionText[row.resolution]
    headline = row.moderatorName
      ? t(withName, { name: sanitizeDisplayText(row.moderatorName) })
      : t(plain)
  }

  return (
    <div
      testId={`twitch-automod-${hold.messageId}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        minWidth: 0,
        gap: 4,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: compact ? 4 : 6,
        paddingBottom: compact ? 4 : 6,
        borderTopWidth: 1,
        borderColor: theme.divider,
        backgroundColor:
          row.state === 'resolved'
            ? undefined
            : withAlpha(semantic.warning, theme.isLight ? 0.07 : 0.06),
      }}
    >
      <div style={{ ...wrappingRow, justifyContent: 'space-between', columnGap: 12, rowGap: 2 }}>
        <div style={{ ...wrappingRow, flexGrow: 1, flexBasis: 0 }}>
          <Icon name="alert" size={Math.round(fontSize * 0.95)} color={theme.warningText} />
          <Text style={{ ...style, fontWeight: 700, marginLeft: 6, marginRight: 4 }}>AutoMod:</Text>
          {wrapWords(
            headline,
            row.state === 'resolved'
              ? { ...style, fontWeight: 600, color: accent }
              : { ...style, color: theme.text2 },
          )}
        </div>
        {status}
      </div>
      <div
        style={{
          ...wrappingRow,
          marginLeft: 4,
          paddingLeft: 8,
          borderLeftWidth: 2,
          borderColor: withAlpha(accent, 0.8),
          opacity: row.state === 'resolved' ? 0.65 : 1,
        }}
      >
        {showTimestamp ? (
          <Text style={{ ...small, color: theme.text2, marginRight: 6 }}>
            {formatMessageTime(new Date(hold.timestamp), timestampFormat)}
          </Text>
        ) : null}
        <Text style={{ ...style, fontWeight: 700, marginRight: 4 }}>
          {`${sanitizeDisplayText(hold.displayName)}:`}
        </Text>
        {body}
      </div>
      {row.state === 'pending' && row.error ? (
        <Text style={{ ...small, color: theme.dangerText }}>
          {truncateGraphemes(sanitizeDisplayText(row.error), 180)}
        </Text>
      ) : null}
    </div>
  )
})
