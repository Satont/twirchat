import { useGpuixRequired, useWindowSize, type PublicInstance } from '@gpuix/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { sanitizeDisplayText, truncateGraphemes } from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import { compileChatSearch } from '../chat-tools'
import { focusPopupSearch, usePopupHotkeys } from '../hooks/use-popup-hotkeys'
import { useT } from '../i18n'
import { isMessageHiddenForStreamer } from '../message-privacy'
import { nativeWindow } from '../native-window'
import {
  captureOpenChatSnapshot,
  requestChatSearchJump,
  type ChatSearchResult,
  type ChatSearchSnapshot,
} from '../state/chat-search'
import { useStore } from '../state/create-store'
import { useTextInputFocusTracking } from '../state/focus'
import { streamerModeStore } from '../state/streamer-mode'
import { useWindowScope } from '../state/window-scope'
import { useTheme } from '../theme-context'
import { ActionButton } from './ui/Form'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'

export function SearchAllChatsDialog({ onClose }: { onClose: () => void }) {
  const backend = useBackend()
  const scope = useWindowScope()
  const privacy = useStore(streamerModeStore)
  const theme = useTheme()
  const { t, tPlural } = useT()
  const size = useWindowSize()
  const renderer = useGpuixRequired()
  const focus = useTextInputFocusTracking()
  const [snapshot, setSnapshot] = useState<ChatSearchSnapshot | null>(null)
  const [query, setQuery] = useState('')
  const [matchedResults, setResults] = useState<ChatSearchResult[]>([])
  const results = useMemo(
    () => matchedResults.filter((result) => !isMessageHiddenForStreamer(result.message, privacy)),
    [matchedResults, privacy],
  )
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const searchRef = useRef<PublicInstance | null>(null)
  const listRef = useRef<PublicInstance | null>(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setCaptureError(null)
    void captureOpenChatSnapshot(backend.api, controller.signal)
      .then((snapshotValue) => {
        if (active) setSnapshot(snapshotValue)
      })
      .catch((cause) => {
        if (active) setCaptureError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [backend, revision])

  useEffect(() => {
    if (!snapshot) return
    const compiled = compileChatSearch(query)
    setSearchError(compiled.error ?? null)
    setSearching(true)
    setSelected(0)
    setResults([])
    let index = 0
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const matches: ChatSearchResult[] = []
    const batch = () => {
      if (!active) return
      const start = performance.now()
      do {
        const result = snapshot.results[index++]
        if (
          result &&
          !isMessageHiddenForStreamer(result.message, privacy) &&
          compiled.matches(result.message, result.details)
        )
          matches.push(result)
      } while (index < snapshot.results.length && performance.now() - start < 8)
      if (index < snapshot.results.length) timer = setTimeout(batch, 0)
      else {
        setResults(matches)
        setSearching(false)
      }
    }
    timer = setTimeout(batch, 100)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [snapshot, query, privacy])

  useEffect(() => {
    if (listRef.current && results.length) renderer.scrollToItem?.(listRef.current.id, selected)
  }, [selected, results, renderer])

  const jump = (result: ChatSearchResult) => {
    if (requestChatSearchJump(result, scope)) onClose()
  }
  const error = captureError ?? searchError
  const blocked = loading || searching || !!error

  const popupContextId = usePopupHotkeys('chat-search', {
    delete: onClose,
    search: () => focusPopupSearch(nativeWindow(renderer), searchRef),
  })

  return (
    <Modal hotkeyContextId={popupContextId} width={820} onClose={onClose}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: Math.min(580, size.height * 0.75),
          padding: 20,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <div style={{ flexGrow: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>
              {t('app.search.title')}
            </Text>
            <Text style={{ fontSize: 12, color: theme.text2 }}>
              {snapshot
                ? `${tPlural('app.search.chats', snapshot.sourceCount)} · ${t('app.search.snapshotAt', { time: new Date(snapshot.capturedAt).toLocaleTimeString() })}`
                : t('app.search.capturing')}
            </Text>
          </div>
          <ActionButton onClick={() => setRevision((value) => value + 1)} disabled={loading}>
            {t('common.refresh')}
          </ActionButton>
          <ActionButton onClick={onClose}>{t('common.close')}</ActionButton>
        </div>
        <input
          ref={searchRef}
          testId="search-all-chats-input"
          autoFocus
          value={query}
          placeholder={t('app.search.placeholder')}
          {...focus}
          onChange={(event) => setQuery(event.value ?? '')}
          onKeyDown={(event) => {
            if (event.key === 'escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }
            if (event.key === 'up' || event.key === 'down') {
              event.preventDefault()
              setSelected((current) =>
                Math.max(0, Math.min(results.length - 1, current + (event.key === 'up' ? -1 : 1))),
              )
            }
            if (event.key === 'enter' && !blocked && results[selected]) {
              event.preventDefault()
              jump(results[selected])
            }
          }}
          theme={{ caret: theme.link }}
          style={{
            padding: 10,
            fontSize: 14,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 6,
            backgroundColor: theme.surface2,
            color: theme.text,
            flexShrink: 0,
          }}
        />
        <Text style={{ fontSize: 12, color: error ? theme.dangerText : theme.text2 }}>
          {error ??
            (loading
              ? t('app.search.capturingHistory')
              : searching
                ? t('app.search.searching')
                : `${tPlural('app.search.results', results.length)} · ${t('app.search.resultHint')}`)}
        </Text>
        {snapshot?.unavailableTabs.length ? (
          <Text style={{ fontSize: 12, color: theme.dangerText }}>
            {tPlural('app.search.unavailableTabs', snapshot.unavailableTabs.length)}
          </Text>
        ) : null}
        <Text style={{ fontSize: 11, color: theme.text2 }}>{t('app.search.frozenHint')}</Text>
        {results.length ? (
          <virtual-list
            testId="search-all-chats-results"
            ref={listRef}
            estimatedItemHeight={78}
            style={{
              flexGrow: 1,
              minHeight: 0,
              scrollbarColor: theme.scrollbar,
              scrollbarWidth: 5,
            }}
          >
            {results.map((result, index) => {
              const message = result.message
              return (
                <div
                  key={result.key}
                  onClick={() => {
                    if (!blocked) jump(result)
                  }}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderBottomWidth: 1,
                    borderColor: theme.hairline,
                    backgroundColor: index === selected ? theme.fillHover : theme.dialog,
                    cursor: blocked ? 'default' : 'pointer',
                  }}
                >
                  <Text
                    style={{ fontSize: 11, color: theme.text2 }}
                  >{`${message.platform} · #${truncateGraphemes(sanitizeDisplayText(result.details.channelName ?? message.channelId), 100)} · ${new Date(message.timestamp).toLocaleTimeString()}`}</Text>
                  <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>
                    {truncateGraphemes(
                      sanitizeDisplayText(
                        `${result.details.alias ?? message.author.displayName}${message.author.username ? ` (@${message.author.username})` : ''}`,
                      ),
                      100,
                    )}
                  </Text>
                  <Text style={{ fontSize: 13, color: theme.text }}>
                    {truncateGraphemes(sanitizeDisplayText(message.text), 2000)}
                  </Text>
                </div>
              )
            })}
          </virtual-list>
        ) : (
          <div
            style={{ flexGrow: 1, minHeight: 100, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ color: theme.text2, fontSize: 13 }}>
              {loading || searching ? t('app.search.preparing') : t('app.search.noMatches')}
            </Text>
          </div>
        )}
      </div>
    </Modal>
  )
}
