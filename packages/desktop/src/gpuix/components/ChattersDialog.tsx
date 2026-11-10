import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { UserCardTarget } from '../../views/main/utils/chatCommands'
import { filterChatterGroups } from '../../views/main/utils/chatters'
import { initialsOf } from '../../views/shared/utils/display-text'
import type { ChannelChatters, ChattersTarget, ChatterUser } from '../backend/api'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { focusPopupSearch, usePopupHotkeys } from '../hooks/use-popup-hotkeys'
import { useT } from '../i18n'
import { nativeWindow } from '../native-window'
import { useTextInputFocusTracking } from '../state/focus'
import { platformColor } from '../theme'
import { useTheme } from '../theme-context'
import { ActionButton } from './ui/Form'
import { PlatformIcon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'
import { ToggleGroup, type ToggleGroupOption } from './ui/ToggleGroup'

type ChattersPlatform = ChattersTarget['platform']

const PLATFORM_TABS: readonly ToggleGroupOption<ChattersPlatform>[] = [
  { value: 'twitch', label: 'Twitch', testId: 'chatters-tab-twitch' },
  { value: 'kick', label: 'Kick', testId: 'chatters-tab-kick' },
]
const COMMUNITY_PAGE_SIZE = 100

type ChattersLoad =
  | { status: 'loaded'; targets: ChattersTarget[]; results: ChannelChatters[] }
  | { status: 'error'; targets: ChattersTarget[]; error: string }

interface UserCardError {
  targets: ChattersTarget[]
  message: string
}

interface CommunityPage {
  channel: ChannelChatters
  index: number
}

function channelKey(channel: ChannelChatters): string {
  return `${channel.platform}:${channel.channelSlug}`
}

function chatterInitial(user: ChatterUser): string {
  const name = user.displayName || user.username
  return initialsOf(name)
}

function showLogin(user: ChatterUser): boolean {
  return Boolean(user.username) && user.username.toLowerCase() !== user.displayName.toLowerCase()
}

export function ChattersDialog({
  targets,
  onClose,
  onOpenUserCard,
}: {
  targets: ChattersTarget[]
  onClose: () => void
  onOpenUserCard: (target: UserCardTarget) => void
}) {
  const theme = useTheme()
  const backend = useBackend()
  const { t, tPlural } = useT()
  const renderer = useGpuixRequired()
  const searchRef = useRef<PublicInstance | null>(null)

  const [selectedPlatform, setSelectedPlatform] = useState<ChattersPlatform>('twitch')
  const [load, setLoad] = useState<ChattersLoad | null>(null)
  const [query, setQuery] = useState('')
  const [communityPage, setCommunityPage] = useState<CommunityPage | null>(null)
  const [cardError, setCardError] = useState<UserCardError | null>(null)
  const searchFocus = useTextInputFocusTracking()
  const pendingRequest = useRef<symbol | null>(null)

  const tabs = PLATFORM_TABS.filter((tab) =>
    targets.some((target) => target.platform === tab.value),
  )
  const activePlatform = tabs.find((tab) => tab.value === selectedPlatform)?.value ?? tabs[0]?.value
  const activeTargets = useMemo(
    () => targets.filter((target) => target.platform === activePlatform),
    [targets, activePlatform],
  )

  function close() {
    pendingRequest.current = null
    onClose()
  }

  function switchPlatform(platform: ChattersPlatform) {
    if (platform === activePlatform) return
    pendingRequest.current = null
    setCardError(null)
    setCommunityPage(null)
    setSelectedPlatform(platform)
  }

  const popupContextId = usePopupHotkeys('chatters', {
    delete: close,
    search: () => focusPopupSearch(nativeWindow(renderer), searchRef),
  })

  const reload = useCallback(async () => {
    if (activeTargets.length === 0) return

    const request = Symbol()
    pendingRequest.current = request

    try {
      const { results } = await backend.api.getChatters({ targets: activeTargets })
      if (pendingRequest.current !== request) return
      setLoad({ status: 'loaded', targets: activeTargets, results })
    } catch (error) {
      if (pendingRequest.current !== request) return
      setLoad({
        status: 'error',
        targets: activeTargets,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [backend, activeTargets])

  useEffect(() => {
    runUiTask(reload())
    return () => {
      pendingRequest.current = null
    }
  }, [reload])

  function retry() {
    setCardError(null)
    setCommunityPage(null)
    setLoad(null)
    runUiTask(reload())
  }

  function changeCommunityPage(channel: ChannelChatters, index: number) {
    pendingRequest.current = null
    setCardError(null)
    setCommunityPage({ channel, index })
  }

  async function openUserCard(channel: ChannelChatters, user: ChatterUser) {
    if (!channel.channelId) return

    const request = Symbol()
    pendingRequest.current = request
    setCardError(null)

    const resolved = user.userId
      ? null
      : await backend.api
          .resolveMentionUser({ platform: channel.platform, username: user.username })
          .catch(() => null)
    if (pendingRequest.current !== request) return

    pendingRequest.current = null
    const platformUserId = user.userId ?? resolved?.platformUserId
    if (!platformUserId) {
      setCardError({
        targets: activeTargets,
        message: t('chat.chatters.openCardFailed', { username: user.username }),
      })
      return
    }
    onOpenUserCard({
      platform: channel.platform,
      platformUserId,
      channelId: channel.channelId,
      channelSlug: channel.channelSlug,
      username: user.username,
      displayName:
        channel.platform === 'twitch'
          ? (resolved?.displayName ?? user.displayName)
          : user.displayName,
      avatarUrl: user.avatarUrl ?? resolved?.avatarUrl,
    })
  }

  const currentLoad = load?.targets === activeTargets ? load : null
  const chatters = currentLoad?.status === 'loaded' ? currentLoad : null
  const error = currentLoad?.status === 'error' ? currentLoad.error : null
  const loading = activeTargets.length > 0 && !currentLoad
  const visibleResults = useMemo(
    () =>
      (chatters?.results ?? []).map((channel) => {
        const groups = filterChatterGroups(channel.groups, query)
        if (channel.source !== 'community') return { channel, groups, page: 0, pageCount: 1 }

        const count = groups.reduce((total, group) => total + group.users.length, 0)
        const pageCount = Math.ceil(count / COMMUNITY_PAGE_SIZE)
        const page = communityPage?.channel === channel ? communityPage.index : 0
        const first = page * COMMUNITY_PAGE_SIZE
        let offset = 0
        const pageGroups = groups.flatMap((group) => {
          const start = Math.max(0, first - offset)
          const end = Math.max(0, first + COMMUNITY_PAGE_SIZE - offset)
          offset += group.users.length
          const users = group.users.slice(start, end)
          return users.length > 0 ? [{ ...group, users }] : []
        })
        return { channel, groups: pageGroups, page, pageCount }
      }),
    [chatters, communityPage, query],
  )

  const hasQuery = query.trim().length > 0
  const totalChatting = (chatters?.results ?? []).reduce((sum, channel) => sum + channel.total, 0)

  return (
    <Modal hotkeyContextId={popupContextId} width={480} onClose={close}>
      <div
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'escape') close()
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
            <Text style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>
              {t('chat.chatters.title')}
            </Text>
            {chatters ? (
              <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: theme.text2,
                  }}
                >
                  {tPlural('chat.chatters.chatting', totalChatting)}
                </Text>
                <Text style={{ fontSize: 13, color: theme.text2 }}>
                  {tPlural('chat.chatters.across', chatters.results.length)}
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
          {tabs.length > 1 && activePlatform ? (
            <div style={{ alignSelf: 'flex-start', flexShrink: 0, marginBottom: 12 }}>
              <ToggleGroup
                label={t('chat.chatters.title')}
                options={tabs}
                value={activePlatform}
                onChange={switchPlatform}
              />
            </div>
          ) : null}
          <input
            ref={searchRef}
            testId="chatters-search"
            autoFocus
            value={query}
            placeholder={t('chat.chatters.searchPlaceholder')}
            onChange={(event) => {
              setQuery(event.value ?? '')
              setCommunityPage(null)
            }}
            {...searchFocus}
            onKeyDown={(event) => {
              if (event.key === 'escape') close()
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

          {cardError?.targets === activeTargets ? (
            <Text style={{ color: theme.dangerText, fontSize: 13, marginBottom: 8 }}>
              {cardError.message}
            </Text>
          ) : null}
          <div
            key={activePlatform}
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
                <Text style={{ fontSize: 13, color: theme.text2 }}>
                  {t('chat.chatters.loading')}
                </Text>
              </ChattersState>
            ) : error ? (
              <ChattersState error>
                <Text style={{ fontSize: 13, color: theme.dangerText }}>{error}</Text>
                <ActionButton onClick={retry}>{t('common.retry')}</ActionButton>
              </ChattersState>
            ) : chatters ? (
              visibleResults.length === 0 ? (
                <ChattersState>
                  <Text style={{ fontSize: 13, color: theme.text2 }}>
                    {t('chat.chatters.empty')}
                  </Text>
                </ChattersState>
              ) : (
                visibleResults.map(({ channel, groups, page, pageCount }) => (
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
                        {t('chat.chatters.channelCount', { count: channel.total })}
                      </Text>
                    </div>

                    {channel.source === 'community' ? (
                      <Text style={{ fontSize: 12, color: theme.text2, marginBottom: 8 }}>
                        {t('chat.chatters.communitySource')}
                      </Text>
                    ) : null}

                    {pageCount > 1 ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <ActionButton
                          disabled={page === 0}
                          onClick={() => changeCommunityPage(channel, page - 1)}
                        >
                          {t('common.back')}
                        </ActionButton>
                        <Text style={{ fontSize: 12, color: theme.text2 }}>
                          {t('chat.chatters.communityPage', { page: page + 1, total: pageCount })}
                        </Text>
                        <ActionButton
                          testId="chatters-community-next"
                          disabled={page + 1 === pageCount}
                          onClick={() => changeCommunityPage(channel, page + 1)}
                        >
                          {t('common.next')}
                        </ActionButton>
                      </div>
                    ) : null}

                    {channel.error ? (
                      <ChattersState small error>
                        <Text style={{ fontSize: 13, color: theme.dangerText }}>
                          {channel.error}
                        </Text>
                        <ActionButton onClick={retry}>{t('common.retry')}</ActionButton>
                      </ChattersState>
                    ) : groups.length === 0 ? (
                      <ChattersState small>
                        <Text style={{ fontSize: 13, color: theme.text2 }}>
                          {hasQuery ? t('chat.chatters.noMatch') : t('chat.chatters.empty')}
                        </Text>
                      </ChattersState>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {groups.map((group) => (
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
                                {t(`chat.chatters.role.${group.role}`).toUpperCase()}
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
                                  testId={`chatters-user-${user.username}`}
                                  role="button"
                                  tabIndex={0}
                                  onClick={(event) => {
                                    if ((event.button ?? 0) !== 0 || event.isRightClick) return
                                    runUiTask(openUserCard(channel, user))
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key !== 'enter' && event.key !== 'space') return
                                    event.preventDefault()
                                    event.stopPropagation()
                                    runUiTask(openUserCard(channel, user))
                                  }}
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
                                    cursor: 'pointer',
                                    hover: { backgroundColor: theme.fill },
                                    focusVisible: {
                                      outlineWidth: 1,
                                      outlineColor: theme.link,
                                      outlineOffset: -2,
                                    },
                                  }}
                                >
                                  {user.avatarUrl ? (
                                    <RemoteImage
                                      url={user.avatarUrl}
                                      thumbnailSize={24}
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
