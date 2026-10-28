/**
 * Chatters dialog — port of ChattersDialog.vue onto GPUIX.
 *
 * Loads the active chatters for the given twitch/kick targets, groups them
 * per channel and role, with a client-side search filter.
 *
 * GPUIX deviations:
 * - Dialog width is a fixed 480px (Vue used 90vw capped at 480px).
 * - Esc closes via a focusable wrapper + the search input's key handler;
 *   reka-ui's global dialog Escape handling does not exist here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChannelChatters, ChattersTarget, ChatterUser } from '../backend/api'
import { chatterRoleLabel, filterChatterGroups } from '../../views/main/utils/chatters'
import { platformColor } from '../theme'
import { useTheme } from '../theme-context'
import { useBackend } from '../backend/context'
import { useTextInputFocusTracking } from '../state/focus'
import { Text } from './ui/Text'
import { RemoteImage } from './ui/RemoteImage'
import { Modal } from './ui/Modal'
import { PlatformIcon } from './ui/Icon'

interface ChattersResponse {
  results: ChannelChatters[]
}

function serializeTargets(targets: readonly ChattersTarget[]): string {
  return targets.map((target) => `${target.platform}:${target.channelSlug.toLowerCase()}`).join('|')
}

function channelKey(channel: ChannelChatters): string {
  return `${channel.platform}:${channel.channelSlug}`
}

function chatterInitial(user: ChatterUser): string {
  const name = user.displayName || user.username
  return name.charAt(0).toUpperCase()
}

function showLogin(user: ChatterUser): boolean {
  return Boolean(user.username) && user.username.toLowerCase() !== user.displayName.toLowerCase()
}

export function ChattersDialog({
  targets,
  onClose,
}: {
  targets: ChattersTarget[]
  onClose: () => void
}) {
  const theme = useTheme()
  const backend = useBackend()

  const [chatters, setChatters] = useState<ChattersResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const searchFocus = useTextInputFocusTracking()
  const generationRef = useRef(0)

  const targetsKey = serializeTargets(targets)

  const reload = useCallback(async (): Promise<void> => {
    if (targets.length === 0) return

    const generation = generationRef.current + 1
    generationRef.current = generation
    setLoading(true)
    setError(null)

    try {
      const response = await backend.api.getChatters({ targets })
      if (generation !== generationRef.current) return
      setChatters(response)
    } catch (loadError) {
      if (generation !== generationRef.current) return
      setChatters(null)
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (generation === generationRef.current) {
        setLoading(false)
      }
    }
  }, [backend, targets])

  // Reset + load on mount / when the target set changes (port of
  // useChannelChatters; the dialog only exists while open).
  useEffect(() => {
    generationRef.current += 1
    setChatters(null)
    setError(null)
    setLoading(false)
    setQuery('')
    if (targetsKey.length > 0) void reload()
  }, [reload, targetsKey])

  const visibleResults = useMemo(
    () =>
      (chatters?.results ?? []).map((channel) => ({
        platform: channel.platform,
        channelSlug: channel.channelSlug,
        total: channel.total,
        groups: filterChatterGroups(channel.groups, query),
        error: channel.error,
      })),
    [chatters, query],
  )

  const hasQuery = query.trim().length > 0
  const totalChatting = (chatters?.results ?? []).reduce((sum, channel) => sum + channel.total, 0)

  return (
    <Modal width={480} onClose={onClose}>
      <div
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'escape') onClose()
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minHeight: 0,
        }}
      >
        {/* Header (full-bleed: the Vue version used negative margins) */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingTop: 16,
            paddingBottom: 16,
            paddingLeft: 20,
            paddingRight: 20,
            marginBottom: 16,
            background: {
              type: 'linear-gradient',
              angle: 135,
              stops: [
                { color: theme.surface2, position: 0 },
                { color: theme.dialog, position: 1 },
              ],
            },
            borderBottomWidth: 1,
            borderColor: theme.hairline,
          }}
        >
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Text style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>Chatters</Text>
            {chatters ? (
              <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: theme.text2,
                  }}
                >
                  {`${totalChatting} chatting`}
                </Text>
                <Text style={{ fontSize: 13, color: theme.text2 }}>
                  {`across ${chatters.results.length} ${
                    chatters.results.length === 1 ? 'channel' : 'channels'
                  }`}
                </Text>
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            minHeight: 0,
            paddingLeft: 20,
            paddingRight: 20,
            paddingBottom: 20,
          }}
        >
          <input
            autoFocus
            value={query}
            placeholder="Search chatters…"
            onChange={(event) => setQuery(event.value ?? '')}
            {...searchFocus}
            onKeyDown={(event) => {
              if (event.key === 'escape') onClose()
            }}
            theme={{ caret: theme.link }}
            style={{
              flexShrink: 0,
              marginBottom: 12,
              paddingTop: 8,
              paddingBottom: 8,
              paddingLeft: 12,
              paddingRight: 12,
              backgroundColor: theme.surface2,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 4,
              fontSize: 13,
              color: theme.text,
            }}
          />

          <div
            style={{
              flexGrow: 1,
              minHeight: 160,
              overflowY: 'scroll',
              scrollbarColor: theme.scrollbar,
              scrollbarWidth: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {loading ? (
              <ChattersState>
                <Text style={{ fontSize: 13, color: theme.text2 }}>Loading chatters…</Text>
              </ChattersState>
            ) : error ? (
              <ChattersState error>
                <Text style={{ fontSize: 13, color: theme.dangerText }}>{error}</Text>
                <RetryButton onClick={() => void reload()} />
              </ChattersState>
            ) : chatters ? (
              visibleResults.length === 0 ? (
                <ChattersState>
                  <Text style={{ fontSize: 13, color: theme.text2 }}>
                    No active chatters right now.
                  </Text>
                </ChattersState>
              ) : (
                visibleResults.map((channel) => (
                  <div
                    key={channelKey(channel)}
                    style={{ display: 'flex', flexDirection: 'column' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 8,
                        paddingBottom: 6,
                        borderBottomWidth: 1,
                        borderColor: theme.hairline,
                      }}
                    >
                      <PlatformIcon platform={channel.platform} size={16} />
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: theme.text,
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                        }}
                      >
                        {channel.channelSlug}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: theme.text2,
                          flexShrink: 0,
                        }}
                      >
                        {`· ${channel.total} chatting`}
                      </Text>
                    </div>

                    {channel.error ? (
                      <ChattersState small error>
                        <Text style={{ fontSize: 13, color: theme.dangerText }}>
                          {channel.error}
                        </Text>
                        <RetryButton onClick={() => void reload()} />
                      </ChattersState>
                    ) : channel.groups.length === 0 ? (
                      <ChattersState small>
                        <Text style={{ fontSize: 13, color: theme.text2 }}>
                          {hasQuery
                            ? 'No chatters match your search.'
                            : 'No active chatters right now.'}
                        </Text>
                      </ChattersState>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {channel.groups.map((group) => (
                          <div
                            key={group.role}
                            style={{ display: 'flex', flexDirection: 'column' }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 8,
                                marginBottom: 6,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: theme.text2,
                                }}
                              >
                                {chatterRoleLabel(group.role).toUpperCase()}
                              </Text>
                              <div
                                style={{
                                  backgroundColor: theme.fill,
                                  borderRadius: 999,
                                  paddingTop: 1,
                                  paddingBottom: 1,
                                  paddingLeft: 8,
                                  paddingRight: 8,
                                }}
                              >
                                <Text style={{ fontSize: 11, color: theme.text2 }}>
                                  {`${group.users.length}`}
                                </Text>
                              </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {group.users.map((user) => (
                                <div
                                  key={user.userId ?? user.username}
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 8,
                                    paddingTop: 4,
                                    paddingBottom: 4,
                                    paddingLeft: 6,
                                    paddingRight: 6,
                                    borderRadius: 6,
                                    hover: { backgroundColor: theme.fill },
                                  }}
                                >
                                  {user.avatarUrl ? (
                                    <RemoteImage
                                      url={user.avatarUrl}
                                      objectFit="cover"
                                      style={{
                                        width: 24,
                                        height: 24,
                                        borderRadius: 12,
                                        backgroundColor: theme.fill,
                                        flexShrink: 0,
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        width: 24,
                                        height: 24,
                                        borderRadius: 12,
                                        backgroundColor: platformColor(channel.platform),
                                        flexShrink: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                      }}
                                    >
                                      <Text
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 700,
                                          color: '#ffffff',
                                        }}
                                      >
                                        {chatterInitial(user)}
                                      </Text>
                                    </div>
                                  )}
                                  <Text
                                    style={{
                                      fontSize: 13,
                                      color: theme.text,
                                      whiteSpace: 'nowrap',
                                      textOverflow: 'ellipsis',
                                      overflow: 'hidden',
                                    }}
                                  >
                                    {user.displayName}
                                  </Text>
                                  {showLogin(user) ? (
                                    <Text
                                      style={{
                                        fontSize: 11,
                                        color: theme.text2,
                                        whiteSpace: 'nowrap',
                                        textOverflow: 'ellipsis',
                                        overflow: 'hidden',
                                      }}
                                    >
                                      {`@${user.username}`}
                                    </Text>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Local styled bits ───────────────────────────────────────────────────────

function ChattersState({
  small,
  error,
  children,
}: {
  small?: boolean
  error?: boolean
  children: React.ReactNode
}) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: error ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        minHeight: small ? 56 : 160,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.hairline,
        borderRadius: 10,
        backgroundColor: theme.fill,
      }}
    >
      {children}
    </div>
  )
}

function RetryButton({ onClick }: { onClick: () => void }) {
  const theme = useTheme()
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 6,
        backgroundColor: theme.fill,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        cursor: 'pointer',
        hover: { backgroundColor: theme.fillHover },
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>Retry</Text>
    </div>
  )
}
