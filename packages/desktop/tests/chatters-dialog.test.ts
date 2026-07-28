import { describe, expect, test } from 'bun:test'
import { ref } from 'vue'

import type { Account } from '@twirchat/shared/types'
import { useChannelChatters } from '../src/views/main/composables/useChannelChatters'
import type {
  ChannelChatters,
  ChattersResponse,
  ChattersTarget,
  ChatterGroup,
  ChatterUser,
} from '../src/views/main/services/desktop-api'
import { ownChatSendTargets } from '../src/views/main/utils/chat-send-targets'
import {
  buildChattersTargets,
  chatterRoleLabel,
  filterChatterGroups,
  supportsChatters,
} from '../src/views/main/utils/chatters'

const [chatListSource, chatMessageSource, chattersDialogSource, chattersComposableSource] =
  await Promise.all([
    Bun.file(new URL('../src/views/main/components/ChatList.vue', import.meta.url)).text(),
    Bun.file(new URL('../src/views/main/components/ChatMessage.vue', import.meta.url)).text(),
    Bun.file(new URL('../src/views/main/components/ChattersDialog.vue', import.meta.url)).text(),
    Bun.file(
      new URL('../src/views/main/composables/useChannelChatters.ts', import.meta.url),
    ).text(),
  ])

function user(overrides: Partial<ChatterUser> = {}): ChatterUser {
  return { username: 'viewer', displayName: 'Viewer', ...overrides }
}

function group(role: ChatterGroup['role'], users: ChatterUser[]): ChatterGroup {
  return { role, users }
}

function channel(overrides: Partial<ChannelChatters> = {}): ChannelChatters {
  return {
    platform: 'twitch',
    channelSlug: 'streamer',
    total: 2,
    groups: [
      group('broadcaster', [user({ username: 'streamer', displayName: 'Streamer' })]),
      group('chatters', [user()]),
    ],
    ...overrides,
  }
}

function response(...results: ChannelChatters[]): ChattersResponse {
  return { results }
}

function account(platform: Account['platform'], username: string): Account {
  return {
    id: `${platform}-1`,
    platform,
    platformUserId: `${platform}-user-1`,
    username,
    displayName: username,
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('supportsChatters()', () => {
  test('renders the chatters action for twitch and kick channels', () => {
    expect(supportsChatters('twitch')).toBe(true)
    expect(supportsChatters('kick')).toBe(true)
  })

  test('hides the chatters action for youtube channels and missing channels', () => {
    expect(supportsChatters('youtube')).toBe(false)
    expect(supportsChatters(undefined)).toBe(false)
  })
})

describe('chatterRoleLabel()', () => {
  test('humanizes every chatter role', () => {
    expect(chatterRoleLabel('broadcaster')).toBe('Broadcaster')
    expect(chatterRoleLabel('moderators')).toBe('Moderators')
    expect(chatterRoleLabel('vips')).toBe('VIPs')
    expect(chatterRoleLabel('ogs')).toBe('OGs')
    expect(chatterRoleLabel('bots')).toBe('Bots')
    expect(chatterRoleLabel('chatters')).toBe('Chatters')
  })
})

describe('filterChatterGroups()', () => {
  const groups = [
    group('broadcaster', [user({ username: 'streamer', displayName: 'Streamer' })]),
    group('moderators', []),
    group('chatters', [
      user({ username: 'alice', displayName: 'Alice' }),
      user({ username: 'bob', displayName: 'Bob' }),
      user({ username: 'coolguy', displayName: 'Speedrunner' }),
    ]),
  ]

  test('returns non-empty groups untouched for a blank query', () => {
    const result = filterChatterGroups(groups, '   ')
    expect(result.map((g) => g.role)).toEqual(['broadcaster', 'chatters'])
    expect(result[1]?.users).toHaveLength(3)
  })

  test('matches case-insensitively over username and displayName', () => {
    const byDisplayName = filterChatterGroups(groups, 'SPEED')
    expect(byDisplayName).toHaveLength(1)
    expect(byDisplayName[0]?.users.map((u) => u.username)).toEqual(['coolguy'])

    const byUsername = filterChatterGroups(groups, 'ALICE')
    expect(byUsername[0]?.users.map((u) => u.username)).toEqual(['alice'])
  })

  test('trims the query before matching', () => {
    const result = filterChatterGroups(groups, '  bob  ')
    expect(result[0]?.users.map((u) => u.username)).toEqual(['bob'])
  })

  test('preserves user order and hides groups emptied by the filter', () => {
    const result = filterChatterGroups(groups, 'o')
    expect(result.map((g) => g.role)).toEqual(['chatters'])
    expect(result[0]?.users.map((u) => u.username)).toEqual(['bob', 'coolguy'])
  })

  test('returns an empty list when nothing matches', () => {
    expect(filterChatterGroups(groups, 'zzz')).toEqual([])
  })
})

describe('buildChattersTargets()', () => {
  test('watched pane yields a single target for a twitch/kick watched channel', () => {
    const targets = buildChattersTargets(
      { platform: 'twitch', channelSlug: 'streamer' },
      ownChatSendTargets([account('kick', 'kicker')]),
    )

    expect(targets).toEqual([{ platform: 'twitch', channelSlug: 'streamer' }])
  })

  test('watched pane yields no targets for a youtube watched channel', () => {
    expect(buildChattersTargets({ platform: 'youtube', channelSlug: 'yt-channel' }, [])).toEqual([])
  })

  test('home pane fans out to every connected twitch/kick account', () => {
    const ownTargets = ownChatSendTargets([
      account('twitch', 'streamer'),
      account('kick', 'kicker'),
      account('youtube', 'yt-channel'),
    ])
    const targets = buildChattersTargets(null, ownTargets)

    expect(targets).toEqual([
      { platform: 'twitch', channelSlug: 'streamer' },
      { platform: 'kick', channelSlug: 'kicker' },
    ])
  })

  test('home pane yields no targets when only youtube accounts are connected', () => {
    expect(buildChattersTargets(null, ownChatSendTargets([account('youtube', 'yt')]))).toEqual([])
  })
})

describe('useChannelChatters()', () => {
  test('requests chatters with the current targets on open and exposes loading state', async () => {
    const calls: ChattersTarget[][] = []
    let resolveFetch: ((value: ChattersResponse) => void) | undefined
    const open = ref(false)
    const targets = ref<ChattersTarget[]>([
      { platform: 'twitch', channelSlug: 'streamer' },
      { platform: 'kick', channelSlug: 'kicker' },
    ])
    const state = useChannelChatters(open, targets, (requested) => {
      calls.push(requested)
      return new Promise<ChattersResponse>((resolve) => {
        resolveFetch = resolve
      })
    })

    expect(calls).toEqual([])

    open.value = true
    expect(calls).toEqual([
      [
        { platform: 'twitch', channelSlug: 'streamer' },
        { platform: 'kick', channelSlug: 'kicker' },
      ],
    ])
    expect(state.loading.value).toBe(true)
    expect(state.chatters.value).toBeNull()

    resolveFetch?.(
      response(channel(), channel({ platform: 'kick', channelSlug: 'kicker', total: 1 })),
    )
    await flush()

    expect(state.loading.value).toBe(false)
    expect(state.error.value).toBeNull()
    expect(state.chatters.value?.results).toHaveLength(2)
    expect(state.visibleResults.value.map((c) => c.channelSlug)).toEqual(['streamer', 'kicker'])
  })

  test('surfaces whole-request rejections verbatim and retry re-fetches all targets', async () => {
    let attempt = 0
    const open = ref(true)
    const targets = ref<ChattersTarget[]>([{ platform: 'twitch', channelSlug: 'streamer' }])
    const state = useChannelChatters(open, targets, () => {
      attempt += 1
      if (attempt === 1) {
        return Promise.reject(new Error('Malformed chatters request.'))
      }
      return Promise.resolve(response(channel()))
    })

    open.value = false
    open.value = true
    await flush()

    expect(state.loading.value).toBe(false)
    expect(state.error.value).toBe('Malformed chatters request.')
    expect(state.chatters.value).toBeNull()

    await state.reload()

    expect(attempt).toBe(2)
    expect(state.error.value).toBeNull()
    expect(state.chatters.value?.results[0]?.total).toBe(2)
  })

  test('keeps per-channel errors alongside successful channel results', async () => {
    const open = ref(true)
    const targets = ref<ChattersTarget[]>([
      { platform: 'twitch', channelSlug: 'streamer' },
      { platform: 'kick', channelSlug: 'kicker' },
    ])
    const state = useChannelChatters(open, targets, () =>
      Promise.resolve(
        response(
          channel(),
          channel({
            platform: 'kick',
            channelSlug: 'kicker',
            total: 0,
            groups: [],
            error: 'Reconnect Kick to read chatters.',
          }),
        ),
      ),
    )

    open.value = false
    open.value = true
    await flush()

    expect(state.error.value).toBeNull()
    const results = state.visibleResults.value
    expect(results).toHaveLength(2)
    expect(results[0]?.error).toBeUndefined()
    expect(results[0]?.groups.map((g) => g.role)).toEqual(['broadcaster', 'chatters'])
    expect(results[1]?.error).toBe('Reconnect Kick to read chatters.')
  })

  test('discards a late response from previous targets', async () => {
    const resolvers = new Map<string, (value: ChattersResponse) => void>()
    const open = ref(false)
    const targets = ref<ChattersTarget[]>([{ platform: 'twitch', channelSlug: 'first' }])
    const state = useChannelChatters(
      open,
      targets,
      (requested) =>
        new Promise<ChattersResponse>((resolve) => {
          resolvers.set(requested[0]?.channelSlug ?? '', resolve)
        }),
    )

    open.value = true
    targets.value = [{ platform: 'kick', channelSlug: 'second' }]

    resolvers.get('second')?.(response(channel({ platform: 'kick', channelSlug: 'second' })))
    await flush()
    expect(state.chatters.value?.results[0]?.channelSlug).toBe('second')

    resolvers.get('first')?.(response(channel({ channelSlug: 'first' })))
    await flush()
    expect(state.chatters.value?.results[0]?.channelSlug).toBe('second')
  })

  test('discards a late response after the dialog closes', async () => {
    let resolveFetch: ((value: ChattersResponse) => void) | undefined
    const open = ref(false)
    const targets = ref<ChattersTarget[]>([{ platform: 'twitch', channelSlug: 'streamer' }])
    const state = useChannelChatters(
      open,
      targets,
      () =>
        new Promise<ChattersResponse>((resolve) => {
          resolveFetch = resolve
        }),
    )

    open.value = true
    open.value = false
    resolveFetch?.(response(channel()))
    await flush()

    expect(state.chatters.value).toBeNull()
    expect(state.loading.value).toBe(false)
    expect(state.error.value).toBeNull()
  })

  test('issues exactly one request per open or targets change without polling', async () => {
    const calls: string[] = []
    const open = ref(false)
    const targets = ref<ChattersTarget[]>([{ platform: 'twitch', channelSlug: 'first' }])
    useChannelChatters(open, targets, (requested) => {
      calls.push(requested.map((target) => target.channelSlug).join(','))
      return Promise.resolve(response(channel()))
    })

    open.value = true
    await flush()
    open.value = false
    open.value = true
    await flush()
    targets.value = [{ platform: 'kick', channelSlug: 'second' }]
    await flush()

    expect(calls).toEqual(['first', 'first', 'second'])
  })

  test('does not request chatters without targets', async () => {
    const calls: unknown[] = []
    const open = ref(false)
    const targets = ref<ChattersTarget[]>([])
    useChannelChatters(open, targets, () => {
      calls.push(null)
      return Promise.resolve(response())
    })

    open.value = true
    await flush()

    expect(calls).toEqual([])
  })

  test('filters visible groups by query across sections without changing totals', async () => {
    const open = ref(true)
    const targets = ref<ChattersTarget[]>([
      { platform: 'twitch', channelSlug: 'streamer' },
      { platform: 'kick', channelSlug: 'kicker' },
    ])
    const state = useChannelChatters(open, targets, () =>
      Promise.resolve(
        response(
          channel({
            total: 3,
            groups: [
              group('broadcaster', [user({ username: 'streamer', displayName: 'Streamer' })]),
              group('chatters', [
                user({ username: 'alice', displayName: 'Alice' }),
                user({ username: 'bob', displayName: 'Bob' }),
              ]),
            ],
          }),
          channel({
            platform: 'kick',
            channelSlug: 'kicker',
            total: 1,
            groups: [group('chatters', [user({ username: 'alice-kick', displayName: 'AliceK' })])],
          }),
        ),
      ),
    )

    open.value = false
    open.value = true
    await flush()

    expect(state.visibleResults.value).toHaveLength(2)

    state.query.value = 'ALICE'
    const results = state.visibleResults.value
    expect(results[0]?.groups.map((g) => g.role)).toEqual(['chatters'])
    expect(results[0]?.groups[0]?.users.map((u) => u.username)).toEqual(['alice'])
    expect(results[1]?.groups[0]?.users.map((u) => u.username)).toEqual(['alice-kick'])
    expect(state.chatters.value?.results[0]?.total).toBe(3)
    expect(state.chatters.value?.results[1]?.total).toBe(1)
  })
})

describe('ChatList chatters wiring', () => {
  test('gates the chatters button on having at least one twitch/kick target', () => {
    expect(chatListSource).toContain('v-if="chattersTargets.length > 0"')
    expect(chatListSource).toContain(
      'buildChattersTargets(props.watchedChannel, allChannels.value)',
    )
    expect(chatListSource).toContain("import { buildChattersTargets } from '../utils/chatters'")
    expect(chatListSource).toContain('title="Chatters"')
    expect(chatListSource).toContain('isChattersDialogOpen = true')
  })

  test('mounts a single ChattersDialog owned by the pane, not per message', () => {
    expect(chatListSource.split('<ChattersDialog').length - 1).toBe(1)
    expect(chatListSource).toContain('v-model:open="isChattersDialogOpen"')
    expect(chatListSource).toContain(':targets="chattersTargets"')
    expect(chatMessageSource).not.toContain('ChattersDialog')
  })
})

describe('ChattersDialog structure', () => {
  test('follows the shared reka dialog pattern with an accessible title', () => {
    expect(chattersDialogSource).toContain('DialogRoot')
    expect(chattersDialogSource).toContain('DialogPortal')
    expect(chattersDialogSource).toContain('DialogOverlay')
    expect(chattersDialogSource).toContain('DialogContent')
    expect(chattersDialogSource).toContain('DialogTitle')
    expect(chattersDialogSource).toContain('v-model:open="open"')
  })

  test('renders a platform-branded section per channel result', () => {
    expect(chattersDialogSource).toContain('v-for="channel in visibleResults"')
    expect(chattersDialogSource).toContain('platformColor(channel.platform)')
    expect(chattersDialogSource).toContain('channel.channelSlug')
    expect(chattersDialogSource).toContain('channel.total')
    expect(chattersDialogSource).toContain('chatterRoleLabel(group.role)')
  })

  test('renders per-channel error blocks with retry alongside successful sections', () => {
    expect(chattersDialogSource).toContain('v-if="channel.error"')
    expect(chattersDialogSource).toContain('void reload()')
    expect(chattersDialogSource).toContain('v-else class="chatters-groups"')
  })

  test('renders loading, whole-request error, empty, and search states', () => {
    expect(chattersDialogSource).toContain('Loading chatters…')
    expect(chattersDialogSource).toContain('v-else-if="error"')
    expect(chattersDialogSource).toContain('No active chatters right now.')
    expect(chattersDialogSource).toContain('No chatters match your search.')
    expect(chattersDialogSource).toContain('v-model="query"')
    expect(chattersDialogSource).toContain('chatters-avatar-fallback')
  })

  test('goes through the rpc facade without raw fetch or type escapes', () => {
    expect(chattersComposableSource).toContain('desktopApi.request.getChatters')
    expect(chattersComposableSource).not.toContain('fetch(')
    expect(chattersDialogSource).not.toContain('fetch(')
    expect(chattersDialogSource).not.toContain(': any')
    expect(chattersDialogSource).not.toContain('@ts-ignore')
    expect(chattersDialogSource).not.toContain('<svg')
  })

  test('guards against stale responses with a request generation counter', () => {
    expect(chattersComposableSource).toContain('requestGeneration')
    expect(chattersComposableSource).toContain('generation !== requestGeneration.value')
  })
})
