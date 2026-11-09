import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { UserChatHistoryCursor, UserChatHistoryPage } from '../../shared/rpc'
import {
  HISTORY_DISPLAY_LIMIT,
  formatHistoryTimestamp,
  historyRowVisible,
  mergeHistoryMessages,
  type HistoryVisibleRange,
} from '../../views/main/utils/history-display'
import { sanitizeDisplayText, truncateGraphemes } from '../../views/shared/utils/display-text'
import type { ChatHistoryQuery } from '../backend/chat-history'
import { useBackend } from '../backend/context'
import { chatMessageKey, formatChatTranscript } from '../chat-tools'
import { useT } from '../i18n'
import { useTheme } from '../theme-context'
import {
  HistoryButton as Button,
  HistoryChoices as Choices,
  HistoryField as Field,
  HistoryInput as Input,
} from './ChatHistoryFields'
import { ChatMessage } from './ChatMessage'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'

function historyDate(value: string, endOfDay: boolean): number {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return Date.parse(trimmed)
  const date = new Date(`${trimmed}T00:00:00`)
  const normalized = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  if (normalized !== trimmed) return Number.NaN
  if (endOfDay) date.setHours(23, 59, 59, 999)
  return date.getTime()
}

export function ChatHistoryPanel({
  channel,
  onClose,
}: {
  channel?: { platform: Platform; channelId: string; displayName?: string }
  onClose: () => void
}) {
  const backend = useBackend()
  const theme = useTheme()
  const { t, tPlural, language } = useT()
  const [platform, setPlatform] = useState<Platform | 'all'>(channel?.platform ?? 'all')
  const [channelId, setChannelId] = useState(channel?.channelId ?? '')
  const [author, setAuthor] = useState('')
  const [text, setText] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [messages, setMessages] = useState<NormalizedChatMessage[]>([])
  const [cursor, setCursor] = useState<UserChatHistoryCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPath, setExportPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [exportHistoryNotice, setExportHistoryNotice] = useState<string | null>(null)
  const [history, setHistory] = useState<UserChatHistoryPage['history']>()
  const [visibleRange, setVisibleRange] = useState<HistoryVisibleRange | null>(null)
  const generation = useRef(0)
  const requestSequence = useRef(0)
  const query = useMemo(() => {
    const result: ChatHistoryQuery = {
      platform: platform === 'all' ? undefined : platform,
      channelId: channelId.trim() || undefined,
      author: author.trim() || undefined,
      text: text || undefined,
      limit: 100,
    }
    if (since.trim()) result.since = historyDate(since, false)
    if (until.trim()) result.until = historyDate(until, true)
    return result
  }, [platform, channelId, author, text, since, until])
  const queryError = useMemo(() => {
    if (
      (query.since !== undefined && !Number.isFinite(query.since)) ||
      (query.until !== undefined && !Number.isFinite(query.until))
    )
      return t('chat.history.invalidDate')
    if (query.since !== undefined && query.until !== undefined && query.since > query.until)
      return t('chat.history.dateOrder')
    return null
    // Validation errors are translated: recompute them when the UI language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, t, language])
  const historyNotice = (pageHistory: UserChatHistoryPage['history']): string | null => {
    if (!pageHistory) return null
    if (pageHistory.error)
      return t('chat.history.source.error', {
        error: truncateGraphemes(sanitizeDisplayText(pageHistory.error), 240),
      })
    if (pageHistory.sources.length && pageHistory.sources.every((source) => source.status !== 'ok'))
      return t('chat.history.source.unavailable')
    if (pageHistory.partial) return t('chat.history.source.partial')
    return t('chat.history.source.covered')
  }
  const load = useCallback(
    async (
      append: boolean,
      token = generation.current,
      requestedCursor?: UserChatHistoryCursor,
    ) => {
      if (queryError) return
      const request = ++requestSequence.current
      setLoading(true)
      setError(null)
      setNotice('')
      try {
        const page = await backend.api.getChatHistory({
          ...query,
          cursor: append ? requestedCursor : undefined,
        })
        if (generation.current !== token || requestSequence.current !== request) return
        setMessages((current) =>
          append
            ? mergeHistoryMessages(current, page.messages)
            : mergeHistoryMessages(page.messages, current),
        )
        setHistory(page.history)
        setCursor(page.nextCursor)
        setHasMore(page.hasMore)
      } catch (failure) {
        if (generation.current === token && requestSequence.current === request)
          setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        if (generation.current === token && requestSequence.current === request) setLoading(false)
      }
    },
    [backend, query, queryError],
  )
  useEffect(() => {
    const token = ++generation.current
    setMessages([])
    setCursor(null)
    setHasMore(false)
    setExporting(false)
    setExportHistoryNotice(null)
    setHistory(undefined)
    setVisibleRange(null)
    if (queryError) {
      setLoading(false)
      return
    }
    const timer = setTimeout(() => void load(false, token), 200)
    return () => {
      clearTimeout(timer)
      generation.current += 1
    }
  }, [load, queryError])
  const copy = async () => {
    const token = generation.current
    try {
      await backend.api.copyText({ text: formatChatTranscript(messages) })
      if (generation.current === token) setNotice(t('chat.history.copied'))
    } catch (failure) {
      if (generation.current === token)
        setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const exportTranscript = async () => {
    const token = generation.current
    setExporting(true)
    setError(null)
    setNotice('')
    setExportHistoryNotice(null)
    try {
      const result = await backend.api.exportChatHistory({ query, path: exportPath.trim() })
      if (generation.current === token) {
        setNotice(tPlural('chat.history.exported', result.count, { path: result.path }))
        setExportHistoryNotice(historyNotice(result.history))
      }
    } catch (failure) {
      if (generation.current === token)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (generation.current === token) setExporting(false)
    }
  }
  const sourceNotice = historyNotice(history)
  return (
    <Modal width={820} onClose={onClose}>
      <div
        testId="chat-history-panel"
        onKeyDown={(event) => {
          if (event.key === 'escape') {
            event.preventDefault()
            onClose()
          }
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 20,
          minHeight: 0,
          overflowY: 'scroll',
          scrollbarWidth: 4,
          scrollbarColor: theme.scrollbar,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: 700, color: theme.text }}>
            {channel?.displayName
              ? t('chat.history.titleChannel', {
                  name: sanitizeDisplayText(channel.displayName),
                })
              : t('chat.history.title')}
          </Text>
          <Button label={t('common.close')} onClick={onClose} />
        </div>
        <Choices
          value={platform}
          options={[
            { value: 'all', label: t('chat.history.allPlatforms') },
            { value: 'twitch', label: 'Twitch' },
            { value: 'kick', label: 'Kick' },
            { value: 'youtube', label: 'YouTube' },
          ]}
          onChange={setPlatform}
        />
        <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Field label={t('chat.history.channelLabel')}>
            <Input
              testId="history-channel"
              value={channelId}
              onChange={setChannelId}
              placeholder={t('chat.history.allChannels')}
            />
          </Field>
          <Field label={t('chat.history.authorLabel')}>
            <Input
              testId="history-author"
              value={author}
              onChange={setAuthor}
              placeholder={t('chat.history.allAuthors')}
            />
          </Field>
        </div>
        <Field label={t('chat.history.messageContains')}>
          <Input
            testId="history-search"
            value={text}
            onChange={setText}
            placeholder={t('chat.history.searchPlaceholder')}
          />
        </Field>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Field label={t('chat.history.fromLabel')}>
            <Input testId="history-since" value={since} onChange={setSince} />
          </Field>
          <Field label={t('chat.history.untilLabel')}>
            <Input testId="history-until" value={until} onChange={setUntil} />
          </Field>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Button
            label={loading ? t('common.loading') : t('common.refresh')}
            disabled={loading || !!queryError}
            onClick={() => void load(false)}
          />
          <Button
            label={t('chat.history.loadOlder')}
            disabled={loading || !hasMore || messages.length >= HISTORY_DISPLAY_LIMIT}
            onClick={() => void load(true, generation.current, cursor ?? undefined)}
          />
          <Button
            label={t('chat.history.copyLoaded')}
            disabled={!messages.length}
            onClick={() => void copy()}
          />
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            {tPlural('chat.history.loaded', messages.length)}
          </Text>
        </div>
        <Text style={{ fontSize: 10, color: theme.text2 }}>{t('chat.history.description')}</Text>
        {sourceNotice ? (
          <Text testId="history-source-status" style={{ fontSize: 11, color: theme.text2 }}>
            {sourceNotice}
          </Text>
        ) : null}
        <div
          style={{
            height: 240,
            minHeight: 100,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 6,
          }}
        >
          {messages.length ? (
            <virtual-list
              alignment="bottom"
              estimatedItemHeight={44}
              onVisibleRange={(event) => {
                const start = event.startIndex ?? 0
                const end = event.endIndex ?? 0
                setVisibleRange((current) =>
                  current?.start === start && current.end === end ? current : { start, end },
                )
              }}
              style={{ height: '100%', scrollbarWidth: 4, scrollbarColor: theme.scrollbar }}
            >
              {messages.map((message, index) => (
                <HistorySearchMessageRow
                  key={chatMessageKey(message)}
                  message={message}
                  visible={historyRowVisible(index, messages.length, visibleRange)}
                />
              ))}
            </virtual-list>
          ) : (
            <Text style={{ padding: 12, fontSize: 12, color: theme.text2 }}>
              {loading ? t('chat.history.loading') : t('chat.history.noMatches')}
            </Text>
          )}
        </div>
        <Field label={t('chat.history.exportLabel')}>
          <Input
            testId="history-export-path"
            value={exportPath}
            onChange={setExportPath}
            placeholder="/home/you/chat-transcript.txt"
          />
        </Field>
        <Button
          testId="history-export"
          label={exporting ? t('chat.history.exporting') : t('chat.history.exportButton')}
          disabled={exporting || !!queryError || !exportPath.trim()}
          onClick={() => void exportTranscript()}
        />
        {queryError || error ? (
          <Text testId="history-error" style={{ fontSize: 12, color: theme.dangerText }}>
            {queryError ?? error}
          </Text>
        ) : null}
        {notice ? <Text style={{ fontSize: 12, color: theme.successText }}>{notice}</Text> : null}
        {exportHistoryNotice ? (
          <Text testId="history-export-source-status" style={{ fontSize: 11, color: theme.text2 }}>
            {exportHistoryNotice}
          </Text>
        ) : null}
      </div>
    </Modal>
  )
}

const HistorySearchMessageRow = memo(function HistorySearchMessageRow({
  message,
  visible,
}: {
  message: NormalizedChatMessage
  visible: boolean
}) {
  const theme = useTheme()
  return (
    <div
      testId={`history-search-message-${chatMessageKey(message)}`}
      style={{
        width: '100%',
        padding: 8,
        borderBottomWidth: 1,
        borderColor: theme.border,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <Text style={{ fontSize: 10, color: theme.text2 }}>
        {`${formatHistoryTimestamp(message.timestamp)} · ${message.platform}/${sanitizeDisplayText(message.channelId)}`}
      </Text>
      <ChatMessage
        message={message}
        channelSlug={message.channelId}
        chatTheme="compact"
        fontSize={12}
        showTimestamp={false}
        showAvatar={false}
        visible={visible}
      />
    </div>
  )
})
