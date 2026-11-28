import type { ChatHeaderAction } from '@twirchat/shared/types'

import type { MessageKey } from '../i18n'
import type { IconName } from './components/ui/Icon'

export interface ChatHeaderActionMeta {
  /** Menu label. */
  readonly labelKey: MessageKey
  /** Tooltip on the pinned toolbar button. */
  readonly tooltipKey: MessageKey
  readonly icon: IconName
  readonly testId: string
}

/**
 * One table for the pane header actions: the toolbar, the ⋯ menu and the
 * appearance dialog all read it, so an action never drifts between them.
 */
export const CHAT_HEADER_ACTION_META: Record<ChatHeaderAction, ChatHeaderActionMeta> = {
  history: {
    labelKey: 'chat.menu.history',
    tooltipKey: 'chat.tooltip.searchHistory',
    icon: 'clock',
    testId: 'chat-history-button',
  },
  activities: {
    labelKey: 'chat.menu.activities',
    tooltipKey: 'chat.tooltip.activities',
    icon: 'globe',
    testId: 'twitch-activities-button',
  },
  whispers: {
    labelKey: 'chat.menu.whispers',
    tooltipKey: 'activities.tab.whispers',
    icon: 'reply',
    testId: 'whispers-button',
  },
  filters: {
    labelKey: 'chat.menu.filters',
    tooltipKey: 'chat.tooltip.filters',
    icon: 'sliders',
    testId: 'chat-filters-button',
  },
  search: {
    labelKey: 'chat.menu.searchMessages',
    tooltipKey: 'chat.tooltip.searchMessages',
    icon: 'search',
    testId: 'chat-search-button',
  },
  chatters: {
    labelKey: 'chat.menu.chatters',
    tooltipKey: 'app.settings.chat.chatters',
    icon: 'users',
    testId: 'chatters-button',
  },
  settings: {
    labelKey: 'chat.appearance.title',
    tooltipKey: 'app.settings.chat.settings',
    icon: 'settings',
    testId: 'settings-button',
  },
}
