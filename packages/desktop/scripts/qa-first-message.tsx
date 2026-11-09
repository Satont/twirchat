if (process.env.TWIRCHAT_GUI_QA !== '1') throw new Error('Use the isolated qa:gui launcher.')

import assert from 'node:assert/strict'

import { z } from 'zod'

const { assertGuiQaEnvironment } = await import('../src/services/gui-qa')
assertGuiQaEnvironment()

const { createDesktopEvents } = await import('../src/gpuix/backend/events')
const {
  watchedChannelsStore,
  watchedStatusesStore,
  layoutStore,
  activeWatchedTabStore,
  accountsStore,
} = await import('../src/state/app')
const { DesktopWindowManager } = await import('../src/window-manager')

const channel = {
  id: 'qa-first-msg',
  platform: 'twitch',
  createdAt: Date.now(),
  settings: {
    chatTheme: 'modern',
    showTimestamp: true,
    showBadges: true,
    showAvatars: true,
    showPlatformColorStripe: true,
    showPlatformIcon: true,
    fontSize: 14,
    selfPingEnabled: true,
  },
}

const backend = {
  events: createDesktopEvents(),
  api: {
    getUiState: async ({ _key }: { _key: string }) => null,
    setUiState: async ({ _key, _value }: { _key: string; _value: string }) => {},
    getWatchedChannelsLayout: async ({ _tabId }: { _tabId: string }) => null,
    setWatchedChannelsLayout: async ({
      _tabId,
      _layout,
    }: {
      _tabId: string
      _layout: unknown
    }) => {},
    removeWatchedChannelsLayout: async ({ _tabId }: { _tabId: string }) => {},
    getChannelEmotes: async () => [],
    getModerationCapabilities: async () => ({ canModerate: false }),
    getTranslationSettings: async () => ({ settings: {}, credentials: [] }),
    notify: async () => {},
    openExternalUrl: async () => {},
  },
}

watchedChannelsStore.set([channel])
activeWatchedTabStore.set('qa-first-tab')
layoutStore.set(
  new Map([
    ['qa-first-tab', { layout: { type: 'panel', id: 'pane' }, isLoading: false, error: null }],
  ]),
)
watchedStatusesStore.set(
  new Map([['qa-first-msg', { platform: 'twitch', status: 'connected', mode: 'anonymous' }]]),
)
accountsStore.set([])

const manager = new DesktopWindowManager(
  backend,
  () => {
    const { React } = require('react')
    function Content() {
      return React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: '#16161c',
          },
        },
        React.createElement(require('../src/gpuix/components/ChatView').ChatView, {
          paneId: 'qa-first-tab:pane',
          layoutTabId: 'qa-first-tab',
          layoutPanelId: 'pane',
          watchedChannel: channel,
        }),
      )
    }
    return React.createElement(Content)
  },
  () => {},
)

interface AutomationNode {
  id: number
  testId?: string
  children: AutomationNode[]
}

const automationNodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    testId: z.string().optional(),
    children: z.array(automationNodeSchema).default([]),
  }),
)

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 30_000
  while (performance.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}

try {
  await until(() => manager.windows.has('main'), 'main window')
  const renderer = manager.windows.get('main').renderer
  const window = renderer
  assert.ok(window, 'Missing main renderer')

  // Wait for chat view to be ready
  await until(() => {
    const text = window.getPaintedText().join(' ')
    return text.includes('chat') || text.length > 100
  }, 'chat view renders')

  // Inject a first message via backend event
  const firstMessage = {
    id: 'msg-first-1',
    platform: 'twitch',
    channelId: 'qa-first-msg',
    timestamp: Date.now(),
    author: {
      id: '12345',
      username: 'newuser',
      displayName: 'NewUser',
      color: '#ff6b00',
      badges: [],
    },
    text: 'Hello everyone! This is my first message!',
    type: 'text',
    metadata: {
      firstMessage: true,
    },
    delivery: { state: 'sent' },
  }

  backend.events.emit('watched_channel_message', {
    channelId: 'qa-first-msg',
    message: firstMessage,
  })

  // Wait for message to render
  await until(
    () => window.getPaintedText().some((t) => t.includes('First message')),
    'first message badge appears',
  )

  // Verify
  const text = window.getPaintedText().join(' ')
  console.log('=== CHAT TEXT ===')
  console.log(text)
  console.log('=================')

  assert.ok(text.includes('First message'), 'Missing "First message" badge')
  assert.ok(text.includes('NewUser'), 'Missing author name')
  assert.ok(text.includes('Hello everyone!'), 'Missing message text')

  console.log('First message QA passed.')
  process.exit(0)
} catch (error) {
  console.error('ERROR:', error)
  process.exit(1)
}
