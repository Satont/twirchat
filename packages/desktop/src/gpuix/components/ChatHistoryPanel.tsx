import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { UserChatHistoryCursor } from '../../shared/rpc'
import { sanitizeDisplayText, truncateGraphemes } from '../../views/shared/utils/display-text'
import type { ChatHistoryQuery } from '../backend/chat-history'
import { useBackend } from '../backend/context'
import { formatChatTranscript } from '../chat-tools'
import { useTheme } from '../theme-context'
import {
  HistoryButton as Button,
  HistoryChoices as Choices,
  HistoryField as Field,
  HistoryInput as Input,
} from './ChatHistoryFields'
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
  const generation = useRef(0)
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
      return 'Enter dates as YYYY-MM-DD or a full date and time.'
    if (query.since !== undefined && query.until !== undefined && query.since > query.until)
      return 'The start date must be before the end date.'
    return null
  }, [query])
  const load = useCallback(
    async (
      append: boolean,
      token = generation.current,
      requestedCursor?: UserChatHistoryCursor,
    ) => {
      if (queryError) return
      setLoading(true)
      setError(null)
      setNotice('')
      try {
        const page = await backend.api.getChatHistory({
          ...query,
          cursor: append ? requestedCursor : undefined,
        })
        if (generation.current !== token) return
        setMessages((current) =>
          append ? [...page.messages, ...current].slice(0, 2000) : page.messages,
        )
        setCursor(page.nextCursor)
        setHasMore(page.hasMore)
      } catch (failure) {
        if (generation.current === token)
          setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        if (generation.current === token) setLoading(false)
      }
    },
    [backend, query, queryError],
  )
  useEffect(() => {
    const token = ++generation.current
    setMessages([])
    setCursor(null)
    setHasMore(false)
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
    try {
      await backend.api.copyText({ text: formatChatTranscript(messages) })
      setNotice('Loaded messages copied.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const exportTranscript = async () => {
    setExporting(true)
    setError(null)
    setNotice('')
    try {
      const result = await backend.api.exportChatHistory({ query, path: exportPath.trim() })
      setNotice(`Exported ${result.count} messages to ${result.path}`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setExporting(false)
    }
  }
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
              ? `Chat history · ${sanitizeDisplayText(channel.displayName)}`
              : 'Chat history'}
          </Text>
          <Button label="Close" onClick={onClose} />
        </div>
        <Choices
          value={platform}
          options={[
            { value: 'all', label: 'All platforms' },
            { value: 'twitch', label: 'Twitch' },
            { value: 'kick', label: 'Kick' },
            { value: 'youtube', label: 'YouTube' },
          ]}
          onChange={setPlatform}
        />
        <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Field label="Channel name or ID">
            <Input
              testId="history-channel"
              value={channelId}
              onChange={setChannelId}
              placeholder="All channels"
            />
          </Field>
          <Field label="Author name or ID">
            <Input
              testId="history-author"
              value={author}
              onChange={setAuthor}
              placeholder="All authors"
            />
          </Field>
        </div>
        <Field label="Message contains">
          <Input
            testId="history-search"
            value={text}
            onChange={setText}
            placeholder="Search local message history"
          />
        </Field>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Field label="From · YYYY-MM-DD or date and time">
            <Input testId="history-since" value={since} onChange={setSince} />
          </Field>
          <Field label="Until · YYYY-MM-DD or date and time">
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
            label={loading ? 'Loading…' : 'Refresh'}
            disabled={loading || !!queryError}
            onClick={() => void load(false)}
          />
          <Button
            label="Load older"
            disabled={loading || !hasMore}
            onClick={() => void load(true, generation.current, cursor ?? undefined)}
          />
          <Button
            label="Copy loaded messages"
            disabled={!messages.length}
            onClick={() => void copy()}
          />
          <Text
            style={{ fontSize: 11, color: theme.text2 }}
          >{`${messages.length} messages loaded`}</Text>
        </div>
        <Text style={{ fontSize: 10, color: theme.text2 }}>
          The list keeps up to 2,000 messages visible. Export includes every match. Date-only
          filters include the whole local day.
        </Text>
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
              style={{ height: '100%', scrollbarWidth: 4, scrollbarColor: theme.scrollbar }}
            >
              {messages.map((message) => (
                <div
                  key={`${message.platform}:${message.channelId}:${message.id}`}
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
                  <Text
                    style={{ fontSize: 10, color: theme.text2 }}
                  >{`${new Date(message.timestamp).toLocaleString()} · ${message.platform}/${message.channelId} · ${sanitizeDisplayText(message.author.displayName)}`}</Text>
                  <Text style={{ fontSize: 12, color: theme.text }}>
                    {truncateGraphemes(sanitizeDisplayText(message.text), 2000)}
                  </Text>
                </div>
              ))}
            </virtual-list>
          ) : (
            <Text style={{ padding: 12, fontSize: 12, color: theme.text2 }}>
              {loading ? 'Loading local history…' : 'No messages match these filters.'}
            </Text>
          )}
        </div>
        <Field label="Export all matching messages to a new file · absolute path">
          <Input
            testId="history-export-path"
            value={exportPath}
            onChange={setExportPath}
            placeholder="/home/you/chat-transcript.txt"
          />
        </Field>
        <Button
          testId="history-export"
          label={exporting ? 'Exporting…' : 'Export matching history'}
          disabled={exporting || !!queryError || !exportPath.trim()}
          onClick={() => void exportTranscript()}
        />
        {queryError || error ? (
          <Text testId="history-error" style={{ fontSize: 12, color: theme.dangerText }}>
            {queryError ?? error}
          </Text>
        ) : null}
        {notice ? <Text style={{ fontSize: 12, color: theme.successText }}>{notice}</Text> : null}
      </div>
    </Modal>
  )
}
